/**
 * Title Analysis Module
 * 
 * NLP-based analysis of YouTube video titles to detect:
 * - Clickbait phrases and patterns
 * - Punctuation intensity
 * - Caps ratio
 * - Ambiguity hooks
 * - Curiosity gaps
 * - Extreme language
 */

;(function() {
'use strict';

// ============================================
// BAIT PHRASE PATTERNS
// ============================================

const BAIT_PHRASES = {
  // High-impact clickbait (15 points each)
  extreme: [
    /you won't believe/i,
    /this is (insane|crazy|unbelievable)/i,
    /i can't believe/i,
    /nobody expected/i,
    /changed everything/i,
    /will blow your mind/i,
    /the truth about/i,
    /what they don't want you to know/i,
    /exposed/i,
    /finally revealed/i,
    /shocking truth/i
  ],
  
  // Medium-impact bait (10 points each)
  medium: [
    /i tried/i,
    /gone wrong/i,
    /gone (too )?far/i,
    /must see/i,
    /you need to (see|watch|know)/i,
    /this happened/i,
    /they did what/i,
    /wait (for it|till the end)/i,
    /watch till the end/i,
    /don't skip/i,
    /here's why/i,
    /the real reason/i,
    /secret(s)? (to|of|behind)/i,
    /what happened (next|when)/i,
    /no one (is talking about|knows)/i
  ],
  
  // Low-impact hooks (5 points each)
  low: [
    /how (i|we|to)/i,
    /why (i|we|you)/i,
    /\d+ (things|ways|tips|reasons|secrets)/i,
    /best .+ (of|in|for) 202\d/i,
    /top \d+/i,
    /ultimate guide/i,
    /complete guide/i,
    /everything you need/i,
    /beginner('s)? guide/i
  ]
}

// Ambiguity hooks - vague references that create curiosity
const AMBIGUITY_PATTERNS = [
  /\bthis\b(?! (is|was|will|has|had|video|channel))/i,  // "This changed my life"
  /\bthat\b(?! (is|was|will|has|had|i|you|we))/i,       // "That happened"
  /\bit\b(?! (is|was|will|has|had|'s))/i,               // "It finally happened"
  /\bthey\b(?! (are|were|will|have|had|'re))/i,         // "They don't want you to know"
  /\bsomething\b/i,
  /\beverything\b/i,
  /\beveryone\b/i,
  /\bnobody\b/i,
  /\bsomeone\b/i
]

// Extreme language patterns
const EXTREME_LANGUAGE = [
  /\b(insane|crazy|unbelievable|incredible|amazing|mind-?blowing)\b/i,
  /\b(shocking|disturbing|terrifying|horrifying)\b/i,
  /\b(destroyed|ruined|killed|ended|broke)\b/i,
  /\b(best|worst|biggest|smallest|fastest|slowest) ever\b/i,
  /\b(perfect|flawless|ultimate|absolute|complete)\b/i,
  /\b(never|always|every|all|none|no one)\b/i,
  /\b(impossible|unreal|legendary|epic|massive)\b/i
]

// Curiosity gap indicators
const CURIOSITY_GAPS = [
  /\.\.\./,                    // Ellipsis
  /\?$/,                       // Ends with question
  /\b(but|and) then\b/i,       // "But then..."
  /\buntil\b/i,                // "Until I tried this"
  /\bfinally\b/i,              // "I finally..."
  /\bactually\b/i,             // "What actually happened"
  /\breally\b/i,               // "What really happened"
  /\bturns out\b/i             // "Turns out..."
]

// ============================================
// ANALYSIS FUNCTIONS
// ============================================

/**
 * Count matches for pattern arrays
 */
function countPatternMatches(text, patterns) {
  let count = 0
  const matches = []
  
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      count++
      matches.push(match[0])
    }
  }
  
  return { count, matches }
}

/**
 * Analyze punctuation intensity
 */
function analyzePunctuation(title) {
  const exclamations = (title.match(/!/g) || []).length
  const questions = (title.match(/\?/g) || []).length
  const ellipsis = (title.match(/\.{2,}/g) || []).length
  const allCapsWords = (title.match(/\b[A-Z]{2,}\b/g) || []).length
  
  // Multiple punctuation is a strong signal
  const multiPunct = (title.match(/[!?]{2,}/g) || []).length
  
  let intensity = 0
  intensity += exclamations * 8
  intensity += questions * 5
  intensity += ellipsis * 10
  intensity += multiPunct * 15
  intensity += allCapsWords * 6
  
  return {
    exclamations,
    questions,
    ellipsis,
    multiPunct,
    allCapsWords,
    intensity: Math.min(100, intensity)
  }
}

/**
 * Calculate caps ratio
 */
function analyzeCapsRatio(title) {
  const letters = title.replace(/[^a-zA-Z]/g, '')
  if (letters.length === 0) return { ratio: 0, isExcessive: false }
  
  const upperCase = letters.replace(/[^A-Z]/g, '').length
  const ratio = upperCase / letters.length
  
  return {
    ratio,
    isExcessive: ratio > 0.3, // More than 30% caps is excessive
    isAllCaps: ratio > 0.8
  }
}

/**
 * Detect ambiguity hooks
 */
function analyzeAmbiguity(title) {
  const { count, matches } = countPatternMatches(title, AMBIGUITY_PATTERNS)
  
  return {
    count,
    matches,
    hasAmbiguity: count > 0,
    score: Math.min(100, count * 15)
  }
}

/**
 * Detect curiosity gaps
 */
function analyzeCuriosityGaps(title) {
  const { count, matches } = countPatternMatches(title, CURIOSITY_GAPS)
  
  // Check for incomplete thoughts
  const endsWithCliffhanger = /[.!?]{0,2}$/.test(title) === false
  
  return {
    count,
    matches,
    endsWithCliffhanger,
    score: Math.min(100, count * 12 + (endsWithCliffhanger ? 10 : 0))
  }
}

/**
 * Detect extreme language
 */
function analyzeExtremLanguage(title) {
  const { count, matches } = countPatternMatches(title, EXTREME_LANGUAGE)
  
  return {
    count,
    matches,
    hasExtremeLanguage: count > 0,
    score: Math.min(100, count * 12)
  }
}

/**
 * Detect bait phrases
 */
function analyzeBaitPhrases(title) {
  const extreme = countPatternMatches(title, BAIT_PHRASES.extreme)
  const medium = countPatternMatches(title, BAIT_PHRASES.medium)
  const low = countPatternMatches(title, BAIT_PHRASES.low)
  
  const score = Math.min(100, 
    extreme.count * 15 + 
    medium.count * 10 + 
    low.count * 5
  )
  
  return {
    extreme: extreme.matches,
    medium: medium.matches,
    low: low.matches,
    totalCount: extreme.count + medium.count + low.count,
    score
  }
}

/**
 * Analyze title length and structure
 */
function analyzeStructure(title) {
  const wordCount = title.split(/\s+/).length
  const charCount = title.length
  
  // Optimal title length for CTR is 40-60 chars
  const isOptimalLength = charCount >= 40 && charCount <= 70
  
  // Check for common high-CTR structures
  const hasNumber = /\d+/.test(title)
  const hasBrackets = /[\[\]()]/.test(title)
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(title)
  const hasPipe = /\|/.test(title)
  const hasColon = /:/.test(title)
  
  let structureScore = 0
  if (isOptimalLength) structureScore += 10
  if (hasNumber) structureScore += 8
  if (hasBrackets) structureScore += 5
  if (hasEmoji) structureScore += 10
  if (hasPipe || hasColon) structureScore += 5
  
  return {
    wordCount,
    charCount,
    isOptimalLength,
    hasNumber,
    hasBrackets,
    hasEmoji,
    hasPipe,
    hasColon,
    score: structureScore
  }
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

/**
 * Analyze a video title and return bait score + features
 */
function analyzeTitle(title) {
  if (!title || typeof title !== 'string') {
    return {
      baitScore: 0,
      features: {},
      tags: [],
      analyzed: false
    }
  }
  
  // Run all analyses
  const punctuation = analyzePunctuation(title)
  const caps = analyzeCapsRatio(title)
  const ambiguity = analyzeAmbiguity(title)
  const curiosity = analyzeCuriosityGaps(title)
  const extreme = analyzeExtremLanguage(title)
  const baitPhrases = analyzeBaitPhrases(title)
  const structure = analyzeStructure(title)
  
  // Calculate overall bait score
  let baitScore = 0
  
  // Weighted contributions
  baitScore += baitPhrases.score * 0.30      // Bait phrases are strongest signal
  baitScore += punctuation.intensity * 0.15  // Punctuation abuse
  baitScore += caps.ratio * 50 * 0.10        // Caps ratio (convert to 0-50 scale)
  baitScore += ambiguity.score * 0.15        // Ambiguity hooks
  baitScore += curiosity.score * 0.15        // Curiosity gaps
  baitScore += extreme.score * 0.10          // Extreme language
  baitScore += structure.score * 0.05        // Structure optimization
  
  baitScore = Math.round(Math.min(100, baitScore))
  
  // Generate tags
  const tags = []
  
  if (baitPhrases.extreme.length > 0) {
    tags.push('Extreme Bait')
  }
  if (baitPhrases.totalCount > 2) {
    tags.push('Multiple Hooks')
  }
  if (punctuation.multiPunct > 0) {
    tags.push('Punctuation Abuse')
  }
  if (caps.isExcessive) {
    tags.push('Excessive Caps')
  }
  if (caps.isAllCaps) {
    tags.push('ALL CAPS')
  }
  if (ambiguity.count > 1) {
    tags.push('Vague References')
  }
  if (curiosity.count > 1) {
    tags.push('Curiosity Gap')
  }
  if (extreme.count > 1) {
    tags.push('Extreme Language')
  }
  if (structure.hasEmoji) {
    tags.push('Emoji Bait')
  }
  if (structure.hasNumber && baitPhrases.low.length > 0) {
    tags.push('Listicle Format')
  }
  
  return {
    baitScore,
    features: {
      punctuationIntensity: punctuation.intensity,
      capsRatio: caps.ratio,
      ambiguityCount: ambiguity.count,
      curiosityGapCount: curiosity.count,
      extremeLanguageCount: extreme.count,
      baitPhraseCount: baitPhrases.totalCount,
      hasEmoji: structure.hasEmoji,
      wordCount: structure.wordCount,
      charCount: structure.charCount
    },
    breakdown: {
      punctuation,
      caps,
      ambiguity,
      curiosity,
      extreme,
      baitPhrases,
      structure
    },
    tags,
    analyzed: true
  }
}

/**
 * Compare title to transcript for mismatch detection
 */
function analyzeTitleTranscriptMismatch(title, transcriptSummary) {
  if (!title || !transcriptSummary) {
    return { mismatchScore: 0, analyzed: false }
  }
  
  const titleLower = title.toLowerCase()
  const transcriptLower = transcriptSummary.toLowerCase()
  
  // Extract key terms from title
  const titleWords = titleLower
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
  
  // Check how many title words appear in transcript
  let matchCount = 0
  for (const word of titleWords) {
    if (transcriptLower.includes(word)) {
      matchCount++
    }
  }
  
  const matchRatio = titleWords.length > 0 ? matchCount / titleWords.length : 1
  
  // Low match ratio = potential mismatch
  const mismatchScore = Math.round((1 - matchRatio) * 100)
  
  // Check for specific mismatch patterns
  const titleHasNumber = /\d+/.test(title)
  const transcriptHasNumber = /\d+/.test(transcriptSummary)
  const numberMismatch = titleHasNumber && !transcriptHasNumber
  
  return {
    mismatchScore: Math.min(100, mismatchScore + (numberMismatch ? 20 : 0)),
    matchRatio,
    titleWordCount: titleWords.length,
    matchedWords: matchCount,
    numberMismatch,
    analyzed: true
  }
}

/**
 * Batch analyze multiple titles
 */
function batchAnalyzeTitles(titles) {
  const results = new Map()
  
  for (const { title, videoId } of titles) {
    results.set(videoId, analyzeTitle(title))
  }
  
  return results
}

/**
 * Get top bait indicators for a title
 */
function getTopBaitIndicators(analysisResult, maxIndicators = 3) {
  if (!analysisResult || !analysisResult.breakdown) {
    return []
  }
  
  const indicators = []
  const { breakdown } = analysisResult
  
  if (breakdown.baitPhrases.score > 20) {
    indicators.push({
      type: 'baitPhrases',
      label: 'Clickbait phrases detected',
      score: breakdown.baitPhrases.score,
      examples: [...breakdown.baitPhrases.extreme, ...breakdown.baitPhrases.medium].slice(0, 2)
    })
  }
  
  if (breakdown.punctuation.intensity > 20) {
    indicators.push({
      type: 'punctuation',
      label: 'Excessive punctuation',
      score: breakdown.punctuation.intensity
    })
  }
  
  if (breakdown.ambiguity.score > 15) {
    indicators.push({
      type: 'ambiguity',
      label: 'Vague/ambiguous language',
      score: breakdown.ambiguity.score,
      examples: breakdown.ambiguity.matches.slice(0, 2)
    })
  }
  
  if (breakdown.extreme.score > 15) {
    indicators.push({
      type: 'extreme',
      label: 'Extreme language',
      score: breakdown.extreme.score,
      examples: breakdown.extreme.matches.slice(0, 2)
    })
  }
  
  if (breakdown.caps.isExcessive) {
    indicators.push({
      type: 'caps',
      label: 'Excessive capitalization',
      score: Math.round(breakdown.caps.ratio * 100)
    })
  }
  
  // Sort by score and return top N
  return indicators
    .sort((a, b) => b.score - a.score)
    .slice(0, maxIndicators)
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.TitleAnalyzer = {
    analyzeTitle,
    analyzeTitleTranscriptMismatch,
    batchAnalyzeTitles,
    getTopBaitIndicators,
    BAIT_PHRASES,
    EXTREME_LANGUAGE,
    CURIOSITY_GAPS
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    analyzeTitle,
    analyzeTitleTranscriptMismatch,
    batchAnalyzeTitles,
    getTopBaitIndicators,
    BAIT_PHRASES,
    EXTREME_LANGUAGE,
    CURIOSITY_GAPS
  }
}

})(); // End IIFE
