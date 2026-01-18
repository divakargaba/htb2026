# Underrepresented Video Discovery Algorithm Analysis

## Overview
The algorithm identifies videos from smaller/underrepresented creators that are high-quality but algorithmically suppressed. It's implemented in the `runNoiseCancellation()` function in `extension/background.js`.

## Key Components

### 1. **Channel Identification Phase** (Lines 2958-2979)

**Primary Threshold:**
- `MAX_SUBSCRIBER_THRESHOLD = 100,000` subscribers
- Channels **under 100K** are considered "silenced voices"
- Channels **≥ 100K** are considered "noisy channels"

**Fallback Logic:**
- If no channels under 100K are found, falls back to channels between 100K-500K
- This ensures results even in topics dominated by large channels

**Exposure Tiers:**
```javascript
if (subs < 10,000)  → 'under-represented'
if (subs < 50,000)  → 'emerging'
if (subs < 100,000) → 'established'
```

### 2. **Rising Signal Detection** (Lines 2981-2988)

Identifies channels that outperform their size:
```javascript
risingSignals = channels where (avgViews / subscribers) > 2
```
- High average views relative to subscriber count suggests quality content
- These get priority in the final ranking

### 3. **Pre-Filtering** (Lines 3042-3091)

Hard filters to remove spam/low-quality content:
- **Shorts**: Blocks videos with `#shorts` or `#short` in title
- **Spam patterns**: Regex patterns for FREE DOWNLOAD, SCAM, excessive emojis, etc.
- **Title length**: Minimum 10 characters
- **Zero subscribers**: Blocks channels with 0 subs
- **New channels**: Blocks channels with < 3 videos

### 4. **Quality Scoring System** (Two-Pass Approach)

#### **Pass 1: Quick Heuristic Scoring** (Lines 1529-1545)
Scores top 15 videos quickly using:
- **Relevance (30-60% weight)**: Query term matching in title/description
- **Quality signals (20-40% weight)**:
  - Title length (15-120 chars ideal)
  - Description length (>50 chars, >200 preferred)
  - Clickbait detection (negative signals)
  - Channel name quality (not spammy)
  - Educational signals (documentary, tutorial, analysis, etc.)

#### **Pass 2: Deep Analysis** (Lines 1554-1588)
For top 5-10 candidates, fetches transcripts and performs:
- **Content Depth Analysis**:
  - Query term matching in transcript (more reliable than title)
  - Educational speech patterns detection
  - Transcript length check (>5000 chars = more in-depth)
  - Repetition detection (penalizes music/lyrics)

**Scoring Formula:**
```javascript
// With transcript:
score = (contentDepth * 0.5) + (relevance * 0.3) + (quality * 0.2)

// Without transcript:
score = (relevance * 0.6) + (quality * 0.4)
```

### 5. **Quality Threshold Filtering** (Lines 3104-3127)

**Dynamic Thresholds:**
- **AI Online**: `MIN_VIDEO_QUALITY_SCORE_AI = 0.55` (55%)
- **AI Offline**: `MIN_VIDEO_QUALITY_SCORE_HEURISTIC = 0.72` (72% - stricter)

**Safety Fallback:**
- If threshold removes ALL videos, falls back to top 5 highest-scoring videos
- Ensures results even with very strict filtering

### 6. **Final Ranking** (Lines 3222-3234)

Combines multiple factors:
```javascript
// Priority 1: Rising signals (get boosted)
if (a.isRisingSignal && !b.isRisingSignal) return -1

// Priority 2: Combined quality + engagement score
score = (qualityScore * 0.7) + (engagementRatio * 0.3)
```

**Engagement Proxy:**
```javascript
engagementRatio = (avgViews / videoCount) / subscribers
```

### 7. **Additional Metrics Calculated**

**Bias Snapshot:**
- `topicConcentration`: % of subscribers in top 10 channels
- `underAmplifiedRate`: % of channels under 100K
- `dominantCount`: Number of channels > 1M subscribers
- `avgSubscribers`: Average subscriber count in topic

**Why Surfaced Reasons:**
- Size comparison to topic average
- Engagement ratio strength
- Transcript verification
- Rising signal status
- Under-representation indicators

## Algorithm Flow Summary

```
1. Search topic → Get 50 videos
2. Fetch channel data for all videos
3. Split channels: <100K (silenced) vs ≥100K (noisy)
4. Identify rising signals (avgViews/subscribers > 2)
5. Filter videos from silenced channels
6. Apply hard pre-filters (spam, shorts, etc.)
7. Two-pass quality scoring:
   - Pass 1: Quick heuristic (top 15)
   - Pass 2: Deep transcript analysis (top 5)
8. Apply quality threshold filter (55% or 72%)
9. Sort by: rising signal → quality+engagement score
10. Return top 10-12 videos with metadata
```

## Key Design Decisions

1. **Subscriber Threshold (100K)**: Balances finding small creators while avoiding noise
2. **Two-Pass Scoring**: Performance optimization - only analyze transcripts for top candidates
3. **Dynamic Thresholds**: Stricter when AI offline to prevent low-quality results
4. **Rising Signal Priority**: Boosts videos that perform well relative to channel size
5. **Fallback Mechanisms**: Multiple fallbacks ensure results even in edge cases

## Potential Improvements

1. **Tier-Based Thresholds**: Different thresholds for different exposure tiers
2. **Topic-Specific Adjustments**: Adapt thresholds based on topic competitiveness
3. **Temporal Signals**: Consider recent growth trends, not just static metrics
4. **Diversity Metrics**: Track creator diversity (geographic, demographic, etc.)
