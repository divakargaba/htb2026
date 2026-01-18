/**
 * Transcript Analysis Module
 * 
 * Fetches and analyzes YouTube video transcripts:
 * - WPM (words per minute) calculation
 * - Hook density in first 120 seconds
 * - Cliffhanger frequency
 * - Concept density (unique nouns per minute)
 * - Source citation counting
 * - Structured explanation markers
 * - Title-transcript mismatch detection
 */

;(function() {
'use strict';

// ============================================
// CONSTANTS
// ============================================

const TRANSCRIPT_CACHE = new Map()
const TRANSCRIPT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

// Hook phrases that grab attention in first 2 minutes
const HOOK_PHRASES = [
  /\b(today|in this video)\b/i,
  /\b(i'm going to|we're going to|let me)\b/i,
  /\b(you need to|you have to|you should)\b/i,
  /\b(secret|trick|hack|tip)\b/i,
  /\b(amazing|incredible|insane|crazy)\b/i,
  /\b(but first|before we|wait)\b/i,
  /\b(here's (the thing|why|what))\b/i,
  /\b(the truth is|the reality is)\b/i,
  /\b(most people don't|nobody tells you)\b/i
]

// Cliffhanger patterns
const CLIFFHANGER_PHRASES = [
  /\b(but wait|hold on|stay tuned)\b/i,
  /\b(coming up|later in|at the end)\b/i,
  /\b(you won't believe|what happens next)\b/i,
  /\b(keep watching|don't go anywhere)\b/i,
  /\b(the best part|the crazy thing)\b/i,
  /\b(and then|but then)\b/i,
  /\b(here's where|this is where)\b/i
]

// Source citation patterns
const SOURCE_PATTERNS = [
  /according to/i,
  /\bstudy (shows?|found|suggests?)\b/i,
  /\bresearch (shows?|indicates?|suggests?)\b/i,
  /\bdata (shows?|indicates?|suggests?)\b/i,
  /\bscientists? (say|found|discovered)\b/i,
  /\bexperts? (say|believe|suggest)\b/i,
  /\breport(ed)? (by|from|that)\b/i,
  /\bpublished (in|by)\b/i,
  /\buniversity of\b/i,
  /\bjournal of\b/i,
  /https?:\/\/\S+/i,
  /\bsource:?\s/i
]

// Structured explanation markers
const STRUCTURE_MARKERS = [
  /\b(first|firstly|first of all)\b/i,
  /\b(second|secondly|next)\b/i,
  /\b(third|thirdly|then)\b/i,
  /\b(finally|lastly|last)\b/i,
  /\b(step \d+|number \d+)\b/i,
  /\b(here's why|here's how|here's what)\b/i,
  /\b(in summary|to summarize|in conclusion)\b/i,
  /\b(the reason is|the point is)\b/i,
  /\b(for example|for instance)\b/i,
  /\b(in other words|that means)\b/i
]

// ============================================
// TRANSCRIPT FETCHING
// ============================================

/**
 * Fetch transcript from YouTube timedtext endpoint
 * No API quota required
 */
async function fetchTranscript(videoId) {
  // Check cache first
  const cached = TRANSCRIPT_CACHE.get(videoId)
  if (cached && Date.now() - cached.timestamp < TRANSCRIPT_CACHE_TTL) {
    return cached.data
  }
  
  const languages = ['en', 'en-US', 'en-GB', 'en-AU', '']
  
  for (const lang of languages) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`
      const response = await fetch(url)
      
      if (!response.ok) continue
      
      const data = await response.json()
      
      if (data.events && data.events.length > 0) {
        const transcript = extractTranscriptText(data.events)
        
        if (transcript.text.length > 100) {
          // Cache the result
          TRANSCRIPT_CACHE.set(videoId, {
            data: transcript,
            timestamp: Date.now()
          })
          
          return transcript
        }
      }
    } catch (error) {
      console.warn(`[Transcript] Failed to fetch for ${videoId} (${lang}):`, error.message)
    }
  }
  
  // Try alternative method: scrape from page
  try {
    const altTranscript = await fetchTranscriptAlternative(videoId)
    if (altTranscript) {
      TRANSCRIPT_CACHE.set(videoId, {
        data: altTranscript,
        timestamp: Date.now()
      })
      return altTranscript
    }
  } catch (error) {
    console.warn('[Transcript] Alternative fetch failed:', error.message)
  }
  
  return null
}

/**
 * Extract text and timing from transcript events
 */
function extractTranscriptText(events) {
  const segments = []
  let fullText = ''
  let totalDuration = 0
  
  for (const event of events) {
    if (!event.segs) continue
    
    const startTime = event.tStartMs || 0
    const duration = event.dDurationMs || 0
    
    const segmentText = event.segs
      .map(seg => seg.utf8 || '')
      .join('')
      .trim()
    
    if (segmentText) {
      segments.push({
        text: segmentText,
        startMs: startTime,
        durationMs: duration
      })
      
      fullText += segmentText + ' '
      totalDuration = Math.max(totalDuration, startTime + duration)
    }
  }
  
  return {
    text: fullText.trim().replace(/\s+/g, ' '),
    segments,
    durationMs: totalDuration,
    durationMinutes: totalDuration / 60000
  }
}

/**
 * Alternative transcript fetch method
 */
async function fetchTranscriptAlternative(videoId) {
  // This would require parsing the YouTube page
  // For now, return null as fallback
  return null
}

// ============================================
// ANALYSIS FUNCTIONS
// ============================================

/**
 * Calculate words per minute
 */
function calculateWPM(transcript) {
  if (!transcript || !transcript.text) {
    return { wpm: 0, analyzed: false }
  }
  
  const wordCount = transcript.text.split(/\s+/).length
  const durationMinutes = transcript.durationMinutes || 1
  
  const wpm = Math.round(wordCount / durationMinutes)
  
  // Typical speech: 120-150 WPM
  // Fast speech: 150-180 WPM
  // Very fast: 180+ WPM
  
  let pace = 'normal'
  if (wpm > 180) pace = 'very_fast'
  else if (wpm > 150) pace = 'fast'
  else if (wpm < 100) pace = 'slow'
  
  return {
    wpm,
    wordCount,
    durationMinutes,
    pace,
    analyzed: true
  }
}

/**
 * Analyze hook density in first 120 seconds
 */
function analyzeHookDensity(transcript) {
  if (!transcript || !transcript.segments) {
    return { hookDensity: 0, hookCount: 0, analyzed: false }
  }
  
  // Get text from first 120 seconds
  const first120Seconds = transcript.segments
    .filter(seg => seg.startMs < 120000)
    .map(seg => seg.text)
    .join(' ')
  
  let hookCount = 0
  const hooksFound = []
  
  for (const pattern of HOOK_PHRASES) {
    const matches = first120Seconds.match(new RegExp(pattern, 'gi'))
    if (matches) {
      hookCount += matches.length
      hooksFound.push(...matches)
    }
  }
  
  // Calculate density (hooks per 100 words)
  const wordCount = first120Seconds.split(/\s+/).length || 1
  const hookDensity = (hookCount / wordCount) * 100
  
  return {
    hookDensity: Math.round(hookDensity * 100) / 100,
    hookCount,
    hooksFound: [...new Set(hooksFound)].slice(0, 5),
    first120WordCount: wordCount,
    analyzed: true
  }
}

/**
 * Count cliffhanger patterns
 */
function analyzeCliffhangers(transcript) {
  if (!transcript || !transcript.text) {
    return { cliffhangerCount: 0, analyzed: false }
  }
  
  let count = 0
  const found = []
  
  for (const pattern of CLIFFHANGER_PHRASES) {
    const matches = transcript.text.match(new RegExp(pattern, 'gi'))
    if (matches) {
      count += matches.length
      found.push(...matches)
    }
  }
  
  return {
    cliffhangerCount: count,
    cliffhangersFound: [...new Set(found)].slice(0, 5),
    analyzed: true
  }
}

/**
 * Calculate concept density (unique meaningful words per minute)
 */
function analyzeConceptDensity(transcript) {
  if (!transcript || !transcript.text) {
    return { conceptDensity: 0, analyzed: false }
  }
  
  // Common words to exclude
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
    'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all',
    'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
    'now', 'here', 'there', 'then', 'if', 'because', 'as', 'until', 'while',
    'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'again', 'further', 'once', 'really', 'actually',
    'going', 'know', 'like', 'think', 'want', 'see', 'look', 'make', 'get',
    'got', 'go', 'come', 'take', 'say', 'said', 'thing', 'things', 'way',
    'even', 'well', 'back', 'still', 'much', 'something', 'anything'
  ])
  
  // Extract words
  const words = transcript.text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
  
  // Count unique words
  const uniqueWords = new Set(words)
  const durationMinutes = transcript.durationMinutes || 1
  
  const conceptDensity = uniqueWords.size / durationMinutes
  
  // Get top concepts (most frequent meaningful words)
  const wordFreq = {}
  for (const word of words) {
    wordFreq[word] = (wordFreq[word] || 0) + 1
  }
  
  const topConcepts = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }))
  
  return {
    conceptDensity: Math.round(conceptDensity),
    uniqueWordCount: uniqueWords.size,
    totalMeaningfulWords: words.length,
    topConcepts,
    analyzed: true
  }
}

/**
 * Count source citations
 */
function analyzeSourceCitations(transcript) {
  if (!transcript || !transcript.text) {
    return { sourceCitations: 0, analyzed: false }
  }
  
  let count = 0
  const found = []
  
  for (const pattern of SOURCE_PATTERNS) {
    const matches = transcript.text.match(new RegExp(pattern, 'gi'))
    if (matches) {
      count += matches.length
      found.push(...matches)
    }
  }
  
  // Check for URLs
  const urlMatches = transcript.text.match(/https?:\/\/\S+/gi)
  if (urlMatches) {
    count += urlMatches.length
  }
  
  return {
    sourceCitations: count,
    citationsFound: [...new Set(found)].slice(0, 5),
    hasUrls: urlMatches && urlMatches.length > 0,
    analyzed: true
  }
}

/**
 * Count structured explanation markers
 */
function analyzeStructuredExplanations(transcript) {
  if (!transcript || !transcript.text) {
    return { structuredExplanations: 0, analyzed: false }
  }
  
  let count = 0
  const found = []
  
  for (const pattern of STRUCTURE_MARKERS) {
    const matches = transcript.text.match(new RegExp(pattern, 'gi'))
    if (matches) {
      count += matches.length
      found.push(...matches)
    }
  }
  
  // Check for numbered lists
  const numberedMatches = transcript.text.match(/\b(number|step|point|reason|tip|way)\s*\d+\b/gi)
  if (numberedMatches) {
    count += numberedMatches.length
  }
  
  return {
    structuredExplanations: count,
    markersFound: [...new Set(found)].slice(0, 5),
    isWellStructured: count >= 5,
    analyzed: true
  }
}

/**
 * Calculate title-transcript mismatch score
 */
function analyzeTitleMismatch(title, transcript) {
  if (!title || !transcript || !transcript.text) {
    return { titleMismatchScore: 0, analyzed: false }
  }
  
  const titleLower = title.toLowerCase()
  const transcriptLower = transcript.text.toLowerCase()
  
  // Extract key terms from title (words > 3 chars, not common)
  const titleWords = titleLower
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
  
  // Check how many title words appear in transcript
  let matchCount = 0
  const matchedWords = []
  const unmatchedWords = []
  
  for (const word of titleWords) {
    if (transcriptLower.includes(word)) {
      matchCount++
      matchedWords.push(word)
    } else {
      unmatchedWords.push(word)
    }
  }
  
  const matchRatio = titleWords.length > 0 ? matchCount / titleWords.length : 1
  
  // Check for specific red flags
  const titleHasNumber = /\d+/.test(title)
  const transcriptHasNumber = /\d+/.test(transcript.text)
  const numberMismatch = titleHasNumber && !transcriptHasNumber
  
  // Check for extreme language in title but not in content
  const extremeInTitle = /\b(insane|crazy|unbelievable|shocking)\b/i.test(title)
  const extremeInTranscript = /\b(insane|crazy|unbelievable|shocking)\b/i.test(transcript.text)
  const toneMismatch = extremeInTitle && !extremeInTranscript
  
  // Calculate mismatch score
  let mismatchScore = Math.round((1 - matchRatio) * 60)
  if (numberMismatch) mismatchScore += 20
  if (toneMismatch) mismatchScore += 20
  
  return {
    titleMismatchScore: Math.min(100, mismatchScore),
    matchRatio: Math.round(matchRatio * 100),
    matchedWords,
    unmatchedWords,
    numberMismatch,
    toneMismatch,
    analyzed: true
  }
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

/**
 * Full transcript analysis
 */
async function analyzeTranscript(videoId, title = null) {
  const transcript = await fetchTranscript(videoId)
  
  if (!transcript) {
    return {
      available: false,
      analyzed: false,
      error: 'Transcript not available'
    }
  }
  
  // Run all analyses
  const wpm = calculateWPM(transcript)
  const hooks = analyzeHookDensity(transcript)
  const cliffhangers = analyzeCliffhangers(transcript)
  const concepts = analyzeConceptDensity(transcript)
  const sources = analyzeSourceCitations(transcript)
  const structure = analyzeStructuredExplanations(transcript)
  
  // Title mismatch (if title provided)
  const mismatch = title ? analyzeTitleMismatch(title, transcript) : null
  
  // Calculate overall quality indicators
  const qualityScore = calculateTranscriptQuality({
    wpm,
    hooks,
    cliffhangers,
    concepts,
    sources,
    structure
  })
  
  return {
    available: true,
    analyzed: true,
    transcript: {
      text: transcript.text.substring(0, 1000) + '...', // First 1000 chars for reference
      durationMinutes: transcript.durationMinutes,
      wordCount: wpm.wordCount
    },
    wpm: wpm.wpm,
    pace: wpm.pace,
    hookDensity: hooks.hookDensity,
    hookCount: hooks.hookCount,
    cliffhangerCount: cliffhangers.cliffhangerCount,
    conceptDensity: concepts.conceptDensity,
    topConcepts: concepts.topConcepts,
    sourceCitations: sources.sourceCitations,
    structuredExplanations: structure.structuredExplanations,
    isWellStructured: structure.isWellStructured,
    titleMismatchScore: mismatch?.titleMismatchScore || 0,
    titleMismatch: mismatch,
    qualityScore,
    breakdown: {
      wpm,
      hooks,
      cliffhangers,
      concepts,
      sources,
      structure
    }
  }
}

/**
 * Calculate overall transcript quality score
 */
function calculateTranscriptQuality(analyses) {
  let score = 50 // Base score
  
  // Positive signals
  if (analyses.sources.sourceCitations > 0) {
    score += Math.min(20, analyses.sources.sourceCitations * 5)
  }
  
  if (analyses.structure.isWellStructured) {
    score += 15
  }
  
  if (analyses.concepts.conceptDensity > 30) {
    score += 10
  }
  
  // Optimal WPM (not too fast, not too slow)
  if (analyses.wpm.wpm >= 120 && analyses.wpm.wpm <= 160) {
    score += 10
  }
  
  // Negative signals (manipulation indicators)
  if (analyses.hooks.hookDensity > 5) {
    score -= 10
  }
  
  if (analyses.cliffhangers.cliffhangerCount > 5) {
    score -= 10
  }
  
  return Math.max(0, Math.min(100, score))
}

/**
 * Quick transcript check (just availability)
 */
async function checkTranscriptAvailability(videoId) {
  const cached = TRANSCRIPT_CACHE.get(videoId)
  if (cached) return true
  
  try {
    const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.TranscriptAnalyzer = {
    fetchTranscript,
    analyzeTranscript,
    checkTranscriptAvailability,
    calculateWPM,
    analyzeHookDensity,
    analyzeCliffhangers,
    analyzeConceptDensity,
    analyzeSourceCitations,
    analyzeStructuredExplanations,
    analyzeTitleMismatch,
    HOOK_PHRASES,
    CLIFFHANGER_PHRASES,
    SOURCE_PATTERNS
  }
}

// Export for Node.js (testing)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchTranscript,
    analyzeTranscript,
    checkTranscriptAvailability,
    calculateWPM,
    analyzeHookDensity,
    analyzeCliffhangers,
    analyzeConceptDensity,
    analyzeSourceCitations,
    analyzeStructuredExplanations,
    analyzeTitleMismatch,
    HOOK_PHRASES,
    CLIFFHANGER_PHRASES,
    SOURCE_PATTERNS
  }
}

})(); // End IIFE
