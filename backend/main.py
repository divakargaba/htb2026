"""
Silenced by the Algorithm - Python Backend

This backend handles:
1. YouTube transcript fetching (using youtube-transcript-api - no CORS issues)
2. Gemini API calls for quality scoring and greenwashing detection
3. Bias receipt generation

Run with: uvicorn main:app --reload --port 8000
"""

import os
import json
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# YouTube transcript API (v1.2.x - new API)
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api import (
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable
)

# Gemini AI (optional - graceful degradation if not available)
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    genai = None

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("silenced-backend")

# ============================================
# CONFIGURATION
# ============================================

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")

# Configure Gemini if available
if GEMINI_AVAILABLE and GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    logger.info("Gemini API configured successfully")
else:
    logger.warning("Gemini API not available - will use heuristic fallbacks")

# ============================================
# PYDANTIC MODELS
# ============================================

class TranscriptRequest(BaseModel):
    video_id: str
    languages: List[str] = Field(default=["en", "en-US", "en-GB"])

class TranscriptResponse(BaseModel):
    success: bool
    video_id: str
    transcript: Optional[str] = None
    language: Optional[str] = None
    duration_seconds: Optional[float] = None
    error: Optional[str] = None

class QualityScoreRequest(BaseModel):
    video_id: str
    title: str
    description: Optional[str] = ""
    transcript: Optional[str] = None
    channel_title: Optional[str] = ""
    subscriber_count: Optional[int] = 0
    query: Optional[str] = ""  # The search topic

class QualityScoreResponse(BaseModel):
    success: bool
    video_id: str
    relevance_score: float = Field(ge=0, le=1)
    quality_score: float = Field(ge=0, le=1)
    content_depth_score: Optional[float] = Field(default=None, ge=0, le=1)
    combined_score: float = Field(ge=0, le=1)
    method: str  # "gemini" or "heuristic"
    reason: str
    flags: List[str] = []
    error: Optional[str] = None

class GreenwashingRequest(BaseModel):
    video_id: str
    title: str
    description: Optional[str] = ""
    transcript: Optional[str] = None
    channel_subscriber_count: Optional[int] = 0

class GreenwashingResponse(BaseModel):
    success: bool
    video_id: str
    transparency_score: int = Field(ge=0, le=100)
    risk_level: str  # "low", "medium", "high"
    flags: List[Dict[str, Any]] = []
    method: str  # "gemini" or "heuristic"
    error: Optional[str] = None

class BiasReceiptRequest(BaseModel):
    video_id: str
    subscriber_count: int = 0
    views_per_day: float = 0
    engagement_ratio: float = 0
    avg_subs_in_topic: int = 100000
    topic_concentration: int = 50
    video_title: str = ""
    channel_title: str = ""

class BiasReceiptResponse(BaseModel):
    success: bool
    video_id: str
    why_not_shown: List[str] = []
    why_surfaced: List[str] = []
    confidence: str  # "low", "medium", "high"
    method: str  # "gemini" or "heuristic"
    error: Optional[str] = None

# ============================================
# FASTAPI APP
# ============================================

app = FastAPI(
    title="Silenced by the Algorithm - Backend",
    description="Python backend for transcript fetching and Gemini AI analysis",
    version="1.0.0"
)

# CORS - allow extension to call this
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to extension origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# TRANSCRIPT FETCHING
# ============================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "gemini_available": GEMINI_AVAILABLE and bool(GEMINI_API_KEY),
        "youtube_api_available": bool(YOUTUBE_API_KEY)
    }

@app.post("/transcript", response_model=TranscriptResponse)
async def get_transcript(request: TranscriptRequest):
    """
    Fetch YouTube video transcript using youtube-transcript-api v1.2+
    
    This bypasses CORS issues that the Chrome extension faces.
    """
    video_id = request.video_id
    languages = request.languages
    
    logger.info(f"Fetching transcript for video: {video_id}")
    
    try:
        # Create API instance (new in v1.2+)
        api = YouTubeTranscriptApi()
        
        # Try to fetch transcript directly with preferred languages
        transcript_data = None
        used_language = None
        
        # Try each preferred language
        for lang in languages:
            try:
                transcript_data = api.fetch(video_id, languages=[lang])
                used_language = lang
                break
            except (NoTranscriptFound, Exception):
                continue
        
        # If no preferred language found, try without language filter
        if transcript_data is None:
            try:
                transcript_data = api.fetch(video_id)
                used_language = 'auto'
            except NoTranscriptFound:
                return TranscriptResponse(
                    success=False,
                    video_id=video_id,
                    error="No transcript available for this video"
                )
        
        if transcript_data is None or len(transcript_data) == 0:
            return TranscriptResponse(
                success=False,
                video_id=video_id,
                error="Empty transcript returned"
            )
        
        # Combine into text (v1.2+ uses .text attribute instead of ['text'])
        full_text = " ".join([entry.text for entry in transcript_data])
        
        # Calculate total duration
        total_duration = 0
        if transcript_data:
            last_entry = transcript_data[-1]
            total_duration = last_entry.start + last_entry.duration
        
        logger.info(f"Successfully fetched transcript for {video_id}: {len(full_text)} chars, {used_language}")
        
        return TranscriptResponse(
            success=True,
            video_id=video_id,
            transcript=full_text,
            language=used_language,
            duration_seconds=total_duration
        )
        
    except TranscriptsDisabled:
        return TranscriptResponse(
            success=False,
            video_id=video_id,
            error="Transcripts are disabled for this video"
        )
    except VideoUnavailable:
        return TranscriptResponse(
            success=False,
            video_id=video_id,
            error="Video is unavailable"
        )
    except Exception as e:
        logger.error(f"Error fetching transcript for {video_id}: {str(e)}")
        return TranscriptResponse(
            success=False,
            video_id=video_id,
            error=str(e)
        )

@app.get("/transcript/{video_id}")
async def get_transcript_simple(
    video_id: str,
    lang: str = Query(default="en", description="Preferred language code")
):
    """Simple GET endpoint for transcript fetching"""
    return await get_transcript(TranscriptRequest(video_id=video_id, languages=[lang, "en", "en-US"]))

# ============================================
# QUALITY SCORING
# ============================================

QUALITY_PROMPT = """You are a video quality analyst. Score this video for relevance and quality.

VIDEO INFO:
Title: {title}
Channel: {channel}
Subscribers: {subs}
Search Query/Topic: {query}

{transcript_section}

Analyze and return JSON with:
{{
  "relevance_score": <0-100 how relevant to the search query>,
  "quality_score": <0-100 based on production quality, depth, expertise>,
  "content_depth_score": <0-100 based on transcript analysis, null if no transcript>,
  "reason": "<brief explanation>",
  "flags": ["<list of quality indicators or concerns>"]
}}

Consider:
- Relevance: Does it actually address the topic?
- Quality: Is it well-produced? Expert perspective?
- Depth: Does it provide real value, not just clickbait?
- Red flags: Clickbait, misleading title, low effort content

Respond with ONLY valid JSON."""

def score_quality_heuristic(
    title: str,
    description: str,
    transcript: Optional[str],
    channel: str,
    subs: int,
    query: str
) -> Dict[str, Any]:
    """Heuristic-based quality scoring fallback"""
    
    title_lower = title.lower()
    desc_lower = (description or "").lower()
    query_lower = query.lower()
    full_text = f"{title_lower} {desc_lower}"
    
    # Relevance scoring
    relevance_score = 0.5  # Base
    query_words = query_lower.split()
    
    # Check title match
    title_matches = sum(1 for word in query_words if word in title_lower and len(word) > 2)
    if title_matches > 0:
        relevance_score += min(0.3, title_matches * 0.1)
    
    # Check description match
    desc_matches = sum(1 for word in query_words if word in desc_lower and len(word) > 2)
    if desc_matches > 0:
        relevance_score += min(0.2, desc_matches * 0.05)
    
    # Quality scoring
    quality_score = 0.5  # Base
    flags = []
    
    # Positive signals
    if subs > 1000:
        quality_score += 0.1
        flags.append("Established channel")
    
    if len(description or "") > 200:
        quality_score += 0.1
        flags.append("Detailed description")
    
    # Negative signals (clickbait)
    clickbait_patterns = [
        'you won\'t believe', 'shocking', 'insane', '!!!',
        'gone wrong', 'exposed', 'clickbait', '😱', '🤯'
    ]
    
    clickbait_count = sum(1 for p in clickbait_patterns if p in full_text)
    if clickbait_count > 0:
        quality_score -= min(0.2, clickbait_count * 0.1)
        flags.append(f"Potential clickbait ({clickbait_count} indicators)")
    
    # ALL CAPS title
    if title.isupper() and len(title) > 10:
        quality_score -= 0.1
        flags.append("ALL CAPS title")
    
    # Content depth from transcript
    content_depth = None
    if transcript and len(transcript) > 500:
        content_depth = 0.5
        
        # Longer transcript = more depth
        if len(transcript) > 2000:
            content_depth += 0.2
        if len(transcript) > 5000:
            content_depth += 0.1
        
        # Educational indicators
        edu_terms = ['research', 'study', 'data', 'evidence', 'according to', 'explains']
        edu_count = sum(1 for t in edu_terms if t in transcript.lower())
        if edu_count >= 2:
            content_depth += 0.2
            flags.append("Contains educational content")
    
    # Clamp scores
    relevance_score = max(0, min(1, relevance_score))
    quality_score = max(0, min(1, quality_score))
    if content_depth:
        content_depth = max(0, min(1, content_depth))
    
    # Combined score
    combined = relevance_score * 0.4 + quality_score * 0.4
    if content_depth:
        combined = relevance_score * 0.3 + quality_score * 0.3 + content_depth * 0.4
    
    return {
        "relevance_score": round(relevance_score, 2),
        "quality_score": round(quality_score, 2),
        "content_depth_score": round(content_depth, 2) if content_depth else None,
        "combined_score": round(combined, 2),
        "reason": "Heuristic analysis based on title, description, and transcript patterns",
        "flags": flags,
        "method": "heuristic-transcript" if transcript else "heuristic"
    }

async def score_quality_gemini(
    title: str,
    description: str,
    transcript: Optional[str],
    channel: str,
    subs: int,
    query: str
) -> Optional[Dict[str, Any]]:
    """Gemini-based quality scoring"""
    
    if not GEMINI_AVAILABLE or not GEMINI_API_KEY:
        return None
    
    try:
        model = genai.GenerativeModel('gemini-2.0-flash')
        
        transcript_section = ""
        if transcript:
            # Limit transcript to avoid token limits
            truncated = transcript[:8000]
            transcript_section = f"TRANSCRIPT EXCERPT:\n{truncated}\n"
        
        prompt = QUALITY_PROMPT.format(
            title=title,
            channel=channel,
            subs=subs,
            query=query,
            transcript_section=transcript_section
        )
        
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.2,
                max_output_tokens=500
            )
        )
        
        # Parse JSON response
        response_text = response.text.strip()
        
        # Clean markdown code blocks if present
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]
        response_text = response_text.strip()
        
        result = json.loads(response_text)
        
        # Normalize scores to 0-1
        relevance = result.get("relevance_score", 50) / 100
        quality = result.get("quality_score", 50) / 100
        depth = result.get("content_depth_score")
        if depth is not None:
            depth = depth / 100
        
        # Combined score
        if depth:
            combined = relevance * 0.3 + quality * 0.3 + depth * 0.4
        else:
            combined = relevance * 0.5 + quality * 0.5
        
        return {
            "relevance_score": round(relevance, 2),
            "quality_score": round(quality, 2),
            "content_depth_score": round(depth, 2) if depth else None,
            "combined_score": round(combined, 2),
            "reason": result.get("reason", "AI analysis"),
            "flags": result.get("flags", []),
            "method": "gemini-transcript" if transcript else "gemini"
        }
        
    except Exception as e:
        logger.error(f"Gemini quality scoring failed: {str(e)}")
        return None

@app.post("/quality-score", response_model=QualityScoreResponse)
async def score_video_quality(request: QualityScoreRequest):
    """
    Score video quality using Gemini AI with heuristic fallback
    """
    logger.info(f"Scoring quality for video: {request.video_id}")
    
    # Try Gemini first
    gemini_result = await score_quality_gemini(
        title=request.title,
        description=request.description,
        transcript=request.transcript,
        channel=request.channel_title,
        subs=request.subscriber_count,
        query=request.query
    )
    
    if gemini_result:
        return QualityScoreResponse(
            success=True,
            video_id=request.video_id,
            **gemini_result
        )
    
    # Fallback to heuristic
    heuristic_result = score_quality_heuristic(
        title=request.title,
        description=request.description,
        transcript=request.transcript,
        channel=request.channel_title,
        subs=request.subscriber_count,
        query=request.query
    )
    
    return QualityScoreResponse(
        success=True,
        video_id=request.video_id,
        **heuristic_result
    )

# ============================================
# GREENWASHING DETECTION
# ============================================

GREENWASHING_PROMPT = """You are an expert sustainability analyst detecting greenwashing.

Analyze this content:
Title: {title}
Description: {description}

{transcript_section}

Return JSON with:
{{
  "transparency_score": <0-100, higher = more transparent>,
  "flags": [
    {{"type": "positive|warning|risk", "text": "description", "evidence": "quote if any"}}
  ]
}}

Look for:
- Vague terms: "eco-friendly", "green", "natural" without specifics
- Missing evidence for claims
- Hidden trade-offs
- Corporate marketing without substance
- False impressions or certifications

Respond with ONLY valid JSON."""

SUSTAINABILITY_KEYWORDS = [
    'climate', 'sustainable', 'sustainability', 'esg', 'carbon',
    'renewable', 'green energy', 'clean energy', 'environment',
    'eco-friendly', 'biodiversity', 'emissions', 'net zero'
]

GREENWASH_SIGNALS = [
    'carbon neutral', 'net-zero by', '100% sustainable', 'eco-friendly',
    'green', 'clean', 'natural', 'planet-friendly', 'offsetting'
]

EVIDENCE_SIGNALS = [
    'data shows', 'research', 'study', 'peer-reviewed', 'ipcc',
    'measured', 'verified', 'third-party audit', 'methodology'
]

def detect_greenwashing_heuristic(
    title: str,
    description: str,
    transcript: Optional[str],
    subs: int
) -> Dict[str, Any]:
    """Heuristic-based greenwashing detection"""
    
    full_text = f"{title} {description or ''} {transcript or ''}".lower()
    
    flags = []
    risk_score = 0
    
    # Count signals
    vague_count = sum(1 for s in GREENWASH_SIGNALS if s in full_text)
    evidence_count = sum(1 for s in EVIDENCE_SIGNALS if s in full_text)
    
    # Vague terms without evidence
    if vague_count > 0 and evidence_count == 0:
        risk_score += 40
        flags.append({
            "type": "warning",
            "text": f"Found {vague_count} vague sustainability term(s) without evidence"
        })
    elif vague_count > evidence_count * 2:
        risk_score += 25
        flags.append({
            "type": "warning",
            "text": f"More vague claims ({vague_count}) than evidence ({evidence_count})"
        })
    
    # Large channel making sustainability claims
    if subs > 1000000 and vague_count > 0:
        risk_score += 20
        flags.append({
            "type": "risk",
            "text": "Large channel making sustainability claims - verify independence"
        })
    
    # Positive signals
    if evidence_count >= 2:
        flags.append({
            "type": "positive",
            "text": "Contains evidence-based language"
        })
        risk_score -= 15
    
    # Missing metrics
    has_numbers = any(c.isdigit() for c in full_text)
    if vague_count > 0 and not has_numbers:
        risk_score += 15
        flags.append({
            "type": "warning",
            "text": "Sustainability claims without specific metrics"
        })
    
    # Calculate transparency score (inverse of risk)
    transparency_score = max(0, min(100, 100 - risk_score))
    
    # Risk level
    risk_level = "low"
    if transparency_score < 40:
        risk_level = "high"
    elif transparency_score < 70:
        risk_level = "medium"
    
    return {
        "transparency_score": transparency_score,
        "risk_level": risk_level,
        "flags": flags,
        "method": "heuristic"
    }

async def detect_greenwashing_gemini(
    title: str,
    description: str,
    transcript: Optional[str]
) -> Optional[Dict[str, Any]]:
    """Gemini-based greenwashing detection"""
    
    if not GEMINI_AVAILABLE or not GEMINI_API_KEY:
        return None
    
    try:
        model = genai.GenerativeModel('gemini-2.0-flash')
        
        transcript_section = ""
        if transcript:
            truncated = transcript[:6000]
            transcript_section = f"TRANSCRIPT EXCERPT:\n{truncated}\n"
        
        prompt = GREENWASHING_PROMPT.format(
            title=title,
            description=description or "No description",
            transcript_section=transcript_section
        )
        
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.2,
                max_output_tokens=500
            )
        )
        
        response_text = response.text.strip()
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]
        response_text = response_text.strip()
        
        result = json.loads(response_text)
        
        transparency = result.get("transparency_score", 50)
        risk_level = "low" if transparency >= 70 else "medium" if transparency >= 40 else "high"
        
        return {
            "transparency_score": transparency,
            "risk_level": risk_level,
            "flags": result.get("flags", []),
            "method": "gemini"
        }
        
    except Exception as e:
        logger.error(f"Gemini greenwashing detection failed: {str(e)}")
        return None

@app.post("/greenwashing", response_model=GreenwashingResponse)
async def detect_greenwashing(request: GreenwashingRequest):
    """
    Detect greenwashing in sustainability content (KPMG challenge)
    """
    logger.info(f"Analyzing greenwashing for video: {request.video_id}")
    
    # Check if content is sustainability-related
    full_text = f"{request.title} {request.description or ''}".lower()
    is_sustainability = any(kw in full_text for kw in SUSTAINABILITY_KEYWORDS)
    
    if not is_sustainability:
        return GreenwashingResponse(
            success=True,
            video_id=request.video_id,
            transparency_score=100,
            risk_level="low",
            flags=[{"type": "info", "text": "Not sustainability-related content"}],
            method="skip"
        )
    
    # Try Gemini first
    gemini_result = await detect_greenwashing_gemini(
        title=request.title,
        description=request.description,
        transcript=request.transcript
    )
    
    if gemini_result:
        return GreenwashingResponse(
            success=True,
            video_id=request.video_id,
            **gemini_result
        )
    
    # Fallback to heuristic
    heuristic_result = detect_greenwashing_heuristic(
        title=request.title,
        description=request.description,
        transcript=request.transcript,
        subs=request.channel_subscriber_count
    )
    
    return GreenwashingResponse(
        success=True,
        video_id=request.video_id,
        **heuristic_result
    )

# ============================================
# BIAS RECEIPT GENERATION
# ============================================

@app.post("/bias-receipt", response_model=BiasReceiptResponse)
async def generate_bias_receipt(request: BiasReceiptRequest):
    """
    Generate explainability receipt for why a video was surfaced
    """
    logger.info(f"Generating bias receipt for video: {request.video_id}")
    
    why_not_shown = []
    why_surfaced = []
    
    # Why not shown (barriers to visibility)
    if request.subscriber_count < 10000:
        why_not_shown.append("Channel has under 10K subscribers, limiting algorithmic reach")
    elif request.subscriber_count < 50000:
        why_not_shown.append("Channel size (under 50K) may limit recommendation visibility")
    elif request.subscriber_count < 100000:
        why_not_shown.append("Mid-sized channel may receive less algorithmic priority")
    
    if request.topic_concentration > 70:
        why_not_shown.append(f"Topic is {request.topic_concentration}% dominated by top 10 channels")
    
    if request.views_per_day < 100 and request.subscriber_count > 1000:
        why_not_shown.append("Lower view velocity may reduce recommendation frequency")
    
    # Why surfaced (positive signals)
    if request.subscriber_count < 100000:
        why_surfaced.append("Under-represented creator deserving more visibility")
    
    if request.engagement_ratio > 0.05:
        why_surfaced.append(f"High engagement ratio ({request.engagement_ratio:.1%}) indicates quality content")
    
    if request.subscriber_count < request.avg_subs_in_topic * 0.5:
        why_surfaced.append("Smaller than average for this topic - surfaced to balance representation")
    
    why_surfaced.append("Content matches search topic and passed quality filters")
    
    # Confidence based on available data
    confidence = "medium"
    if len(why_not_shown) >= 2 and len(why_surfaced) >= 2:
        confidence = "high"
    elif len(why_not_shown) == 0 or len(why_surfaced) <= 1:
        confidence = "low"
    
    return BiasReceiptResponse(
        success=True,
        video_id=request.video_id,
        why_not_shown=why_not_shown[:4],
        why_surfaced=why_surfaced[:4],
        confidence=confidence,
        method="heuristic"  # Could add Gemini enhancement here
    )

# ============================================
# COMBINED ANALYSIS ENDPOINT
# ============================================

class FullAnalysisRequest(BaseModel):
    video_id: str
    title: str
    description: Optional[str] = ""
    channel_title: Optional[str] = ""
    subscriber_count: Optional[int] = 0
    query: Optional[str] = ""
    fetch_transcript: bool = True

class FullAnalysisResponse(BaseModel):
    success: bool
    video_id: str
    transcript: Optional[TranscriptResponse] = None
    quality: Optional[QualityScoreResponse] = None
    greenwashing: Optional[GreenwashingResponse] = None
    error: Optional[str] = None

@app.post("/analyze", response_model=FullAnalysisResponse)
async def full_analysis(request: FullAnalysisRequest):
    """
    Combined endpoint: fetch transcript + quality score + greenwashing detection
    
    This is the main endpoint for the Chrome extension to call.
    """
    logger.info(f"Full analysis for video: {request.video_id}")
    
    transcript_text = None
    transcript_response = None
    
    # Step 1: Fetch transcript
    if request.fetch_transcript:
        transcript_response = await get_transcript(
            TranscriptRequest(video_id=request.video_id)
        )
        if transcript_response.success:
            transcript_text = transcript_response.transcript
    
    # Step 2: Quality scoring
    quality_response = await score_video_quality(
        QualityScoreRequest(
            video_id=request.video_id,
            title=request.title,
            description=request.description,
            transcript=transcript_text,
            channel_title=request.channel_title,
            subscriber_count=request.subscriber_count,
            query=request.query
        )
    )
    
    # Step 3: Greenwashing detection
    greenwashing_response = await detect_greenwashing(
        GreenwashingRequest(
            video_id=request.video_id,
            title=request.title,
            description=request.description,
            transcript=transcript_text,
            channel_subscriber_count=request.subscriber_count
        )
    )
    
    return FullAnalysisResponse(
        success=True,
        video_id=request.video_id,
        transcript=transcript_response,
        quality=quality_response,
        greenwashing=greenwashing_response
    )

# ============================================
# MAIN
# ============================================

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
