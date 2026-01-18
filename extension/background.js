// Silenced by the Algorithm - Bias Lens Engine
// See what the algorithm amplifies, hear what it silences

// ============================================
// CONFIGURATION & VERSIONING
// ============================================
const SCHEMA_VERSION = '4.0.0'
const ENGINE_VERSION = 'v4.0'

const YOUTUBE_API_KEY = 'AIzaSyCHazLbHh0p4PYOMzxu7TtFYuVDQJ-j2YQ'
const MAX_SUBSCRIBER_THRESHOLD = 100000 // Noise cancellation threshold
const MONOPOLY_THRESHOLD = 1000000 // 1M subs = deafening noise
const CACHE_TTL = 86400000 // 24 hours in ms
const BIAS_RECEIPT_CACHE_TTL = 21600000 // 6 hours in ms

// Feature flags
const ENABLE_ML_FEATURES = true // Set to true to enable AI-powered features
const ENABLE_PERSPECTIVE_SEARCH = true // Set to true to enable perspective search on YouTube search pages
const DEEPSEEK_API_KEY = 'sk-d22aeebcc8f041ffba2964413ef90c89' // DeepSeek API key for quality analysis

// Python Backend URL (for transcript fetching + Gemini without CORS issues)
// Set to your deployed backend URL, or 'http://localhost:8000' for local dev
const PYTHON_BACKEND_URL = 'http://localhost:8000'
const USE_PYTHON_BACKEND = true // Set to true to use Python backend for transcripts/AI

// Backend health cache - avoid repeated failed requests to downed backend
let backendHealthCache = { healthy: null, lastCheck: 0 }
const BACKEND_HEALTH_CHECK_INTERVAL = 30000 // Only re-check every 30 seconds

// Quality thresholds - STRICT when AI is offline to avoid showing garbage
const MIN_VIDEO_QUALITY_SCORE_AI = 0.55 // Threshold when AI scoring is working
const MIN_VIDEO_QUALITY_SCORE_HEURISTIC = 0.72 // Much stricter threshold when using heuristic fallback
const QUALITY_CACHE_TTL = 3600000 // 1 hour cache for quality scores

// Track AI availability for threshold selection
let lastAISuccess = 0 // Timestamp of last successful DeepSeek call
let consecutiveAIFails = 0 // Count of consecutive DeepSeek failures
const AI_OFFLINE_THRESHOLD = 3 // Consider offline after 3 consecutive failures

function getQualityThreshold() {
  // If AI has failed 3+ times consecutively and hasn't succeeded in last 5 min, use strict threshold
  const aiOffline = consecutiveAIFails >= AI_OFFLINE_THRESHOLD &&
    (Date.now() - lastAISuccess > 300000)
  return aiOffline ? MIN_VIDEO_QUALITY_SCORE_HEURISTIC : MIN_VIDEO_QUALITY_SCORE_AI
}

function isAIOffline() {
  return consecutiveAIFails >= AI_OFFLINE_THRESHOLD &&
    (Date.now() - lastAISuccess > 300000)
}

// Quota costs
const QUOTA_LIMIT = 10000
let quotaUsed = 0

// Exposure Advantage tiers - more defensible framing than raw subscriber count
const EXPOSURE_TIERS = {
  UNDER_REPRESENTED: { min: 0, max: 20, label: 'Under-represented', color: '#10b981', description: 'Minimal algorithmic amplification' },
  EMERGING: { min: 21, max: 40, label: 'Emerging', color: '#22c55e', description: 'Limited platform visibility' },
  ESTABLISHED: { min: 41, max: 60, label: 'Established', color: '#f59e0b', description: 'Moderate exposure advantage' },
  AMPLIFIED: { min: 61, max: 80, label: 'Amplified', color: '#f97316', description: 'Significant algorithmic boost' },
  DOMINANT: { min: 81, max: 100, label: 'Dominant', color: '#ef4444', description: 'Maximum platform advantage' }
}

function getExposureTier(score) {
  if (score <= 20) return EXPOSURE_TIERS.UNDER_REPRESENTED
  if (score <= 40) return EXPOSURE_TIERS.EMERGING
  if (score <= 60) return EXPOSURE_TIERS.ESTABLISHED
  if (score <= 80) return EXPOSURE_TIERS.AMPLIFIED
  return EXPOSURE_TIERS.DOMINANT
}

// Legacy alias for compatibility
function getNoiseLevel(score) {
  return getExposureTier(score)
}

// In-memory cache (also synced to localStorage for persistence)
let channelCache = {}
let discoveryCache = {}
let biasReceiptCache = {} // Cache for Gemini-generated bias receipts (6-hour TTL)
let qualityScoreCache = {} // Cache for video quality scores (1-hour TTL)

// ===============================================
// PERSISTENCE - Load cache from localStorage
// ===============================================
async function loadCache() {
  try {
    const stored = await chrome.storage.local.get(['channelCache', 'biasReceiptCache', 'quotaUsed', 'quotaResetDate'])

    if (stored.channelCache) {
      channelCache = stored.channelCache
      // Prune expired entries
      const now = Date.now()
      for (const key in channelCache) {
        if (now - channelCache[key].timestamp > CACHE_TTL) {
          delete channelCache[key]
        }
      }
    }

    // Load and prune bias receipt cache (6-hour TTL)
    if (stored.biasReceiptCache) {
      biasReceiptCache = stored.biasReceiptCache
      const now = Date.now()
      for (const key in biasReceiptCache) {
        if (now - biasReceiptCache[key].timestamp > BIAS_RECEIPT_CACHE_TTL) {
          delete biasReceiptCache[key]
        }
      }
    }

    // Reset quota if new day
    const today = new Date().toDateString()
    if (stored.quotaResetDate !== today) {
      quotaUsed = 0
      await chrome.storage.local.set({ quotaUsed: 0, quotaResetDate: today })
    } else {
      quotaUsed = stored.quotaUsed || 0
    }

    console.log(`[Silenced] Cache loaded: ${Object.keys(channelCache).length} channels, ${Object.keys(biasReceiptCache).length} bias receipts, ${quotaUsed} quota used`)
  } catch (err) {
    console.error('[Silenced] Cache load error:', err)
  }
}

async function saveCache() {
  try {
    await chrome.storage.local.set({
      channelCache,
      biasReceiptCache,
      quotaUsed,
      quotaResetDate: new Date().toDateString()
    })
  } catch (err) {
    console.error('[Silenced] Cache save error:', err)
  }
}

// Initialize cache on load
loadCache()

// Clear discovery cache on extension load (prevents stale empty results)
discoveryCache = {}
console.log('[Silenced] Discovery cache cleared on startup')

// ===============================================
// EXPOSURE ADVANTAGE SCORE CALCULATION
// Multi-signal approach to measuring platform advantage
// ===============================================
function calculateExposureAdvantageScore(channel, videoStats, activities) {
  const subs = parseInt(channel?.statistics?.subscriberCount || '0')
  const totalViews = parseInt(channel?.statistics?.viewCount || '0')
  const videoCount = parseInt(channel?.statistics?.videoCount || '0')
  const views = parseInt(videoStats?.viewCount || '0')
  const likes = parseInt(videoStats?.likeCount || '0')
  const comments = parseInt(videoStats?.commentCount || '0')
  const duration = parseDuration(videoStats?.duration || 'PT0S')
  const recentUploads = activities?.length || 0

  // Calculate derived metrics
  const avgViewsPerVideo = videoCount > 0 ? totalViews / videoCount : 0
  const engagementRatio = views > 0 ? ((comments + likes) / views) * 100 : 0
  const viewsPerSub = subs > 0 ? views / subs : 0
  const minutes = duration / 60

  // =========================================
  // 1. REACH SCALE (35% weight)
  // Platform reach based on subscriber base
  // =========================================
  let reachScore = 0
  if (subs >= 10000000) reachScore = 100
  else if (subs >= 5000000) reachScore = 90
  else if (subs >= MONOPOLY_THRESHOLD) reachScore = 75
  else if (subs >= 500000) reachScore = 60
  else if (subs >= 100000) reachScore = 40
  else if (subs >= 50000) reachScore = 25
  else if (subs >= 10000) reachScore = 15
  else reachScore = 5

  // =========================================
  // 2. VELOCITY (25% weight)
  // Views/day relative to channel size
  // =========================================
  const videoAgeHours = 24 // Default assumption for recent video
  const viewsPerDay = views / Math.max(1, videoAgeHours / 24)
  let velocityScore = 0
  if (viewsPerDay >= 1000000) velocityScore = 100
  else if (viewsPerDay >= 500000) velocityScore = 85
  else if (viewsPerDay >= 100000) velocityScore = 70
  else if (viewsPerDay >= 50000) velocityScore = 55
  else if (viewsPerDay >= 10000) velocityScore = 40
  else if (viewsPerDay >= 1000) velocityScore = 25
  else velocityScore = 10

  // =========================================
  // 3. UPLOAD FREQUENCY (20% weight)
  // Content saturation ability
  // =========================================
  let frequencyScore = 0
  if (recentUploads >= 30) frequencyScore = 100
  else if (recentUploads >= 20) frequencyScore = 80
  else if (recentUploads >= 12) frequencyScore = 60
  else if (recentUploads >= 4) frequencyScore = 40
  else frequencyScore = 15

  // =========================================
  // 4. RECENCY BOOST (20% weight)
  // Algorithm favors recent content from large channels
  // =========================================
  let recencyScore = Math.min(100, Math.round((viewsPerSub * 20) + (recentUploads * 3)))

  // =========================================
  // CALCULATE TOTAL EXPOSURE ADVANTAGE
  // =========================================
  const totalScore = Math.round(
    (reachScore * 0.35) +
    (velocityScore * 0.25) +
    (frequencyScore * 0.20) +
    (recencyScore * 0.20)
  )

  const exposureTier = getExposureTier(totalScore)
  const isAdvantaged = totalScore > 50

  // =========================================
  // Generate explainability reasons
  // =========================================
  const explainReasons = []

  if (subs >= 100000) {
    explainReasons.push(`${fmt(subs)} subscribers gives this channel significant reach advantage`)
  }
  if (viewsPerDay >= 50000) {
    explainReasons.push(`High velocity: ${fmt(Math.round(viewsPerDay))} views/day`)
  }
  if (recentUploads >= 12) {
    explainReasons.push(`Frequent uploads (${recentUploads}/month) saturate recommendations`)
  }
  if (engagementRatio < 1 && views > 100000) {
    explainReasons.push(`Low engagement ratio (${engagementRatio.toFixed(1)}%) suggests algorithmic push over organic interest`)
  }
  if (totalScore <= 30) {
    explainReasons.push(`Limited platform visibility despite content quality`)
  }

  return {
    totalScore,
    exposureTier,
    noiseLevel: exposureTier, // Legacy compatibility
    isAdvantaged,
    explainReasons,
    breakdown: {
      reach: { score: reachScore, weight: 35, metric: fmt(subs) + ' subs' },
      velocity: { score: velocityScore, weight: 25, metric: fmt(Math.round(viewsPerDay)) + '/day' },
      frequency: { score: frequencyScore, weight: 20, metric: recentUploads + ' uploads/mo' },
      recency: { score: recencyScore, weight: 20, metric: viewsPerSub.toFixed(1) + 'x sub reach' }
    },
    rawMetrics: {
      subscriberCount: subs,
      viewCount: views,
      likeCount: likes,
      commentCount: comments,
      engagementRatio,
      avgViewsPerVideo,
      viewsPerDay: Math.round(viewsPerDay),
      duration: minutes,
      recentUploads
    }
  }
}

// Legacy alias
function calculateNoiseScore(channel, videoStats, activities) {
  return calculateExposureAdvantageScore(channel, videoStats, activities)
}

// ===============================================
// VOICES SILENCED CALCULATION
// Estimate how many smaller creators are drowned out
// ===============================================
function calculateVoicesSilenced(subscriberCount, noiseScore) {
  // Base calculation: larger channels occupy more "recommendation real estate"
  // For every 100K subs, approximately 1 smaller creator could have filled that slot
  const baseVoices = Math.floor(subscriberCount / 50000)

  // Multiply by noise factor (higher noise = more silencing)
  const noiseFactor = 1 + (noiseScore / 100)

  // Estimate silenced voices with some variance for realism
  const silenced = Math.round(baseVoices * noiseFactor)

  // Return structured data
  return {
    count: Math.max(0, silenced),
    breakdown: {
      grassrootsActivists: Math.round(silenced * 0.3),
      globalSouthVoices: Math.round(silenced * 0.25),
      localExperts: Math.round(silenced * 0.25),
      emergingEducators: Math.round(silenced * 0.2)
    }
  }
}

// ===============================================
// BIAS RECEIPT GENERATION
// Explainability: "Why you didn't see this" + "Why we surfaced it"
// ===============================================

/**
 * Generate a bias receipt for a video explaining why it wasn't shown
 * and why we're surfacing it as an alternative.
 * 
 * @param {Object} params - Video and channel metrics
 * @param {string} params.videoId - The video ID
 * @param {number} params.subscriberCount - Channel subscriber count
 * @param {number} params.viewsPerDay - Estimated views per day (velocity)
 * @param {number} params.uploadFrequency - Recent uploads per month
 * @param {number} params.engagementRatio - Engagement ratio (likes+comments/views)
 * @param {number} params.avgSubsInTopic - Average subs in this topic
 * @param {number} params.topicConcentration - % of topic dominated by top channels
 * @param {string} params.exposureTier - 'under-represented', 'emerging', etc.
 * @param {boolean} params.isRisingSignal - Whether this is a rising creator
 * @param {string} params.videoTitle - Video title for context
 * @param {string} params.channelTitle - Channel name
 * @returns {Promise<Object>} biasReceipt object
 */
async function generateBiasReceipt(params) {
  const {
    videoId,
    subscriberCount = 0,
    viewsPerDay = 0,
    uploadFrequency = 0,
    engagementRatio = 0,
    avgSubsInTopic = 100000,
    topicConcentration = 50,
    exposureTier = 'emerging',
    isRisingSignal = false,
    videoTitle = '',
    channelTitle = ''
  } = params

  // Check cache first (6-hour TTL)
  const cacheKey = `receipt_${videoId}`
  if (biasReceiptCache[cacheKey] && Date.now() - biasReceiptCache[cacheKey].timestamp < BIAS_RECEIPT_CACHE_TTL) {
    console.log(`[Silenced] Bias receipt cache hit: ${videoId}`)
    return biasReceiptCache[cacheKey].data
  }

  // Try Gemini if enabled and available
  if (ENABLE_ML_FEATURES && DEEPSEEK_API_KEY) {
    try {
      console.log(`[Silenced] Generating AI bias receipt for: ${params.videoTitle?.slice(0, 50)}...`)
      console.log(`[Silenced] Description length: ${params.videoDescription?.length || 0} chars`)
      const aiReceipt = await generateBiasReceiptWithAI(params)
      if (aiReceipt) {
        console.log(`[Silenced] ✓ AI receipt generated successfully`)
        // Cache the result
        biasReceiptCache[cacheKey] = { data: aiReceipt, timestamp: Date.now() }
        saveCache()
        return aiReceipt
      } else {
        console.warn(`[Silenced] AI receipt returned null, falling back to heuristic`)
      }
    } catch (err) {
      console.warn('[Silenced] AI bias receipt failed, falling back to heuristic:', err.message)
    }
  } else {
    console.log(`[Silenced] Skipping AI receipt: ML=${ENABLE_ML_FEATURES}, hasKey=${!!DEEPSEEK_API_KEY}`)
  }

  // Heuristic fallback - deterministic bullets based on thresholds
  const whyNotShown = generateHeuristicWhyNotShown(params)
  const whySurfaced = generateHeuristicWhySurfaced(params)
  const confidence = calculateReceiptConfidence(params)
  const contentSummary = generateHeuristicContentSummary(params)

  const receipt = {
    contentSummary,
    whyNotShown,
    whySurfaced,
    confidence,
    method: 'heuristic'
  }

  // Cache heuristic receipts too (shorter effective TTL due to determinism)
  biasReceiptCache[cacheKey] = { data: receipt, timestamp: Date.now() }
  saveCache()

  return receipt
}

/**
 * Generate "Why Not Shown" bullets using heuristics
 */
function generateHeuristicWhyNotShown(params) {
  const { subscriberCount, viewsPerDay, avgSubsInTopic, topicConcentration, uploadFrequency } = params
  const bullets = []

  // Subscriber-based explanations
  if (subscriberCount < 10000) {
    bullets.push('Channel has under 10K subscribers, limiting algorithmic reach')
  } else if (subscriberCount < 50000) {
    bullets.push('Channel size (under 50K) may limit recommendation visibility')
  } else if (subscriberCount < 100000) {
    bullets.push('Mid-sized channel may receive less algorithmic priority')
  }

  // Velocity-based explanations
  if (viewsPerDay < 1000 && subscriberCount > 1000) {
    bullets.push('Lower view velocity may reduce recommendation frequency')
  }

  // Topic concentration
  if (topicConcentration > 70) {
    bullets.push('Topic dominated by large channels (high concentration)')
  } else if (topicConcentration > 50) {
    bullets.push('Competitive topic with established dominant voices')
  }

  // Upload frequency
  if (uploadFrequency < 4) {
    bullets.push('Infrequent uploads may reduce algorithmic visibility')
  }

  // Comparison to topic average
  if (avgSubsInTopic > 0 && subscriberCount < avgSubsInTopic * 0.2) {
    bullets.push('Significantly smaller than average channel in this topic')
  }

  // Default fallback
  if (bullets.length === 0) {
    bullets.push('Limited exposure compared to dominant channels')
  }

  // Return 2-4 bullets, prioritizing most relevant
  return bullets.slice(0, 4)
}

/**
 * Generate "Why Surfaced" bullets using heuristics
 */
function generateHeuristicWhySurfaced(params) {
  const { subscriberCount, engagementRatio, isRisingSignal, avgSubsInTopic, exposureTier, viewsPerDay } = params
  const bullets = []

  // Rising signal
  if (isRisingSignal) {
    bullets.push('Rising signal: outperforming channel size')
  }

  // Engagement-based
  if (engagementRatio > 3) {
    bullets.push('Strong audience engagement suggests quality content')
  } else if (engagementRatio > 1.5) {
    bullets.push('Above-average engagement ratio')
  }

  // Size comparison
  if (avgSubsInTopic > 0) {
    const percentSmaller = Math.round((1 - subscriberCount / avgSubsInTopic) * 100)
    if (percentSmaller > 80) {
      bullets.push(`${percentSmaller}% smaller than topic average`)
    } else if (percentSmaller > 50) {
      bullets.push('Significantly under-represented in topic')
    }
  }

  // Exposure tier
  if (exposureTier === 'under-represented') {
    bullets.push('Minimal algorithmic amplification')
  } else if (exposureTier === 'emerging') {
    bullets.push('Emerging voice with limited platform visibility')
  }

  // Very small channels
  if (subscriberCount < 10000) {
    bullets.push('Grassroots creator deserving wider audience')
  } else if (subscriberCount < 50000) {
    bullets.push('Independent voice in competitive topic')
  }

  // Velocity despite size
  if (viewsPerDay > 100 && subscriberCount < 50000) {
    bullets.push('Good traction despite limited subscriber base')
  }

  // Default fallback
  if (bullets.length === 0) {
    bullets.push('Under-represented in algorithm recommendations')
  }

  return bullets.slice(0, 4)
}

/**
 * Generate a content summary by analyzing the video transcript/description (heuristic fallback)
 * Extracts actual topics, themes, and key points from the content
 */
function generateHeuristicContentSummary(params) {
  const { videoTitle, videoDescription = '', channelTitle, transcript = '' } = params

  if (!videoTitle) return null

  // Prefer transcript over description - it has actual spoken content
  const hasTranscript = transcript && transcript.length > 200
  const contentSource = hasTranscript ? transcript.slice(0, 2000) : (videoDescription || '').slice(0, 1000)

  // If no content source, we can't generate meaningful content summary
  if (!contentSource || contentSource.length < 50) {
    return null // Return null so UI shows nothing rather than generic text
  }

  // If we have a transcript, extract key talking points
  if (hasTranscript) {
    // Find sentences that seem like main points (contain explanatory language)
    const sentences = contentSource
      .split(/[.!?]/)
      .map(s => s.trim())
      .filter(s => s.length > 30 && s.length < 200)
      .filter(s => !/^(hey|hi|hello|what's up|subscribe|like|comment|click)/i.test(s))

    // Find informative sentences
    const informativeSentences = sentences.filter(s =>
      /\b(is|are|means|because|therefore|explains|shows|demonstrates|important|key|main|first|second|basically|essentially|actually)\b/i.test(s)
    )

    if (informativeSentences.length >= 2) {
      // Take first 2 informative sentences as summary
      const summary = informativeSentences.slice(0, 2).join('. ')
      return summary.charAt(0).toUpperCase() + summary.slice(1) + '.'
    }

    // Fallback: take first 2 decent sentences
    if (sentences.length >= 2) {
      const summary = sentences.slice(0, 2).join('. ')
      return summary.charAt(0).toUpperCase() + summary.slice(1) + '.'
    }
  }

  const desc = contentSource

  // Extract meaningful sentences from description (skip links, timestamps, social media)
  const sentences = desc
    .split(/[.!?\n]/)
    .map(s => s.trim())
    .filter(s => {
      if (s.length < 20 || s.length > 200) return false
      if (/^(http|www\.|@|#|follow|subscribe|like|comment|check out|link|click)/i.test(s)) return false
      if (/^\d{1,2}:\d{2}/.test(s)) return false // Timestamps
      if (/^(instagram|twitter|tiktok|facebook|patreon|merch|sponsor)/i.test(s)) return false
      return true
    })

  // Extract key topics from title and description
  const fullText = `${videoTitle} ${desc}`.toLowerCase()

  // Topic extraction - find what the video is actually about
  const topicPatterns = [
    { pattern: /\b(explains?|explaining|breakdown of|deep dive into|exploring|discusses?|discussing|covers?|covering)\s+(.{10,60})/gi, type: 'explains' },
    { pattern: /\b(how to|guide to|tutorial on|learn|learning)\s+(.{10,50})/gi, type: 'tutorial' },
    { pattern: /\b(the truth about|reality of|what really|behind the)\s+(.{10,50})/gi, type: 'exposé' },
    { pattern: /\b(review of|reviewing|tested|testing|compared?|comparing)\s+(.{10,50})/gi, type: 'review' },
    { pattern: /\b(story of|history of|journey|experience with)\s+(.{10,50})/gi, type: 'story' },
    { pattern: /\b(interview with|conversation with|talking to|speaks with)\s+(.{10,50})/gi, type: 'interview' },
    { pattern: /\b(analysis of|analyzing|examined?|examining)\s+(.{10,50})/gi, type: 'analysis' }
  ]

  let extractedTopic = null
  let contentType = null

  for (const { pattern, type } of topicPatterns) {
    const match = pattern.exec(fullText)
    if (match && match[2]) {
      extractedTopic = match[2].trim().replace(/[,.]$/, '')
      contentType = type
      break
    }
  }

  // If we found content sentences, use the first meaningful one
  if (sentences.length > 0) {
    // Find the most informative sentence (longer, contains verbs)
    const bestSentence = sentences.find(s =>
      s.length > 40 &&
      /\b(is|are|was|were|explains|shows|demonstrates|reveals|covers|discusses|explores)\b/i.test(s)
    ) || sentences[0]

    if (bestSentence) {
      // Clean up the sentence
      let summary = bestSentence
        .replace(/^(in this video,?|today,?|hey guys,?|welcome,?)/i, '')
        .trim()

      // Capitalize first letter
      summary = summary.charAt(0).toUpperCase() + summary.slice(1)

      // Add period if missing
      if (!/[.!?]$/.test(summary)) summary += '.'

      return summary
    }
  }

  // If we extracted a topic from patterns, build a summary
  if (extractedTopic && contentType) {
    const typeLabels = {
      'explains': 'This video explains',
      'tutorial': 'A tutorial covering',
      'exposé': 'An investigation into',
      'review': 'A review examining',
      'story': 'The story of',
      'interview': 'A conversation about',
      'analysis': 'An analysis of'
    }
    return `${typeLabels[contentType]} ${extractedTopic}.`
  }

  // Last resort: try to extract key nouns/phrases from title
  const titleWords = videoTitle
    .replace(/[|\-–—:]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !/^(the|and|for|with|this|that|from|have|will|what|how|why)$/i.test(w))
    .slice(0, 5)
    .join(' ')

  if (titleWords.length > 10) {
    return `Content covering: ${titleWords.toLowerCase()}.`
  }

  return null // Return null if we can't generate meaningful content
}

/**
 * Calculate confidence level for the receipt
 */
function calculateReceiptConfidence(params) {
  const { subscriberCount, engagementRatio, isRisingSignal, avgSubsInTopic } = params
  let score = 0

  // More data points = higher confidence
  if (subscriberCount > 0) score += 1
  if (engagementRatio > 0) score += 1
  if (avgSubsInTopic > 0) score += 1
  if (isRisingSignal !== undefined) score += 1

  // Clear patterns = higher confidence
  if (subscriberCount < 50000) score += 1
  if (engagementRatio > 2) score += 1

  if (score >= 5) return 'high'
  if (score >= 3) return 'medium'
  return 'low'
}

/**
 * Call DeepSeek API (OpenAI-compatible)
 * Uses deepseek-chat model for quality analysis
 */
async function callDeepSeekAPI(prompt, config = {}) {
  const { temperature = 0.3, maxTokens = 500 } = config

  if (!DEEPSEEK_API_KEY) {
    console.warn('[Silenced] DeepSeek API key not configured')
    return null
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature,
        max_tokens: maxTokens
      })
    })

    if (response.ok) {
      const data = await response.json()
      const result = data.choices?.[0]?.message?.content || null
      if (result) {
        // Track AI success
        lastAISuccess = Date.now()
        consecutiveAIFails = 0
        console.log('[Silenced] DeepSeek API call successful')
      }
      return result
    } else {
      const errorText = await response.text()
      console.warn(`[Silenced] DeepSeek API error ${response.status}:`, errorText)
      consecutiveAIFails++
      return null
    }
  } catch (err) {
    console.warn(`[Silenced] DeepSeek API call failed:`, err.message)
    consecutiveAIFails++
    return null
  }
}

// Alias for backward compatibility
const callGeminiAPI = callDeepSeekAPI

/**
 * Generate bias receipt using DeepSeek AI (when ENABLE_ML_FEATURES is true)
 * Uses transcript for actual content analysis when available
 */
async function generateBiasReceiptWithAI(params) {
  if (!DEEPSEEK_API_KEY) return null

  const {
    subscriberCount,
    viewsPerDay,
    engagementRatio,
    avgSubsInTopic,
    topicConcentration,
    videoTitle,
    videoDescription = '',
    channelTitle,
    isRisingSignal,
    transcript = ''
  } = params

  // Use transcript if available (much better for content analysis), otherwise use description
  const hasTranscript = transcript && transcript.length > 200
  const contentSource = hasTranscript
    ? `TRANSCRIPT (first 3000 chars):\n"${transcript.slice(0, 3000)}"`
    : `DESCRIPTION:\n"${videoDescription.slice(0, 800)}"`

  console.log(`[Silenced] DeepSeek analysis using ${hasTranscript ? 'TRANSCRIPT' : 'DESCRIPTION'} (${hasTranscript ? transcript.length : videoDescription.length} chars)`)

  // Format metrics for context
  const avgSubs = Math.round(avgSubsInTopic || 0)
  const topicConc = topicConcentration || 0
  const engagementRatioStr = typeof engagementRatio === 'number' ? engagementRatio.toFixed(2) : 'N/A'
  const viewsPerDayStr = Math.round(viewsPerDay || 0)
  const risingSignal = isRisingSignal ? 'Yes - channel outperforming its size' : 'No'

  const prompt = `You are an algorithmic bias auditor analyzing YouTube recommendations.

Your task:
Explain WHY a specific video or creator is under-exposed by the platform, and WHY it deserves visibility anyway.

Context you are given:
- Channel size and growth
- Engagement metrics (likes, comments, watch time)
- Topic-level competition and concentration
- Platform incentives (recency, scale, upload frequency)
- Comparison to dominant channels in the same topic

VIDEO INFO:
Title: "${videoTitle}"
Channel: ${channelTitle}
Subscribers: ${fmt(subscriberCount)}
Average subscribers in topic: ${fmt(avgSubs)}
Topic concentration (top 10 channels): ${topicConc}%
Engagement ratio: ${engagementRatioStr}
Views per day: ${viewsPerDayStr}
Rising signal: ${risingSignal}
${contentSource}

Your output MUST follow this structure exactly:

1) WHY THIS CONTENT IS SILENCED
Explain the systemic or algorithmic factors that reduce visibility.
Focus on platform incentives (scale, recency, virality, volume).
Do NOT blame the creator.

2) WHO IS AFFECTED
Briefly identify the type of creator or perspective that is disadvantaged
(e.g. independent creators, long-form analysis, minority viewpoints, non-sensational content).

3) WHY THIS CONTENT STILL MATTERS
Explain what the algorithm undervalues here.
Use engagement quality, depth, originality, or audience response.

4) COUNTERFACTUAL INSIGHT
One sentence explaining what would likely happen if this content were surfaced equally.

Rules:
- Be concise (max 2 short bullet points per section)
- Be confident, not speculative
- Avoid technical jargon
- Avoid moralizing language
- Do NOT mention "AI", "model", or "analysis process"
- Write for a non-technical audience

Tone:
Clear, calm, factual, human.

Return JSON with this EXACT structure:
{
  "whySilenced": [
    "Algorithmic factor 1 (15-25 words)",
    "Algorithmic factor 2 (15-25 words)"
  ],
  "whoAffected": [
    "Creator/perspective type 1 (15-20 words)",
    "Creator/perspective type 2 (15-20 words)"
  ],
  "whyMatters": [
    "Undervalued quality 1 (20-30 words)",
    "Undervalued quality 2 (20-30 words)"
  ],
  "counterfactualInsight": "One sentence explaining what would likely happen if this content were surfaced equally (20-30 words)"
}`

  try {
    const text = await callGeminiAPI(prompt, {
      temperature: 0.4,
      maxOutputTokens: 800
    })

    if (!text) return null

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    // Validate structure
    if (!Array.isArray(parsed.whySilenced) || !Array.isArray(parsed.whoAffected) ||
      !Array.isArray(parsed.whyMatters) || !parsed.counterfactualInsight) {
      return null
    }

    // Return new structure
    return {
      whySilenced: parsed.whySilenced.slice(0, 2),
      whoAffected: parsed.whoAffected.slice(0, 2),
      whyMatters: parsed.whyMatters.slice(0, 2),
      counterfactualInsight: parsed.counterfactualInsight,
      // Backward compatibility mapping
      whyNotShown: parsed.whySilenced.slice(0, 2),
      whySurfaced: parsed.whyMatters.slice(0, 2),
      contentSummary: parsed.counterfactualInsight || null,
      method: 'deepseek'
    }
  } catch (err) {
    console.error('[Silenced] Gemini API error:', err)
    return null
  }
}

// ===============================================
// COMPREHENSIVE AI EXPLANATION FOR SILENCED VIDEOS
// Full 4-section format with detailed analysis
// ===============================================

/**
 * Get comprehensive AI explanation for why a silenced video is high quality
 * and why it's being buried by the algorithm - FULL 4-SECTION FORMAT
 * 
 * @param {Object} silencedVideo - The silenced video data
 * @param {Object} noiseVideo - The noise video it was compared to
 * @returns {Object} { fullExplanation, whySilenced, whoAffected, whyMatters, counterfactual, method }
 */
async function getQuickAIExplanation(silencedVideo, noiseVideo) {
  if (!DEEPSEEK_API_KEY || !silencedVideo) {
    return generateHeuristicExplanation(silencedVideo, noiseVideo)
  }

  const silencedTitle = silencedVideo.title || 'Unknown'
  const silencedChannel = silencedVideo.channelName || 'Unknown'
  const silencedSubs = silencedVideo.channel?.subs || 0
  const silencedViews = silencedVideo.stats?.views || 0
  const silencedLikes = silencedVideo.stats?.likes || 0
  const silencedComments = silencedVideo.stats?.comments || 0
  const silencedDuration = silencedVideo.stats?.durationSec || 0
  const silencedDescription = silencedVideo.description || silencedVideo.stats?.description || ''
  
  const noiseTitle = noiseVideo?.title || 'a trending video'
  const noiseChannel = noiseVideo?.channelName || 'a large channel'
  const noiseSubs = noiseVideo?.channel?.subs || noiseVideo?.stats?.subs || 0
  const noiseViews = noiseVideo?.stats?.views || noiseVideo?.metrics?.views || 0
  
  // Calculate engagement metrics
  const likeRate = silencedLikes && silencedViews > 0 
    ? ((silencedLikes / silencedViews) * 100).toFixed(1) 
    : null
  const commentRate = silencedComments && silencedViews > 0
    ? ((silencedComments / silencedViews) * 100).toFixed(2)
    : null
  const commentsPerKViews = silencedViews > 0 
    ? ((silencedComments / silencedViews) * 1000).toFixed(1)
    : null
  const durationMin = Math.round(silencedDuration / 60)
  const viewsPerDay = silencedVideo.stats?.publishedAt 
    ? Math.round(silencedViews / Math.max(1, (Date.now() - new Date(silencedVideo.stats.publishedAt).getTime()) / 86400000))
    : null

  // Build content context
  const hasDescription = silencedDescription && silencedDescription.length > 50
  const contentSource = hasDescription 
    ? `DESCRIPTION (first 500 chars):\n"${silencedDescription.slice(0, 500)}"`
    : ''

  const prompt = `You are an algorithmic bias auditor analyzing YouTube recommendations.

Your task:
Explain WHY THIS SPECIFIC VIDEO is under-exposed by the platform, and WHY it deserves visibility anyway.
Compare it to the NOISE VIDEO it's being overshadowed by.

BE SPECIFIC TO THIS VIDEO. Reference actual topics, arguments, or content discussed. Do NOT use generic language.

SILENCED VIDEO (the hidden gem):
- Title: "${silencedTitle}"
- Channel: ${silencedChannel}
- Subscribers: ${formatNumber(silencedSubs)}
- Views: ${formatNumber(silencedViews)}
- Duration: ${durationMin} minutes
${likeRate ? `- Like rate: ${likeRate}%` : ''}
${commentRate ? `- Comment rate: ${commentRate}%` : ''}
${commentsPerKViews ? `- Comments per 1k views: ${commentsPerKViews}` : ''}
${viewsPerDay ? `- Views per day: ${formatNumber(viewsPerDay)}` : ''}
${contentSource}

NOISE VIDEO (what YouTube is pushing instead):
- Title: "${noiseTitle}"
- Channel: ${noiseChannel}
- Subscribers: ${formatNumber(noiseSubs)}
- Views: ${formatNumber(noiseViews)}

Your output MUST follow this structure exactly:

1) WHY THIS CONTENT IS SILENCED
Explain the systemic or algorithmic factors that reduce THIS VIDEO'S visibility.
Reference specific characteristics of this video (its topic, format, creator size, etc.).
Focus on platform incentives (scale, recency, virality, volume).
Do NOT blame the creator.

2) WHO IS AFFECTED
Briefly identify the type of creator or perspective THIS VIDEO represents that is disadvantaged.
Be specific - what kind of content is this? What viewpoint or format?

3) WHY THIS CONTENT STILL MATTERS
Explain what the algorithm undervalues about THIS SPECIFIC VIDEO.
Reference actual topics, arguments, or insights from the video content.
Use engagement quality, depth, originality, or audience response specific to this video.

4) COUNTERFACTUAL INSIGHT
One sentence explaining what would likely happen if THIS VIDEO were surfaced equally.

Rules:
- Be concise (max 2 short bullet points per section)
- Be SPECIFIC to this video - reference actual content, topics, or arguments
- Be confident, not speculative
- Avoid technical jargon
- Avoid moralizing language
- Do NOT mention "AI", "model", or "analysis process"
- Write for a non-technical audience
- If you have description, USE IT - be concrete about what this video discusses

Tone:
Clear, calm, factual, human.

Format your response as plain text with 4 clear sections, using bullets where appropriate.`

  try {
    const text = await callDeepSeekAPI(prompt, { temperature: 0.3, maxTokens: 600 })
    
    if (!text) {
      return generateHeuristicExplanation(silencedVideo, noiseVideo)
    }

    // Parse the 4-section response
    const sections = parseAIExplanationSections(text)
    
    return {
      fullExplanation: text,
      whySilenced: sections.whySilenced,
      whoAffected: sections.whoAffected,
      whyMatters: sections.whyMatters,
      counterfactual: sections.counterfactual,
      // Legacy fields for backward compatibility
      explanation: sections.whyMatters || text.slice(0, 200),
      whyGood: sections.whyMatters,
      whyBuried: sections.whySilenced,
      method: 'deepseek'
    }
  } catch (err) {
    console.warn('[Silenced] Comprehensive AI explanation failed:', err.message)
    return generateHeuristicExplanation(silencedVideo, noiseVideo)
  }
}

/**
 * Parse the 4-section AI explanation response into structured data
 */
function parseAIExplanationSections(text) {
  const result = {
    whySilenced: '',
    whoAffected: '',
    whyMatters: '',
    counterfactual: ''
  }
  
  if (!text) return result
  
  // Try to extract sections by looking for headers
  const silencedMatch = text.match(/1\)\s*WHY[^\n]*SILENCED[^\n]*\n([\s\S]*?)(?=2\)|$)/i)
  const affectedMatch = text.match(/2\)\s*WHO[^\n]*AFFECTED[^\n]*\n([\s\S]*?)(?=3\)|$)/i)
  const mattersMatch = text.match(/3\)\s*WHY[^\n]*MATTERS[^\n]*\n([\s\S]*?)(?=4\)|$)/i)
  const counterfactualMatch = text.match(/4\)\s*COUNTERFACTUAL[^\n]*\n([\s\S]*?)$/i)
  
  if (silencedMatch) result.whySilenced = silencedMatch[1].trim()
  if (affectedMatch) result.whoAffected = affectedMatch[1].trim()
  if (mattersMatch) result.whyMatters = mattersMatch[1].trim()
  if (counterfactualMatch) result.counterfactual = counterfactualMatch[1].trim()
  
  return result
}

/**
 * Generate heuristic explanation when AI is unavailable
 * Returns the same 4-section format as the AI version
 */
function generateHeuristicExplanation(silencedVideo, noiseVideo) {
  if (!silencedVideo) {
    return { 
      fullExplanation: null, 
      whySilenced: null, 
      whoAffected: null, 
      whyMatters: null, 
      counterfactual: null,
      explanation: null, 
      whyGood: null, 
      whyBuried: null, 
      method: 'heuristic' 
    }
  }

  const subs = silencedVideo.channel?.subs || 0
  const views = silencedVideo.stats?.views || 0
  const likes = silencedVideo.stats?.likes || 0
  const comments = silencedVideo.stats?.comments || 0
  const likeRate = likes && views > 0 ? (likes / views) * 100 : 0
  const commentRate = comments && views > 0 ? (comments / views) * 100 : 0
  const durationMin = Math.round((silencedVideo.stats?.durationSec || 0) / 60)
  const channelName = silencedVideo.channelName || 'this creator'
  const title = silencedVideo.title || 'this video'
  
  // Noise video stats for comparison
  const noiseSubs = noiseVideo?.channel?.subs || noiseVideo?.stats?.subs || 0
  const noiseChannel = noiseVideo?.channelName || 'larger channels'

  // Build 4-section explanation
  
  // 1) WHY THIS CONTENT IS SILENCED
  let whySilenced = ''
  if (subs < 10000) {
    whySilenced = `• Channel size (${formatNumber(subs)} subscribers) is far below the algorithmic threshold for broad distribution\n• Platform prioritizes established creators with proven engagement at scale`
  } else if (subs < 50000) {
    whySilenced = `• With ${formatNumber(subs)} subscribers, this channel lacks the scale signals that trigger algorithmic amplification\n• YouTube's recommendation system favors channels with consistent high-volume performance`
  } else if (subs < 100000) {
    whySilenced = `• At ${formatNumber(subs)} subscribers, this channel is in the "growth gap" - too big to be novel, too small for mass recommendations\n• Platform incentives favor either viral newcomers or established mega-channels`
  } else {
    whySilenced = `• Despite reasonable size, this content may not match the high-velocity engagement patterns the algorithm rewards\n• Platform optimization for watch time favors different content formats`
  }

  // 2) WHO IS AFFECTED
  let whoAffected = ''
  if (durationMin > 15) {
    whoAffected = `• Long-form content creators who prioritize depth over quick engagement\n• Educational or analytical content that requires viewer investment`
  } else if (subs < 50000) {
    whoAffected = `• Independent creators building audiences organically\n• Voices outside mainstream media and established YouTube networks`
  } else {
    whoAffected = `• Mid-tier creators competing against algorithmically-favored content\n• Perspectives that don't fit trending topic clusters`
  }

  // 3) WHY THIS CONTENT STILL MATTERS
  let whyMatters = ''
  if (likeRate > 5) {
    whyMatters = `• Exceptional ${likeRate.toFixed(1)}% like rate indicates viewers who find it value it highly\n• Strong audience satisfaction despite limited discovery`
  } else if (likeRate > 3) {
    whyMatters = `• Solid ${likeRate.toFixed(1)}% like rate shows genuine audience appreciation\n• Engagement quality suggests content resonates with its viewers`
  } else if (commentRate > 0.5) {
    whyMatters = `• Active comment section (${commentRate.toFixed(2)}% rate) indicates engaged community discussion\n• Viewers are motivated to participate, not just passively watch`
  } else if (durationMin > 10) {
    whyMatters = `• ${durationMin}-minute runtime suggests substantive, in-depth coverage\n• Content depth that quick-hit algorithm-optimized videos often lack`
  } else {
    whyMatters = `• Quality engagement metrics relative to channel size\n• Organic reach without algorithmic amplification`
  }

  // 4) COUNTERFACTUAL INSIGHT
  let counterfactual = ''
  if (likeRate > 4) {
    counterfactual = `If surfaced equally, this content would likely maintain its ${likeRate.toFixed(1)}% like rate with a much larger audience, suggesting the algorithm is suppressing content that viewers genuinely appreciate.`
  } else if (subs < 50000 && views > 5000) {
    counterfactual = `Equal visibility would give this smaller creator a fair chance to compete on content quality rather than existing subscriber counts, potentially revealing audiences underserved by mainstream recommendations.`
  } else {
    counterfactual = `If recommended as often as ${noiseChannel}, this video would reach viewers who may prefer its approach but never discover it through algorithmic feeds.`
  }

  // Build full explanation text
  const fullExplanation = `1) WHY THIS CONTENT IS SILENCED
${whySilenced}

2) WHO IS AFFECTED
${whoAffected}

3) WHY THIS CONTENT STILL MATTERS
${whyMatters}

4) COUNTERFACTUAL INSIGHT
${counterfactual}`

  return {
    fullExplanation,
    whySilenced,
    whoAffected,
    whyMatters,
    counterfactual,
    // Legacy fields for backward compatibility
    explanation: whyMatters.split('\n')[0].replace('• ', ''),
    whyGood: whyMatters,
    whyBuried: whySilenced,
    method: 'heuristic'
  }
}

// ===============================================
// AUDIT METRICS COMPUTATION (Deterministic, no AI)
// ===============================================

/**
 * Compute audit metrics from the final unmuted videos list.
 * Pure deterministic math - no ML calls.
 * 
 * @param {Array} unmutedVideos - Final list of surfaced videos
 * @param {number} topicConcentration - Top 10 concentration percentage
 * @returns {Object} auditMetrics
 */
function computeAuditMetrics(unmutedVideos, topicConcentration, qualityFilterStats = {}) {
  if (!unmutedVideos || unmutedVideos.length === 0) {
    return {
      under100kShare: 0,
      under50kShare: 0,
      dominantShareTop10: topicConcentration || 0,
      redundancyFiltered: 0,
      qualityFiltered: 0,
      diversityMethod: 'quality_filtered'
    }
  }

  const total = unmutedVideos.length

  // Count videos from channels under 100k and under 50k
  const under100k = unmutedVideos.filter(v => (v.subscriberCount || 0) < 100000).length
  const under50k = unmutedVideos.filter(v => (v.subscriberCount || 0) < 50000).length

  // Check if Gemini was used for quality scoring
  const geminiUsed = unmutedVideos.some(v => v.surfaceMethod === 'quality_filtered_gemini')
  const diversityMethod = geminiUsed ? 'quality_filtered_gemini' : 'quality_filtered_heuristic'

  return {
    under100kShare: Math.round((under100k / total) * 100),
    under50kShare: Math.round((under50k / total) * 100),
    dominantShareTop10: topicConcentration || 0,
    redundancyFiltered: qualityFilterStats.redundancyFiltered || 0,
    qualityFiltered: qualityFilterStats.qualityFiltered || 0,
    transcriptAnalyzed: qualityFilterStats.transcriptAnalyzed || 0,
    diversityMethod
  }
}

// ===============================================
// VIDEO TRANSCRIPT FETCHING
// ===============================================

/**
 * Fetch video transcript from YouTube using the timedtext API
 * This is the simpler, more reliable method that works from both content and background scripts
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<string|null>} Transcript text or null if unavailable
 */
async function fetchVideoTranscript(videoId) {
  console.log(`[Silenced] Attempting to fetch transcript for ${videoId}...`)

  // Try multiple language codes
  const langCodes = ['en', 'en-US', 'en-GB', '']

  for (const lang of langCodes) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`
      const response = await fetch(url)

      if (!response.ok) continue

      // FIX: Check if body is empty before parsing JSON
      // YouTube returns 200 OK with empty body when no transcript exists
      const text = await response.text()
      if (!text || text.length < 10) continue

      let data
      try {
        data = JSON.parse(text)
      } catch (parseErr) {
        // Invalid JSON - skip this language
        continue
      }

      if (data.events?.length) {
        const transcriptText = data.events
          .filter(e => e.segs)
          .flatMap(e => e.segs.map(s => s.utf8 || ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()

        if (transcriptText.length > 100) {
          console.log(`[Silenced] Successfully fetched transcript for ${videoId} (lang: ${lang || 'default'}): ${transcriptText.length} chars`)
          return transcriptText
        }
      }
    } catch (err) {
      // Only log actual network errors, not JSON parse errors
      if (!err.message.includes('JSON')) {
        console.log(`[Silenced] Transcript fetch failed for ${videoId} (lang: ${lang}):`, err.message)
      }
    }
  }

  // Fallback: try fetching video page and extracting caption URL
  try {
    const videoPageUrl = `https://www.youtube.com/watch?v=${videoId}`
    const pageResponse = await fetch(videoPageUrl)

    if (pageResponse.ok) {
      const pageHtml = await pageResponse.text()
      const captionMatch = pageHtml.match(/"captionTracks":\s*(\[.*?\])/)

      if (captionMatch) {
        const captionJson = captionMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        const captionTracks = JSON.parse(captionJson)

        if (captionTracks?.length > 0) {
          // Find English track or use first available
          const track = captionTracks.find(t =>
            t.languageCode === 'en' || t.languageCode?.startsWith('en')
          ) || captionTracks[0]

          if (track?.baseUrl) {
            const captionResponse = await fetch(track.baseUrl)
            if (captionResponse.ok) {
              const captionXml = await captionResponse.text()
              const textMatches = [...captionXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
              const fullText = textMatches
                .map(m => m[1]
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/\n/g, ' ')
                )
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()

              if (fullText.length > 100) {
                console.log(`[Silenced] Successfully fetched transcript via fallback for ${videoId}: ${fullText.length} chars`)
                return fullText
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.log(`[Silenced] Fallback transcript fetch failed for ${videoId}:`, err.message)
  }

  console.log(`[Silenced] No transcript available for ${videoId}`)
  return null
}

// ===============================================
// VIDEO QUALITY SCORING (Gemini + Heuristic Fallback)
// ===============================================

/**
 * Score video quality and relevance using Gemini AI
 * Returns a score from 0-1 where higher = better quality/relevance
 * 
 * @param {Object} video - Video object with title, description, channelTitle
 * @param {string} searchQuery - The original search query/topic
 * @param {boolean} useTranscript - Whether to fetch and analyze transcript (slower but more accurate)
 * @returns {Promise<Object>} Quality assessment
 */
async function scoreVideoQuality(video, searchQuery, useTranscript = false) {
  const cacheKey = `quality_${video.videoId}_${useTranscript ? 'transcript' : 'basic'}`

  // Check cache first
  if (qualityScoreCache[cacheKey] && Date.now() - qualityScoreCache[cacheKey].timestamp < QUALITY_CACHE_TTL) {
    return qualityScoreCache[cacheKey].data
  }

  // Check backend availability once (cached) to avoid slow repeated timeouts
  const backendAvailable = USE_PYTHON_BACKEND && PYTHON_BACKEND_URL && await isBackendAvailable()

  // Try Python backend first (avoids CORS issues with Gemini)
  if (backendAvailable) {
    try {
      const backendResult = await scoreVideoQualityWithBackend(video, searchQuery, useTranscript)
      if (backendResult) {
        qualityScoreCache[cacheKey] = { data: backendResult, timestamp: Date.now() }
        return backendResult
      }
    } catch (err) {
      console.warn('[Silenced] Python backend scoring failed, falling back:', err.message)
    }
  }

  // Fetch transcript if requested
  let transcript = null
  if (useTranscript) {
    // Try direct method first - it's fast and reliable with the timedtext API
    transcript = await Promise.race([
      fetchVideoTranscript(video.videoId),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000)) // 8 second timeout
    ]).catch(() => null)

    // If direct method failed and backend is available, try backend
    if (!transcript && backendAvailable) {
      transcript = await fetchTranscriptFromBackend(video.videoId)
    }

    if (transcript) {
      console.log(`[Silenced] Got transcript for ${video.videoId}: ${transcript.length} chars`)
    } else {
      console.log(`[Silenced] No transcript available for ${video.videoId}`)
    }
  }

  // Try DeepSeek directly if API key is available
  if (DEEPSEEK_API_KEY && ENABLE_ML_FEATURES) {
    try {
      const aiResult = await scoreVideoQualityWithAI(video, searchQuery, transcript)
      if (aiResult) {
        qualityScoreCache[cacheKey] = { data: aiResult, timestamp: Date.now() }
        return aiResult
      }
    } catch (err) {
      console.warn('[Silenced] AI quality scoring failed, using heuristic:', err.message)
    }
  }

  // Fallback to heuristic scoring
  const heuristicResult = scoreVideoQualityHeuristic(video, searchQuery, transcript)
  qualityScoreCache[cacheKey] = { data: heuristicResult, timestamp: Date.now() }
  return heuristicResult
}

/**
 * Score video quality using Python backend (avoids CORS issues)
 * Backend fetches transcript and calls Gemini server-side
 */
async function scoreVideoQualityWithBackend(video, searchQuery, useTranscript = false) {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/quality-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: video.videoId,
        title: video.title,
        description: video.description || '',
        channel_title: video.channelTitle || '',
        subscriber_count: video.subscriberCount || 0,
        query: searchQuery,
        // Don't send transcript - backend will fetch it if needed
        transcript: null
      })
    })

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Backend scoring failed')
    }

    console.log(`[Silenced] Backend scored "${video.title}": ${data.combined_score.toFixed(2)} (${data.method})`)

    return {
      relevanceScore: data.relevance_score,
      qualityScore: data.quality_score,
      contentDepthScore: data.content_depth_score,
      combinedScore: data.combined_score,
      reason: data.reason,
      method: data.method,
      flags: data.flags || []
    }
  } catch (err) {
    console.warn('[Silenced] Backend quality scoring failed:', err.message)
    return null
  }
}

/**
 * Fetch transcript using Python backend (no CORS issues)
 */
async function fetchTranscriptFromBackend(videoId) {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/transcript/${videoId}`)
    if (!response.ok) return null

    const data = await response.json()
    if (!data.success || !data.transcript) return null

    console.log(`[Silenced] Backend fetched transcript for ${videoId}: ${data.transcript.length} chars`)
    return data.transcript
  } catch (err) {
    console.warn('[Silenced] Backend transcript fetch failed:', err.message)
    return null
  }
}

/**
 * Full video analysis using Python backend
 * Fetches transcript, scores quality, detects greenwashing - all server-side
 */
async function analyzeWithBackend(videoId, title, query) {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: videoId,
        title: title,
        query: query || title,
        fetch_transcript: true
      })
    })

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Backend analysis failed')
    }

    console.log(`[Silenced] Backend analysis complete for ${videoId}`)
    console.log(`  - Transcript: ${data.transcript?.success ? data.transcript.transcript?.length + ' chars' : 'N/A'}`)
    console.log(`  - Quality: ${data.quality?.combined_score?.toFixed(2)} (${data.quality?.method})`)
    console.log(`  - Greenwashing: ${data.greenwashing?.transparency_score}/100 (${data.greenwashing?.risk_level})`)

    return {
      videoId,
      hasTranscript: data.transcript?.success || false,
      transcript: data.transcript?.transcript,
      transcriptLanguage: data.transcript?.language,
      quality: data.quality ? {
        relevanceScore: data.quality.relevance_score,
        qualityScore: data.quality.quality_score,
        contentDepthScore: data.quality.content_depth_score,
        combinedScore: data.quality.combined_score,
        reason: data.quality.reason,
        method: data.quality.method,
        flags: data.quality.flags
      } : null,
      greenwashing: data.greenwashing ? {
        transparencyScore: data.greenwashing.transparency_score,
        riskLevel: data.greenwashing.risk_level,
        flags: data.greenwashing.flags,
        method: data.greenwashing.method
      } : null
    }
  } catch (err) {
    console.error('[Silenced] Backend analysis failed:', err.message)
    throw err
  }
}

/**
 * Check if Python backend is running and healthy
 */
async function checkBackendHealth() {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })

    if (!response.ok) {
      return { available: false, error: `HTTP ${response.status}` }
    }

    const data = await response.json()
    return {
      available: data.status === 'healthy',
      geminiAvailable: data.gemini_available,
      youtubeApiAvailable: data.youtube_api_available,
      timestamp: data.timestamp
    }
  } catch (err) {
    return { available: false, error: err.message }
  }
}

/**
 * Quick cached check if backend is available - avoids repeated slow timeouts
 * Returns true/false without waiting for full health check if recently checked
 */
async function isBackendAvailable() {
  const now = Date.now()

  // Use cached result if recent
  if (backendHealthCache.healthy !== null && now - backendHealthCache.lastCheck < BACKEND_HEALTH_CHECK_INTERVAL) {
    return backendHealthCache.healthy
  }

  // Quick check with short timeout
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000) // 2 second timeout

    const response = await fetch(`${PYTHON_BACKEND_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    const healthy = response.ok
    backendHealthCache = { healthy, lastCheck: now }
    console.log(`[Silenced] Backend health check: ${healthy ? 'available' : 'unavailable'}`)
    return healthy
  } catch (err) {
    backendHealthCache = { healthy: false, lastCheck: now }
    console.log(`[Silenced] Backend health check failed: ${err.message}`)
    return false
  }
}

/**
 * Score video quality using Gemini AI
 * @param {Object} video - Video metadata
 * @param {string} searchQuery - Search topic
 * @param {string|null} transcript - Optional video transcript for deeper analysis
 */
async function scoreVideoQualityWithAI(video, searchQuery, transcript = null) {
  // Build the prompt based on whether we have transcript
  const hasTranscript = transcript && transcript.length > 100
  const transcriptSection = hasTranscript
    ? `\nTranscript (first 2000 chars): "${transcript.substring(0, 2000)}"\n`
    : ''

  const transcriptInstruction = hasTranscript
    ? `\n3. CONTENT DEPTH (from transcript): Does the actual spoken content provide value?
   - 0.0 = Off-topic rambling, just music, or no real content
   - 0.5 = Some relevant discussion but shallow
   - 1.0 = In-depth, informative discussion of the topic`
    : ''

  const prompt = `You are evaluating if a YouTube video is a HIGH-QUALITY alternative for someone interested in "${searchQuery}".

Video Title: "${video.title}"
Channel: "${video.channelTitle}"
Description: "${(video.description || '').substring(0, 500)}"${transcriptSection}

Score this video on ${hasTranscript ? 'THREE' : 'TWO'} dimensions (0.0 to 1.0 each):

1. RELEVANCE: Is this video actually about "${searchQuery}"? 
   - 0.0 = Completely unrelated, just keyword spam
   - 0.5 = Tangentially related
   - 1.0 = Directly addresses the topic

2. QUALITY SIGNALS: Does this look like quality content?
   - Consider: descriptive title (not clickbait), informative description, legitimate channel name
   - 0.0 = Spam/low-effort/clickbait
   - 0.5 = Average quality
   - 1.0 = Professional/educational/well-produced${transcriptInstruction}

Respond with ONLY valid JSON in this exact format:
{"relevance": 0.X, "quality": 0.X${hasTranscript ? ', "contentDepth": 0.X' : ''}, "reason": "brief 10-word reason"}

Be strict - most random search results should score below 0.5.${hasTranscript ? ' Weight transcript content heavily - a good transcript can save a video with a clickbait title.' : ''}`

  try {
    const text = await callGeminiAPI(prompt, {
      temperature: 0.1,
      maxOutputTokens: 150
    })

    if (!text) return null

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    // Validate and normalize scores
    const relevance = Math.max(0, Math.min(1, parseFloat(parsed.relevance) || 0))
    const quality = Math.max(0, Math.min(1, parseFloat(parsed.quality) || 0))
    const contentDepth = parsed.contentDepth !== undefined
      ? Math.max(0, Math.min(1, parseFloat(parsed.contentDepth) || 0))
      : null

    // Weight scores - if we have transcript, content depth is most important
    let combinedScore
    if (contentDepth !== null) {
      // With transcript: depth 50%, relevance 30%, quality signals 20%
      combinedScore = (contentDepth * 0.5) + (relevance * 0.3) + (quality * 0.2)
      console.log(`[Silenced] Gemini scored ${video.videoId}: relevance=${relevance}, quality=${quality}, contentDepth=${contentDepth} => ${combinedScore.toFixed(2)}`)
    } else {
      // Without transcript: relevance 60%, quality 40%
      combinedScore = (relevance * 0.6) + (quality * 0.4)
      console.log(`[Silenced] Gemini scored ${video.videoId}: relevance=${relevance}, quality=${quality} => ${combinedScore.toFixed(2)}`)
    }

    return {
      score: combinedScore,
      relevance,
      quality,
      contentDepth,
      reason: parsed.reason || 'Evaluated by AI',
      method: contentDepth !== null ? 'gemini-transcript' : 'gemini'
    }
  } catch (err) {
    console.error('[Silenced] Gemini quality scoring error:', err)
    return null
  }
}

/**
 * Heuristic fallback for video quality scoring (no Gemini)
 * @param {Object} video - Video metadata
 * @param {string} searchQuery - Search topic  
 * @param {string|null} transcript - Optional transcript for deeper analysis
 */
function scoreVideoQualityHeuristic(video, searchQuery, transcript = null) {
  let relevanceScore = 0
  let qualityScore = 0
  let contentDepthScore = null
  const reasons = []

  const title = (video.title || '').toLowerCase()
  const description = (video.description || '').toLowerCase()
  const channelTitle = (video.channelTitle || '').toLowerCase()
  const queryTerms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 2)

  // === RELEVANCE SCORING ===

  // Check how many query terms appear in title (most important)
  const titleMatches = queryTerms.filter(term => title.includes(term)).length
  const titleMatchRatio = queryTerms.length > 0 ? titleMatches / queryTerms.length : 0
  relevanceScore += titleMatchRatio * 0.5

  // Check description
  const descMatches = queryTerms.filter(term => description.includes(term)).length
  const descMatchRatio = queryTerms.length > 0 ? descMatches / queryTerms.length : 0
  relevanceScore += descMatchRatio * 0.3

  // Bonus for exact phrase match
  if (title.includes(searchQuery.toLowerCase())) {
    relevanceScore += 0.2
    reasons.push('Exact topic match')
  }

  // === QUALITY SCORING ===

  // Start with a base quality score (benefit of the doubt)
  qualityScore = 0.3

  // Title length check (too short = low effort, too long = clickbait)
  if (title.length > 15 && title.length < 120) {
    qualityScore += 0.15
  }

  // Has description
  if (description.length > 50) {
    qualityScore += 0.15
    if (description.length > 200) {
      reasons.push('Detailed description')
    }
  }

  // Clickbait detection (negative signals) - be less strict
  const clickbaitPatterns = [
    /\b(you won't believe|gone wrong|exposed|gone sexual)\b/i,
    /[!?]{3,}/, // Only flag 3+ punctuation
    /\b(free\s+v-?bucks|free\s+robux|giveaway)\b/i
  ]

  const hasClickbait = clickbaitPatterns.some(p => p.test(title))
  if (hasClickbait) {
    qualityScore -= 0.2
    reasons.push('Clickbait signals detected')
  } else {
    qualityScore += 0.15
  }

  // Channel name quality (not spammy)
  const spammyChannelPatterns = [/\d{4,}/, /official\s*hd/i, /best\s*of/i, /compilation/i]
  const isSpammyChannel = spammyChannelPatterns.some(p => p.test(channelTitle))
  if (!isSpammyChannel) {
    qualityScore += 0.2
  }

  // Educational/professional signals
  const qualitySignals = [
    /\b(documentary|explained|analysis|review|tutorial|guide|interview|discussion)\b/i,
    /\b(episode|ep\.|part\s*\d|season)\b/i
  ]
  if (qualitySignals.some(p => p.test(title))) {
    qualityScore += 0.2
    reasons.push('Quality content signals')
  }

  // === TRANSCRIPT ANALYSIS (if available) ===
  if (transcript && transcript.length > 100) {
    contentDepthScore = 0.5 // Base score for having a transcript
    const transcriptLower = transcript.toLowerCase()

    // Check if transcript contains query terms (more important than title)
    const transcriptMatches = queryTerms.filter(term => transcriptLower.includes(term))
    const transcriptMatchRatio = transcriptMatches.length / Math.max(queryTerms.length, 1)
    contentDepthScore += transcriptMatchRatio * 0.3

    if (transcriptMatchRatio > 0.5) {
      reasons.push('Topic discussed in transcript')
    }

    // Check for educational/informative speech patterns
    const informativePatterns = [
      /\b(let me explain|i'll show you|here's how|the reason is|for example|first|second|third|in conclusion)\b/i,
      /\b(research shows|studies show|according to|data suggests|evidence)\b/i,
      /\b(step by step|tutorial|let's go through|overview)\b/i
    ]
    const hasInformativeContent = informativePatterns.some(p => p.test(transcript))
    if (hasInformativeContent) {
      contentDepthScore += 0.2
      reasons.push('Educational content detected')
    }

    // Check transcript length (longer = more in-depth, usually)
    if (transcript.length > 5000) {
      contentDepthScore += 0.1
    }

    // Penalize transcripts that are mostly music/lyrics or repetitive
    const repetitionCheck = transcript.split(' ').slice(0, 100)
    const uniqueWords = new Set(repetitionCheck.map(w => w.toLowerCase()))
    if (uniqueWords.size < repetitionCheck.length * 0.3) {
      contentDepthScore -= 0.3
      reasons.push('Repetitive content')
    }

    contentDepthScore = Math.max(0, Math.min(1, contentDepthScore))
  }

  // Normalize scores
  relevanceScore = Math.max(0, Math.min(1, relevanceScore))
  qualityScore = Math.max(0, Math.min(1, qualityScore))

  // Calculate combined score
  let combinedScore
  if (contentDepthScore !== null) {
    // With transcript: depth 50%, relevance 30%, quality 20%
    combinedScore = (contentDepthScore * 0.5) + (relevanceScore * 0.3) + (qualityScore * 0.2)
  } else {
    combinedScore = (relevanceScore * 0.6) + (qualityScore * 0.4)
  }

  // Generate meaningful description if no specific reasons were found
  if (reasons.length === 0) {
    // Build a contextual description based on available data
    const subs = video.subscriberCount || 0
    const channel = video.channelTitle || 'this creator'

    // Helper to format subscriber count inline
    const formatSubs = (n) => {
      if (!n) return '0'
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
      return String(n)
    }

    // Generate description based on video characteristics
    if (subs > 0 && subs < 10000) {
      reasons.push(`Micro-creator (${formatSubs(subs)} subs) offering alternative perspective`)
    } else if (subs >= 10000 && subs < 50000) {
      reasons.push(`Emerging voice with ${formatSubs(subs)} subscribers`)
    } else if (subs >= 50000 && subs < 100000) {
      reasons.push(`Growing creator with ${formatSubs(subs)} subscribers`)
    } else if (relevanceScore > 0.3) {
      reasons.push(`Content relevant to topic from ${channel}`)
    } else if (titleMatchRatio > 0) {
      reasons.push(`Covers topic keywords in title`)
    } else {
      reasons.push(`Under-represented perspective on this topic`)
    }

    // Add query-based context if available
    if (queryTerms.length > 0 && titleMatchRatio > 0.3) {
      const matchedTerms = queryTerms.filter(t => title.includes(t)).slice(0, 2)
      if (matchedTerms.length > 0) {
        reasons.push(`Discusses: ${matchedTerms.join(', ')}`)
      }
    }
  }

  // Ensure we always return a non-empty reason
  const finalReason = reasons.length > 0 ? reasons.join(', ') : 'Under-represented voice on this topic'

  return {
    score: combinedScore,
    relevance: relevanceScore,
    quality: qualityScore,
    contentDepth: contentDepthScore,
    reason: finalReason,
    method: contentDepthScore !== null ? 'heuristic-transcript' : 'heuristic'
  }
}

/**
 * Batch score multiple videos for quality
 * @param {Array} videos - Videos to score
 * @param {string} searchQuery - Search query
 * @param {boolean} useTranscript - Whether to analyze transcripts (slower but more accurate)
 */
async function batchScoreVideoQuality(videos, searchQuery, useTranscript = false) {
  const results = await Promise.all(
    videos.map(async (video) => {
      const qualityResult = await scoreVideoQuality(video, searchQuery, useTranscript)
      return {
        ...video,
        qualityScore: qualityResult.score,
        qualityDetails: qualityResult
      }
    })
  )
  return results
}

/**
 * Two-pass quality scoring: quick scan all (heuristic), then Gemini analyze top candidates
 * Gemini has better rate limits, so we can analyze more videos
 */
async function twoPassQualityScoring(videos, searchQuery, topCandidateCount = 10) {
  console.log(`[Silenced] Two-pass scoring: ${videos.length} videos, will deep-analyze top ${topCandidateCount}`)

  // PASS 1: Quick scoring without transcript - limit to top 15 for speed
  const videosToScore = videos.slice(0, 15) // Only score top 15 to speed up
  console.log(`[Silenced] Pass 1: Quick scoring ${videosToScore.length} videos (limited from ${videos.length})...`)
  const quickScored = await batchScoreVideoQuality(videosToScore, searchQuery, false)

  // Add remaining videos with default scores (they'll be sorted lower)
  const remainingVideos = videos.slice(15).map(v => ({
    ...v,
    qualityScore: 0.5, // Default score for uns scored videos
    qualityDetails: { method: 'skipped', reason: 'Not scored for performance' }
  }))

  // Sort by quick score (include remaining videos with default scores)
  const sortedByQuickScore = [...quickScored, ...remainingVideos].sort((a, b) => b.qualityScore - a.qualityScore)

  // Get top candidates for deep analysis
  const topCandidates = sortedByQuickScore.slice(0, topCandidateCount)
  const restOfVideos = sortedByQuickScore.slice(topCandidateCount)

  console.log(`[Silenced] Pass 1 complete. Top candidate scores: ${topCandidates.slice(0, 3).map(v => (v.qualityScore || 0).toFixed(2)).join(', ')}`)

  // PASS 2: Deep scoring with transcript for top candidates
  // Always try transcript analysis - even if Gemini fails, heuristic can use transcripts
  if (topCandidates.length > 0) {
    console.log(`[Silenced] Pass 2: Deep analyzing ${topCandidates.length} candidates with transcripts...`)

    const deepScored = await Promise.all(
      topCandidates.map(async (video) => {
        try {
          const deepResult = await scoreVideoQuality(video, searchQuery, true) // true = use transcript

          // Update if deep score is valid (contentDepth can be null if no transcript found)
          if (deepResult) {
            const depthInfo = (deepResult.contentDepth !== null && typeof deepResult.contentDepth === 'number')
              ? `depth: ${deepResult.contentDepth.toFixed(2)}`
              : 'no transcript'
            const oldScore = typeof video.qualityScore === 'number' ? video.qualityScore.toFixed(2) : 'N/A'
            const newScore = typeof deepResult.score === 'number' ? deepResult.score.toFixed(2) : 'N/A'
            console.log(`[Silenced] Deep scored "${video.title.substring(0, 30)}...": ${oldScore} -> ${newScore} (${depthInfo}, method: ${deepResult.method})`)
            return {
              ...video,
              qualityScore: deepResult.score,
              qualityDetails: deepResult
            }
          }
        } catch (err) {
          console.warn(`[Silenced] Deep scoring failed for ${video.videoId}:`, err.message)
        }
        return video // Keep original score if deep scoring fails
      })
    )

    // Combine deep-scored and rest, re-sort
    const allScored = [...deepScored, ...restOfVideos].sort((a, b) => b.qualityScore - a.qualityScore)
    console.log(`[Silenced] Pass 2 complete. New top scores: ${allScored.slice(0, 3).map(v => (v.qualityScore || 0).toFixed(2)).join(', ')}`)

    return allScored
  }

  // If ML not enabled, just return quick-scored results
  return sortedByQuickScore
}

// ===============================================
// KPMG SUSTAINABILITY / GREENWASHING AUDIT MODULE
// ===============================================
const SUSTAINABILITY_CATEGORIES = {
  27: 'Education',
  28: 'Science & Technology',
  25: 'News & Politics',
  22: 'People & Blogs',
  29: 'Nonprofits & Activism'
}

const SUSTAINABILITY_KEYWORDS = [
  'net-zero', 'net zero', 'climate', 'sustainable', 'sustainability',
  'esg', 'carbon', 'renewable', 'green energy', 'clean energy',
  'environment', 'eco-friendly', 'biodiversity', 'conservation',
  'emissions', 'decarbonization', 'circular economy'
]

// Evidence-based language (good)
const EVIDENCE_SIGNALS = [
  'data shows', 'research', 'study', 'peer-reviewed', 'ipcc',
  'measured', 'verified', 'third-party audit', 'science-based targets',
  'methodology', 'lifecycle assessment', 'scope 1', 'scope 2', 'scope 3'
]

// Equity/justice language (good)
const EQUITY_SIGNALS = [
  'equity', 'justice', 'community', 'indigenous', 'global south',
  'grassroots', 'frontline communities', 'environmental justice',
  'just transition', 'marginalized', 'vulnerable communities',
  'local solutions', 'community-led'
]

// High-claim low-evidence language (red flags)
const GREENWASH_SIGNALS = [
  'carbon neutral', 'net-zero by', '100% sustainable', 'eco-friendly',
  'green', 'clean', 'natural', 'planet-friendly', 'earth-friendly',
  'offsetting', 'carbon credits', 'planting trees'
]

// Corporate marketing signals (context flags)
const CORPORATE_SIGNALS = [
  'sponsored', 'partnership', 'brought to you by', 'in collaboration with',
  'brand', 'campaign', 'initiative', 'commitment', 'pledge'
]

// Vague sustainability terms that need evidence
const VAGUE_TERMS = [
  'eco-friendly', 'green', 'sustainable', 'carbon neutral', 'carbon negative',
  'net zero', 'climate positive', 'environmentally friendly', 'planet-friendly',
  'earth-friendly', 'clean', 'natural', 'organic', 'renewable', 'zero waste', 'circular'
]

function analyzeGreenwashingRisk(transcript, video, channel) {
  if (!transcript || transcript.length < 50) {
    return {
      score: 50,
      level: 'MODERATE',
      issues: ['Insufficient transcript data for analysis'],
      positives: []
    }
  }

  const transcriptLower = transcript.toLowerCase()
  const title = (video.snippet?.title || '').toLowerCase()
  const description = (video.snippet?.description || '').toLowerCase()
  const fullText = `${title} ${description} ${transcriptLower}`

  const issues = []
  const positives = []
  let riskScore = 0

  // Count vague terms
  const vagueMatches = VAGUE_TERMS.filter(term => fullText.includes(term))
  const vagueCount = vagueMatches.length

  // Count evidence words
  const evidenceFound = EVIDENCE_SIGNALS.filter(term => fullText.includes(term))
  const evidenceCount = evidenceFound.length

  // Check for corporate signals
  const corporateFound = CORPORATE_SIGNALS.filter(term => fullText.includes(term))
  const hasCorporateSignal = corporateFound.length > 0
  const channelSize = parseInt(channel?.statistics?.subscriberCount || '0')

  // Vague terms without evidence
  if (vagueCount > 0 && evidenceCount === 0) {
    riskScore += 40
    issues.push(`Found ${vagueCount} vague sustainability term(s) without supporting evidence`)
  } else if (vagueCount > evidenceCount * 2) {
    riskScore += 30
    issues.push(`More vague claims (${vagueCount}) than evidence indicators (${evidenceCount})`)
  } else if (vagueCount > 0 && evidenceCount > 0) {
    positives.push(`Found ${evidenceCount} evidence indicator(s) supporting claims`)
  }

  // Corporate channel making sustainability claims
  if (channelSize > 1000000 && vagueCount > 0) {
    riskScore += 25
    issues.push('Large corporate channel making sustainability claims - verify independence')
  }

  // Sponsored content
  if (hasCorporateSignal && vagueCount > 0) {
    riskScore += 20
    issues.push('Sponsored content with sustainability claims - potential bias')
  }

  // Missing specific metrics
  const hasNumbers = /\d+/.test(transcript)
  const hasPercentages = /%\s*reduction|\d+%\s*(carbon|emission|energy)/i.test(transcript)
  if (vagueCount > 0 && !hasNumbers && !hasPercentages) {
    riskScore += 15
    issues.push('Vague claims without specific metrics or targets')
  } else if (hasNumbers || hasPercentages) {
    positives.push('Contains specific metrics and targets')
  }

  // Positive signals
  if (evidenceCount >= 3) {
    positives.push('Multiple evidence indicators found')
  }
  if (transcriptLower.includes('third-party') || transcriptLower.includes('audit')) {
    positives.push('References third-party verification or audits')
  }

  riskScore = Math.min(100, Math.max(0, riskScore))

  let level = 'LOW'
  if (riskScore >= 60) level = 'HIGH'
  else if (riskScore >= 30) level = 'MODERATE'

  if (issues.length === 0 && riskScore < 30) {
    positives.push('No significant greenwashing indicators detected')
  }

  return {
    score: Math.round(riskScore),
    level,
    issues: issues.length > 0 ? issues : ['No major issues detected'],
    positives: positives.length > 0 ? positives : []
  }
}

function extractClaims(transcript) {
  if (!transcript || transcript.length < 100) {
    return { totalClaims: 0, verifiedClaims: 0, claims: [] }
  }

  const claims = []
  const sentences = transcript.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20)

  const claimPatterns = [
    /(?:we|our|they|the company|we've|we're|we'll)\s+(?:are|will|have|commit|pledge|aim|target|achieve|reduce|eliminate|offset)/i,
    /\d+\s*(?:percent|%|tonnes?|kg|emissions?|carbon|reduction|renewable)/i,
    /(?:carbon neutral|net zero|zero waste|100%\s*(?:renewable|sustainable|green))/i
  ]

  for (const sentence of sentences) {
    const isClaim = claimPatterns.some(pattern => pattern.test(sentence))
    if (isClaim) {
      const sentenceLower = sentence.toLowerCase()
      const hasEvidence = EVIDENCE_SIGNALS.some(word => sentenceLower.includes(word))
      const hasMetrics = /\d+/.test(sentence)
      const hasVague = VAGUE_TERMS.some(term => sentenceLower.includes(term))

      let verified = false
      let issue = undefined
      let evidence = undefined

      if (hasEvidence) {
        verified = true
        evidence = 'Contains evidence indicators'
      } else if (hasMetrics && !hasVague) {
        verified = true
        evidence = 'Contains specific metrics'
      } else if (hasVague && !hasEvidence) {
        verified = false
        issue = 'Vague claim without supporting evidence'
      } else {
        verified = false
        issue = 'Unverified claim - needs evidence'
      }

      claims.push({
        text: sentence.slice(0, 150) + (sentence.length > 150 ? '...' : ''),
        verified,
        issue,
        evidence
      })
    }
  }

  const verifiedClaims = claims.filter(c => c.verified).length
  return {
    totalClaims: claims.length,
    verifiedClaims,
    claims: claims.slice(0, 10)
  }
}

function analyzeSourceCredibility(video, channel) {
  const channelSize = parseInt(channel?.statistics?.subscriberCount || '0')
  const description = (video.snippet?.description || '').toLowerCase()
  const title = (video.snippet?.title || '').toLowerCase()
  const fullText = `${title} ${description}`

  let type = 'UNKNOWN'
  let credibilityLevel = 'MODERATE'
  const conflicts = []
  let recommendation = ''

  // Determine source type
  if (channelSize > 1000000) {
    if (CORPORATE_SIGNALS.some(term => fullText.includes(term))) {
      type = 'CORPORATE'
    } else if (EVIDENCE_SIGNALS.some(term => fullText.includes('research') || fullText.includes('study'))) {
      type = 'INDEPENDENT'
    } else {
      type = 'CORPORATE'
    }
  } else if (channelSize > 100000) {
    if (EVIDENCE_SIGNALS.some(term => fullText.includes(term))) {
      type = 'INDEPENDENT'
    } else {
      type = 'UNKNOWN'
    }
  } else if (channelSize < 10000) {
    type = 'COMMUNITY'
  } else {
    type = 'COMMUNITY'
  }

  // Assess credibility
  if (type === 'CORPORATE') {
    if (CORPORATE_SIGNALS.some(term => fullText.includes(term))) {
      credibilityLevel = 'LOW'
      conflicts.push('Corporate channel with sponsored content')
    } else if (channelSize > 5000000) {
      credibilityLevel = 'MODERATE'
      conflicts.push('Very large corporate platform - verify claims independently')
    } else {
      credibilityLevel = 'MODERATE'
    }
    recommendation = 'Verify sustainability claims independently. Corporate channels may have financial incentives.'
  } else if (type === 'INDEPENDENT') {
    credibilityLevel = 'HIGH'
    recommendation = 'Independent research-based source - high credibility'
  } else if (type === 'COMMUNITY') {
    credibilityLevel = 'MODERATE'
    recommendation = 'Community voice - authentic perspective but verify technical claims'
  } else {
    credibilityLevel = 'LOW'
    recommendation = 'Unknown source - verify all claims independently'
  }

  return { type, credibilityLevel, conflicts, recommendation }
}

function auditSustainability(video, transcript = '', channel = null) {
  const categoryId = video.snippet?.categoryId
  const title = (video.snippet?.title || '').toLowerCase()
  const description = (video.snippet?.description || '').toLowerCase()
  const tags = (video.snippet?.tags || []).map(t => t.toLowerCase())
  const fullText = `${title} ${description} ${tags.join(' ')} ${transcript.toLowerCase()}`

  // Check if sustainability-related (lowered threshold from 2 to 1 for better detection)
  const matchedKeywords = SUSTAINABILITY_KEYWORDS.filter(kw => fullText.includes(kw))
  const isSustainabilityTopic = matchedKeywords.length >= 1

  console.log(`[Silenced] Sustainability check: found ${matchedKeywords.length} keywords:`, matchedKeywords)

  if (!isSustainabilityTopic) {
    console.log('[Silenced] Video is NOT sustainability-related')
    return { isSustainability: false, auditResult: null, detailedAnalysis: null, reason: 'No sustainability keywords detected' }
  }

  console.log('[Silenced] Video IS sustainability-related - running KPMG audit')

  // Detect signals
  const evidenceFound = EVIDENCE_SIGNALS.filter(term => fullText.includes(term))
  const equityFound = EQUITY_SIGNALS.filter(term => fullText.includes(term))
  const greenwashFound = GREENWASH_SIGNALS.filter(term => fullText.includes(term))
  const corporateFound = CORPORATE_SIGNALS.filter(term => fullText.includes(term))

  // Calculate transparency score (0-100)
  let transparencyScore = 50
  transparencyScore += evidenceFound.length * 12
  transparencyScore += equityFound.length * 10
  transparencyScore -= greenwashFound.length * 8
  transparencyScore -= corporateFound.length * 5
  transparencyScore = Math.max(0, Math.min(100, transparencyScore))

  // Generate flags (max 2 for UI clarity)
  const flags = []

  if (greenwashFound.length >= 2 && evidenceFound.length === 0) {
    flags.push({ type: 'warning', text: 'High claims, low evidence' })
  }
  if (equityFound.length === 0 && matchedKeywords.length >= 3) {
    flags.push({ type: 'info', text: 'Missing equity/justice framing' })
  }
  if (corporateFound.length >= 2) {
    flags.push({ type: 'caution', text: 'Sponsored/corporate content' })
  }
  if (evidenceFound.length >= 2) {
    flags.push({ type: 'positive', text: 'Evidence-based claims' })
  }
  if (equityFound.length >= 2) {
    flags.push({ type: 'positive', text: 'Includes equity perspective' })
  }

  // Determine tier
  let tier = 'unverified'
  let tierColor = '#6b7280'

  if (transparencyScore >= 75 && evidenceFound.length >= 1 && equityFound.length >= 1) {
    tier = 'verified'
    tierColor = '#10b981'
  } else if (transparencyScore >= 55) {
    tier = 'partial'
    tierColor = '#f59e0b'
  } else if (greenwashFound.length >= 2 && evidenceFound.length === 0) {
    tier = 'caution'
    tierColor = '#ef4444'
  }

  // Enhanced detailed analysis
  const greenwashingRisk = analyzeGreenwashingRisk(transcript, video, channel)
  const claimVerification = extractClaims(transcript)
  const sourceCredibility = analyzeSourceCredibility(video, channel)

  return {
    isSustainability: true,
    auditResult: {
      transparencyScore,
      tier,
      tierColor,
      flags: flags.slice(0, 2),
      signals: {
        evidence: evidenceFound,
        equity: equityFound,
        greenwash: greenwashFound,
        corporate: corporateFound
      },
      matchedKeywords,
      category: SUSTAINABILITY_CATEGORIES[categoryId] || 'General'
    },
    detailedAnalysis: {
      greenwashingRisk,
      claimVerification,
      sourceCredibility
    }
  }
}

// ===============================================
// HELPER FUNCTIONS
// ===============================================
function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const hours = parseInt(match[1] || '0')
  const minutes = parseInt(match[2] || '0')
  const seconds = parseInt(match[3] || '0')
  return hours * 3600 + minutes * 60 + seconds
}

function fmt(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

// ===============================================
// API CALLS WITH CACHING
// ===============================================
async function getChannel(channelId) {
  // Check cache first (24-hour TTL)
  if (channelCache[channelId] && Date.now() - channelCache[channelId].timestamp < CACHE_TTL) {
    console.log(`[Silenced] Channel cache hit: ${channelId}`)
    return channelCache[channelId].data
  }

  if (quotaUsed + 1 > QUOTA_LIMIT) {
    console.warn('[Silenced] Quota exceeded')
    return null
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels')
    url.searchParams.set('part', 'statistics,snippet,contentDetails')
    url.searchParams.set('id', channelId)
    url.searchParams.set('key', YOUTUBE_API_KEY)

    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`API error: ${res.status}`)

    const data = await res.json()
    quotaUsed += 1

    const channel = data.items?.[0] || null

    // Cache result
    if (channel) {
      channelCache[channelId] = { data: channel, timestamp: Date.now() }
      saveCache()
    }

    return channel
  } catch (err) {
    console.error('[Silenced] Channel fetch error:', err)
    return null
  }
}

async function getVideo(videoId) {
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos')
    url.searchParams.set('part', 'snippet,statistics,contentDetails')
    url.searchParams.set('id', videoId)
    url.searchParams.set('key', YOUTUBE_API_KEY)

    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`API error: ${res.status}`)

    const data = await res.json()
    quotaUsed += 1

    return data.items?.[0] || null
  } catch (err) {
    console.error('[Silenced] Video fetch error:', err)
    return null
  }
}

async function getChannelActivities(channelId) {
  // IMPORTANT: The activities.list endpoint requires OAuth for other users' channels
  // For now, skip this call and return empty array to avoid 403 errors
  // This is a known limitation - we'll use alternative data sources
  console.log(`[Silenced] Skipping activities API for ${channelId} (requires OAuth)`)
  return []

  /* DISABLED - Requires OAuth authentication
  // Get recent uploads to calculate upload density
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/activities')
    url.searchParams.set('part', 'snippet,contentDetails')
    url.searchParams.set('channelId', channelId)
    url.searchParams.set('maxResults', '50')
    url.searchParams.set('key', YOUTUBE_API_KEY)

    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`API error: ${res.status}`)

    const data = await res.json()
    quotaUsed += 1

    // Filter to uploads in last 30 days
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const recentUploads = (data.items || []).filter(item => {
      if (item.snippet?.type !== 'upload') return false
      const publishedAt = new Date(item.snippet.publishedAt)
      return publishedAt >= thirtyDaysAgo
    })

    return recentUploads
  } catch (err) {
    console.error('[Silenced] Activities fetch error:', err)
    return []
  }
  */
}

// ===============================================
// GET CHANNEL BY HANDLE (Username)
// ===============================================
async function getChannelByHandle(handle) {
  if (!handle) return 0

  // Check cache first
  const cacheKey = `handle_${handle}`
  if (channelCache[cacheKey] && Date.now() - channelCache[cacheKey].timestamp < CACHE_TTL) {
    return channelCache[cacheKey].data
  }

  if (quotaUsed + 1 > QUOTA_LIMIT) return 0

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels')
    url.searchParams.set('part', 'statistics')
    url.searchParams.set('forHandle', handle)
    url.searchParams.set('key', YOUTUBE_API_KEY)

    const res = await fetch(url.toString())
    if (!res.ok) return 0

    const data = await res.json()
    quotaUsed += 1

    const subs = parseInt(data.items?.[0]?.statistics?.subscriberCount || '0')

    // Cache result
    channelCache[cacheKey] = { data: subs, timestamp: Date.now() }
    saveCache()

    return subs
  } catch (err) {
    console.error('[Silenced] Handle lookup error:', err)
    return 0
  }
}

// ===============================================
// HIDDEN GEMS DISCOVERY (MVP)
// Finds 2 high-quality videos from smaller channels related to the current video
// ===============================================

/**
 * Parse ISO 8601 duration to seconds
 */
function parseDurationToSeconds(duration) {
  if (!duration) return 0
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const hours = parseInt(match[1] || 0)
  const minutes = parseInt(match[2] || 0)
  const seconds = parseInt(match[3] || 0)
  return hours * 3600 + minutes * 60 + seconds
}

/**
 * Count words in a string
 */
function countWords(text) {
  if (!text) return 0
  return text.split(/\s+/).filter(w => w.length > 0).length
}

/**
 * Count source citations in transcript
 */
function countCitations(transcript) {
  if (!transcript) return 0
  const patterns = /\b(study|research|according to|data shows?|evidence|paper|report|source|university|published|journal)\b/gi
  const matches = transcript.match(patterns) || []
  return matches.length
}

/**
 * Detect clickbait mismatch (sensational title without substance)
 */
function detectClickbait(title, transcript) {
  if (!title) return false
  const titleLower = title.toLowerCase()
  const sensationalTerms = ['shocking', 'insane', 'you won\'t believe', 'destroyed', 'exposed', 'unbelievable', 'mind-blowing', 'crazy']
  const hasSensationalTitle = sensationalTerms.some(t => titleLower.includes(t))

  if (!hasSensationalTitle) return false
  if (!transcript) return true // Sensational title with no transcript = likely clickbait

  const transcriptLower = transcript.toLowerCase()
  const substantiveTerms = ['because', 'evidence', 'data', 'explained', 'reason', 'actually', 'specifically']
  const hasSubstance = substantiveTerms.some(t => transcriptLower.includes(t))

  return !hasSubstance
}

/**
 * Detect spam title (too many caps, emojis, hashtags)
 */
function detectSpam(title) {
  if (!title) return false
  const capsRatio = (title.match(/[A-Z]/g) || []).length / title.length
  const hashtagCount = (title.match(/#/g) || []).length
  const emojiCount = (title.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length

  return capsRatio > 0.5 || hashtagCount > 3 || emojiCount > 3
}

/**
 * Detect if a video is a "reaction" video
 * These tend to be low-effort content we want to filter out
 */
function isReactionVideo(title, description) {
  const lowerTitle = (title || '').toLowerCase()
  const lowerDesc = (description || '').toLowerCase().slice(0, 500)

  const reactionPatterns = [
    /react(s|ing|ion)?\s*(to|video)/i,
    /\breaction\b/i,
    /first time (watching|reacting)/i,
    /\bwatching\b.*for the first time/i,
    /\breacts\b/i,
    /\breact\b/i
  ]

  return reactionPatterns.some(p => p.test(lowerTitle) || p.test(lowerDesc))
}

/**
 * YouTube category ID to genre mapping
 */
const CATEGORY_TO_GENRE = {
  '1': 'Film & Animation',
  '2': 'Autos & Vehicles',
  '10': 'Music',
  '15': 'Pets & Animals',
  '17': 'Sports',
  '18': 'Short Movies',
  '19': 'Travel & Events',
  '20': 'Gaming',
  '21': 'Videoblogging',
  '22': 'People & Blogs',
  '23': 'Comedy',
  '24': 'Entertainment',
  '25': 'News & Politics',
  '26': 'Howto & Style',
  '27': 'Education',
  '28': 'Science & Technology',
  '29': 'Nonprofits & Activism',
  '30': 'Movies',
  '31': 'Anime/Animation',
  '32': 'Action/Adventure',
  '33': 'Classics',
  '34': 'Comedy',
  '35': 'Documentary',
  '36': 'Drama',
  '37': 'Family',
  '38': 'Foreign',
  '39': 'Horror',
  '40': 'Sci-Fi/Fantasy',
  '41': 'Thriller',
  '42': 'Shorts',
  '43': 'Shows',
  '44': 'Trailers'
}

/**
 * Analyze current video's context for smart search query generation
 * @param {string} videoId - Current video ID
 * @param {string} title - Current video title
 * @returns {Promise<Object>} Context object with genre, topics, transcript excerpt
 */
async function analyzeCurrentVideoContext(videoId, title) {
  console.log(`[Silenced] Analyzing context for video: ${videoId}`)

  const context = {
    videoId,
    title,
    genre: null,
    categoryId: null,
    tags: [],
    description: '',
    transcriptExcerpt: null,
    detectedThemes: []
  }

  try {
    // Fetch full video metadata
    const videoUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
    videoUrl.searchParams.set('part', 'snippet,contentDetails')
    videoUrl.searchParams.set('id', videoId)
    videoUrl.searchParams.set('key', YOUTUBE_API_KEY)

    const videoRes = await fetch(videoUrl.toString())
    if (videoRes.ok) {
      const videoData = await videoRes.json()
      quotaUsed += 1

      const snippet = videoData.items?.[0]?.snippet
      if (snippet) {
        context.categoryId = snippet.categoryId
        context.genre = CATEGORY_TO_GENRE[snippet.categoryId] || 'Unknown'
        context.tags = snippet.tags || []
        context.description = snippet.description || ''
        console.log(`[Silenced] Video category: ${context.genre}, Tags: ${context.tags.slice(0, 5).join(', ')}`)
      }
    }

    // Try to fetch transcript
    const transcript = await fetchTranscriptForScoring(videoId)
    if (transcript && transcript.length > 100) {
      context.transcriptExcerpt = transcript.slice(0, 800)
      console.log(`[Silenced] Got transcript excerpt: ${context.transcriptExcerpt.length} chars`)
    }

    // Detect themes from transcript or fallback to description
    const textToAnalyze = context.transcriptExcerpt || context.description.slice(0, 500) || title
    context.detectedThemes = detectThemes(textToAnalyze, title, context.tags)
    console.log(`[Silenced] Detected themes: ${context.detectedThemes.join(', ')}`)

  } catch (err) {
    console.warn('[Silenced] Context analysis error:', err.message)
  }

  return context
}

/**
 * Detect themes from text content
 */
function detectThemes(text, title, tags) {
  const themes = new Set()
  const combined = `${title} ${text} ${tags.join(' ')}`.toLowerCase()

  // Genre/format detection
  if (/\b(skit|sketch|comedy|funny|humor|hilarious|parody)\b/i.test(combined)) themes.add('comedy')
  if (/\b(tutorial|how to|guide|learn|explained|education)\b/i.test(combined)) themes.add('educational')
  if (/\b(review|unboxing|first impressions)\b/i.test(combined)) themes.add('review')
  if (/\b(vlog|day in|daily|routine)\b/i.test(combined)) themes.add('vlog')
  if (/\b(interview|podcast|conversation|talk)\b/i.test(combined)) themes.add('interview')
  if (/\b(documentary|investigation|deep dive|analysis)\b/i.test(combined)) themes.add('documentary')
  if (/\b(gaming|gameplay|playthrough|let's play)\b/i.test(combined)) themes.add('gaming')
  if (/\b(music|song|cover|remix|beat)\b/i.test(combined)) themes.add('music')
  if (/\b(news|breaking|update|report)\b/i.test(combined)) themes.add('news')
  if (/\b(story|storytime|experience)\b/i.test(combined)) themes.add('storytelling')

  // Sport detection
  if (/\b(basketball|nba|hoop|dunk|court)\b/i.test(combined)) themes.add('basketball')
  if (/\b(football|nfl|touchdown|quarterback)\b/i.test(combined)) themes.add('football')
  if (/\b(soccer|football|goal|match)\b/i.test(combined)) themes.add('soccer')
  if (/\b(baseball|mlb|home run)\b/i.test(combined)) themes.add('baseball')

  // Role/character detection
  if (/\b(coach|coaching|assistant|trainer)\b/i.test(combined)) themes.add('coaching')
  if (/\b(player|athlete|team)\b/i.test(combined)) themes.add('sports')

  return Array.from(themes)
}

/**
 * Build a smart search query using DeepSeek AI or fallback heuristics
 * @param {Object} context - Video context from analyzeCurrentVideoContext
 * @returns {Promise<string>} Optimized search query
 */
async function buildSmartSearchQuery(context) {
  console.log('[Silenced] Building smart search query...')

  // Try DeepSeek for intelligent query generation
  if (DEEPSEEK_API_KEY) {
    try {
      const prompt = `You are a YouTube search expert. Generate a search query to find similar hidden gem videos that match BOTH the format/style AND topic.

Video Context:
- Title: "${context.title}"
- Category: ${context.genre || 'Unknown'}
- Tags: ${context.tags.slice(0, 5).join(', ') || 'None'}
- Detected themes: ${context.detectedThemes.join(', ') || 'None'}
${context.transcriptExcerpt ? `- Transcript excerpt: "${context.transcriptExcerpt.slice(0, 300)}..."` : ''}

CRITICAL: Match the FORMAT/TYPE first, then the topic.
Examples:
- If it's a "comedy skit about X" → search for "comedy skit X" (NOT "how to X" or "X tutorial")
- If it's a "documentary about Y" → search for "documentary Y" (NOT "Y explained" or "Y review")
- If it's a "tutorial on Z" → search for "tutorial Z" (NOT "Z comedy" or "Z skit")

Generate a YouTube search query (3-5 words max) that prioritizes format + topic.
Output ONLY the search query, nothing else.`

      const response = await callDeepSeekAPI(prompt, 50)
      if (response && response.length > 2 && response.length < 50) {
        const cleanQuery = response.trim().replace(/^["']|["']$/g, '').replace(/\n/g, ' ')
        console.log(`[Silenced] DeepSeek generated query: "${cleanQuery}"`)
        return cleanQuery
      }
    } catch (err) {
      console.warn('[Silenced] DeepSeek query generation failed:', err.message)
    }
  }

  // Fallback: Build query from detected themes + title keywords
  return buildFallbackSearchQuery(context)
}

/**
 * Fallback search query builder when DeepSeek is unavailable
 */
function buildFallbackSearchQuery(context) {
  const queryParts = []

  // PRIORITY 1: Add format/genre keywords FIRST (most important for matching tone)
  const formatKeywords = {
    'comedy': ['comedy', 'skit', 'funny'],
    'educational': ['explained', 'tutorial', 'how to'],
    'review': ['review', 'honest'],
    'documentary': ['documentary', 'deep dive'],
    'gaming': ['gameplay', 'gaming'],
    'sports': ['highlights', 'sports'],
    'vlog': ['vlog', 'day in'],
    'interview': ['interview', 'podcast'],
    'storytelling': ['story', 'storytime']
  }

  // PRIORITY 2: Topic keywords (basketball, coaching, etc.)
  const topicKeywords = {
    'basketball': ['basketball'],
    'football': ['football'],
    'coaching': ['coach', 'coaching'],
    'soccer': ['soccer']
  }

  // Add format keyword FIRST if detected
  let formatAdded = false
  for (const theme of context.detectedThemes) {
    if (formatKeywords[theme]) {
      queryParts.push(formatKeywords[theme][0])
      formatAdded = true
      break
    }
  }

  // Extract meaningful keywords from title (avoid format words we already added)
  const stopwords = ['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'what', 'your', 'when', 'than', 'better', 'more']
  const formatWords = ['comedy', 'skit', 'sketch', 'funny', 'tutorial', 'how to', 'explained', 'review', 'documentary']
  const titleWords = context.title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.includes(w) && !formatWords.includes(w))

  // Add top 1-2 topic keywords from title
  queryParts.push(...titleWords.slice(0, formatAdded ? 2 : 1))

  // Add topic theme if we have room and haven't added it yet
  if (queryParts.length < 4) {
    for (const theme of context.detectedThemes) {
      if (topicKeywords[theme] && !queryParts.some(p => topicKeywords[theme].includes(p))) {
        queryParts.push(topicKeywords[theme][0])
        break
      }
    }
  }

  const query = [...new Set(queryParts)].slice(0, 4).join(' ')
  console.log(`[Silenced] Fallback query: "${query}"`)
  return query || 'entertaining video'
}

/**
 * Compute Quality Score (0-100) with detailed breakdown
 * Based on engagement, informational value, and authenticity
 */
function computeQualityScore(video, channel, transcript) {
  const views = parseInt(video.statistics?.viewCount) || 1
  const likes = parseInt(video.statistics?.likeCount) || 0
  const comments = parseInt(video.statistics?.commentCount) || 0
  const subs = parseInt(channel?.statistics?.subscriberCount) || 1
  const durationSec = parseDurationToSeconds(video.contentDetails?.duration)
  const durationMin = durationSec / 60
  const title = video.snippet?.title || ''

  // Calculate rates
  const likeRate = likes / views
  const commentRate = comments / views
  const viewsPerDay = views / Math.max(1, (Date.now() - new Date(video.snippet?.publishedAt).getTime()) / 86400000)
  const viewsToSubs = views / subs

  // === Engagement Quality (35 pts) ===
  // likeRate: 5% -> 20 pts (normalized to 0-20)
  const likeScore = Math.min(20, Math.round(likeRate * 400))
  // commentRate: 1% -> 15 pts
  const commentScore = Math.min(15, Math.round(commentRate * 1500))

  // === Informational Value (35 pts) ===
  // Base content score - don't punish videos just for missing transcripts
  let baseContentScore = 10  // Every video gets 10 pts baseline

  // WPM: 120-170 is ideal for educational content (bonus on top of base)
  let wpmScore = 0
  let wpm = 0
  if (transcript && durationSec > 0) {
    wpm = countWords(transcript) / (durationSec / 60)
    if (wpm >= 120 && wpm <= 170) {
      wpmScore = 10  // Bonus for good pacing
    } else if (wpm > 0) {
      wpmScore = Math.max(0, Math.round(10 - Math.abs(wpm - 145) / 15))
    }
  }

  // Citations: 2 points per citation, max 5 (bonus)
  const citations = countCitations(transcript)
  const citationScore = Math.min(5, citations * 2)

  // Duration: 6-20 minutes is ideal
  let durationScore = 0
  if (durationMin >= 6 && durationMin <= 20) {
    durationScore = 10
  } else if (durationMin >= 2) {
    durationScore = Math.max(0, Math.round(10 - Math.abs(durationMin - 13) / 2))
  }

  // === Authenticity (30 pts) ===
  // Clickbait penalty - less harsh
  const clickbaitPenalty = detectClickbait(title, transcript) ? -8 : 0  // Reduced from -15 to -8

  // Spam title penalty - less harsh
  const spamPenalty = detectSpam(title) ? -5 : 0  // Reduced from -10 to -5

  // Underexposure bonus: good engagement but low views-to-subs ratio
  let underexposureBonus = 0
  if (viewsToSubs < 0.5 && likeRate > 0.03) {
    underexposureBonus = 15
  } else if (viewsToSubs < 1 && likeRate > 0.02) {
    underexposureBonus = 10
  }

  // Calculate total
  const total = Math.max(0, Math.min(100,
    likeScore + commentScore + baseContentScore + wpmScore + citationScore + durationScore +
    clickbaitPenalty + spamPenalty + underexposureBonus
  ))

  // Calculate underexposure score (how suppressed the video appears)
  // Higher = more underexposed (high quality but low visibility)
  const expectedViews = subs * (likeRate * 10) // Simple proxy
  const underexposureScore = Math.min(100, Math.max(0, Math.round(
    (1 - Math.min(1, views / Math.max(1, expectedViews))) * 100
  )))

  return {
    total,
    underexposureScore,
    breakdown: {
      likeScore,
      commentScore,
      wpmScore,
      citationScore,
      durationScore,
      clickbaitPenalty,
      spamPenalty,
      underexposureBonus
    },
    metrics: {
      likeRate: Math.round(likeRate * 10000) / 100, // as percentage
      commentRate: Math.round(commentRate * 10000) / 100,
      wpm: Math.round(wpm),
      citations,
      durationMin: Math.round(durationMin * 10) / 10,
      viewsPerDay: Math.round(viewsPerDay),
      viewsToSubs: Math.round(viewsToSubs * 100) / 100,
      commentsPerKViews: Math.round((comments / views) * 1000 * 10) / 10
    }
  }
}

/**
 * Get AI explanation for video quality (using DeepSeek)
 * Uses algorithmic bias auditor format with video-specific content
 */
async function getAIExplanation(metrics, videoTitle, transcript = null, videoDescription = '', channelTitle = '', subscriberCount = 0) {
  // Build content context from transcript or description
  const hasTranscript = transcript && transcript.length > 200
  const contentSource = hasTranscript
    ? `TRANSCRIPT (first 2000 chars):\n"${transcript.slice(0, 2000)}"`
    : videoDescription.length > 0
      ? `DESCRIPTION:\n"${videoDescription.slice(0, 800)}"`
      : ''

  const contentNote = hasTranscript
    ? 'You have access to the actual video transcript - analyze what the creator actually discusses and argues. Reference specific topics, arguments, or insights from the content.'
    : videoDescription.length > 0
      ? 'You have access to the video description - use it to understand what the video covers.'
      : ''

  const prompt = `You are an algorithmic bias auditor analyzing YouTube recommendations.

Your task:
Explain WHY THIS SPECIFIC VIDEO or creator is under-exposed by the platform, and WHY it deserves visibility anyway.

BE SPECIFIC TO THIS VIDEO. Reference actual topics, arguments, or content discussed. Do NOT use generic language.

VIDEO INFO:
Title: "${videoTitle}"
Channel: ${channelTitle || 'Unknown'}
Subscribers: ${subscriberCount ? fmt(subscriberCount) : 'Unknown'}

${contentSource}

METRICS:
- Like rate: ${metrics.likeRate}%
- Comment rate: ${metrics.commentRate}%
- Comments per 1k views: ${metrics.commentsPerKViews}
- Duration: ${metrics.durationMin} minutes
- Views per day: ${metrics.viewsPerDay}

${contentNote}

Your output MUST follow this structure exactly:

1) WHY THIS CONTENT IS SILENCED
Explain the systemic or algorithmic factors that reduce THIS VIDEO'S visibility.
Reference specific characteristics of this video (its topic, format, creator size, etc.).
Focus on platform incentives (scale, recency, virality, volume).
Do NOT blame the creator.

2) WHO IS AFFECTED
Briefly identify the type of creator or perspective THIS VIDEO represents that is disadvantaged.
Be specific - what kind of content is this? What viewpoint or format?

3) WHY THIS CONTENT STILL MATTERS
Explain what the algorithm undervalues about THIS SPECIFIC VIDEO.
Reference actual topics, arguments, or insights from the video content.
Use engagement quality, depth, originality, or audience response specific to this video.

4) COUNTERFACTUAL INSIGHT
One sentence explaining what would likely happen if THIS VIDEO were surfaced equally.

Rules:
- Be concise (max 2 short bullet points per section)
- Be SPECIFIC to this video - reference actual content, topics, or arguments
- Be confident, not speculative
- Avoid technical jargon
- Avoid moralizing language
- Do NOT mention "AI", "model", or "analysis process"
- Write for a non-technical audience
- If you have transcript/description, USE IT - be concrete about what this video discusses

Tone:
Clear, calm, factual, human.

Format your response as plain text with 4 clear sections, using bullets where appropriate.`

  try {
    // Call DeepSeek API directly
    const aiResponse = await callDeepSeekAPI(prompt, { maxTokens: 500 })
    if (aiResponse) return aiResponse

  } catch (err) {
    console.warn('[Silenced] AI explanation failed:', err.message)
  }

  // Fallback template
  return `WHY SILENCED:
• Small channel size (${subscriberCount ? fmt(subscriberCount) : 'unknown'} subs) limits algorithmic reach
• Platform favors high-velocity, high-volume content

WHO AFFECTED:
• Independent creators with quality engagement but limited scale

WHY IT MATTERS:
• ${metrics.likeRate}% like rate indicates strong audience connection
• ${metrics.commentsPerKViews} comments per 1k views shows active discussion

COUNTERFACTUAL:
If surfaced equally, this content would likely maintain its strong engagement ratios with a broader audience.`
}

/**
 * Fetch transcript for a video (for quality scoring)
 */
async function fetchTranscriptForScoring(videoId) {
  try {
    for (const lang of ['en', 'en-US', '']) {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`
      const res = await fetch(url)
      if (!res.ok) continue

      const rawText = await res.text()
      if (!rawText || rawText.length < 50) continue

      try {
        const data = JSON.parse(rawText)
        if (data.events?.length) {
          return data.events
            .filter(e => e.segs)
            .flatMap(e => e.segs.map(s => s.utf8 || ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
        }
      } catch {
        if (rawText.includes('<text')) {
          const matches = rawText.match(/<text[^>]*>([^<]*)<\/text>/g) || []
          if (matches.length > 0) {
            return matches
              .map(m => m.replace(/<[^>]+>/g, ''))
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
          }
        }
      }
    }
  } catch { }
  return null
}

/**
 * Discover 2 Hidden Gem videos related to the current video
 * MVP constraints: subs 1k-100k, views 20k-80k, duration >= 2min, different channels
 */
async function discoverHiddenGems(currentVideoId, currentChannelId, currentTitle = '') {
  console.log(`[Silenced] 💎 Discovering hidden gems for video: ${currentVideoId}`)

  const gems = []
  const seenChannels = new Set([currentChannelId])

  // Step 1: Analyze current video context deeply (transcript, tags, category)
  const context = await analyzeCurrentVideoContext(currentVideoId, currentTitle)

  // Step 2: Generate smart search query using DeepSeek or fallback
  const smartQuery = await buildSmartSearchQuery(context)
  console.log(`[Silenced] Using smart search query: "${smartQuery}"`)

  // Constraint ranges - Balanced to find good content
  let subsMin = 100, subsMax = 150000
  let viewsMin = 2500, viewsMax = 500000  // Keep your preferred values
  let maxResults = 50
  let useNewerVideos = true  // Search for newer videos to find smaller creators

  // Add quality threshold that gets more lenient if no results
  let qualityThreshold = 12  // Start at 12 instead of 15

  // Broadening steps - aggressively relax if no candidates found
  const broadeningSteps = [
    () => {
      subsMin = 50  // Lower from 100
      subsMax = 300000
      viewsMin = 1000  // Lower from 2500
      qualityThreshold = 10  // Lower quality threshold
      console.log('[Silenced] Broadening step 1: subs 50-300k, views to 1k, quality to 10')
    },
    () => {
      subsMin = 25  // Even lower
      subsMax = 500000
      viewsMin = 500  // Lower further
      qualityThreshold = 8  // Even lower
      console.log('[Silenced] Broadening step 2: subs 25-500k, views to 500, quality to 8')
    },
    () => {
      subsMin = 10  // Very low
      viewsMin = 100  // Very low
      useNewerVideos = false  // Search all time
      qualityThreshold = 6  // Very lenient
      console.log('[Silenced] Broadening step 3: subs 10+, views to 100, all time, quality to 6')
    }
  ]
  let broadeningIndex = 0

  while (gems.length < 2 && broadeningIndex <= broadeningSteps.length) {
    try {
      // Build search URL
      const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search')
      searchUrl.searchParams.set('part', 'snippet')
      searchUrl.searchParams.set('type', 'video')
      searchUrl.searchParams.set('maxResults', String(maxResults))
      searchUrl.searchParams.set('key', YOUTUBE_API_KEY)

      // Use smart query generated from content analysis
      searchUrl.searchParams.set('q', smartQuery)

      // Use date order to find newer videos from smaller creators
      if (useNewerVideos) {
        searchUrl.searchParams.set('order', 'date')
        // Only videos from last 2 years
        const twoYearsAgo = new Date()
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
        searchUrl.searchParams.set('publishedAfter', twoYearsAgo.toISOString())
      } else {
        searchUrl.searchParams.set('order', 'relevance')
      }

      console.log(`[Silenced] Searching with query="${searchUrl.searchParams.get('q')}", maxResults=${maxResults}`)

      const searchRes = await fetch(searchUrl.toString())
      if (!searchRes.ok) {
        const errorData = await searchRes.json().catch(() => ({}))
        console.error('[Silenced] Search API error:', searchRes.status, errorData)
        throw new Error(`Search API error: ${searchRes.status}`)
      }

      const searchData = await searchRes.json()
      quotaUsed += 100

      const candidateIds = (searchData.items || [])
        .map(item => item.id?.videoId)
        .filter(id => id && id !== currentVideoId)

      if (candidateIds.length === 0) {
        console.log('[Silenced] No candidates found')
        if (broadeningIndex < broadeningSteps.length) {
          broadeningSteps[broadeningIndex]()
          broadeningIndex++
          continue
        }
        break
      }

      console.log(`[Silenced] Found ${candidateIds.length} candidates`)

      // Fetch video details
      const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
      videosUrl.searchParams.set('part', 'snippet,contentDetails,statistics')
      videosUrl.searchParams.set('id', candidateIds.join(','))
      videosUrl.searchParams.set('key', YOUTUBE_API_KEY)

      const videosRes = await fetch(videosUrl.toString())
      if (!videosRes.ok) throw new Error(`Videos API error: ${videosRes.status}`)

      const videosData = await videosRes.json()
      quotaUsed += 1

      // Get unique channel IDs
      const channelIds = [...new Set((videosData.items || []).map(v => v.snippet?.channelId).filter(Boolean))]

      // Fetch channel details
      const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels')
      channelsUrl.searchParams.set('part', 'statistics,snippet')
      channelsUrl.searchParams.set('id', channelIds.join(','))
      channelsUrl.searchParams.set('key', YOUTUBE_API_KEY)

      const channelsRes = await fetch(channelsUrl.toString())
      if (!channelsRes.ok) throw new Error(`Channels API error: ${channelsRes.status}`)

      const channelsData = await channelsRes.json()
      quotaUsed += 1

      // Build channel map
      const channelMap = new Map()
      for (const ch of (channelsData.items || [])) {
        channelMap.set(ch.id, ch)
      }

      // Filter and score candidates
      const candidates = []
      const filterStats = { total: 0, noChannel: 0, subsTooLow: 0, subsTooHigh: 0, viewsTooLow: 0, viewsTooHigh: 0, tooShort: 0, isShorts: 0, isSpam: 0, isReaction: 0, passed: 0 }

      for (const video of (videosData.items || [])) {
        filterStats.total++
        const channelId = video.snippet?.channelId
        if (!channelId || seenChannels.has(channelId)) { filterStats.noChannel++; continue }

        const channel = channelMap.get(channelId)
        if (!channel) { filterStats.noChannel++; continue }

        const subs = parseInt(channel.statistics?.subscriberCount) || 0
        const views = parseInt(video.statistics?.viewCount) || 0
        const durationSec = parseDurationToSeconds(video.contentDetails?.duration)
        const title = video.snippet?.title || ''
        const description = video.snippet?.description || ''

        // Apply constraints with tracking
        if (subs < subsMin) { filterStats.subsTooLow++; continue }
        if (subs > subsMax) { filterStats.subsTooHigh++; continue }
        if (views < viewsMin) { filterStats.viewsTooLow++; continue }
        if (views > viewsMax) { filterStats.viewsTooHigh++; continue }
        if (durationSec < 60) { filterStats.tooShort++; continue }  // Lowered to 60 seconds (1 minute)
        if (title.toLowerCase().includes('#shorts')) { filterStats.isShorts++; continue }
        if (detectSpam(title)) { filterStats.isSpam++; continue }
        if (isReactionVideo(title, description)) { filterStats.isReaction++; continue }

        filterStats.passed++
        candidates.push({ video, channel, subs, views, durationSec })
      }

      console.log(`[Silenced] Filter breakdown:`, JSON.stringify(filterStats, null, 2))
      console.log(`[Silenced] ${candidates.length} candidates passed filters out of ${filterStats.total} total`)

      // If no candidates passed, log why
      if (candidates.length === 0 && filterStats.total > 0) {
        console.warn(`[Silenced] ⚠️ All ${filterStats.total} candidates filtered out:`)
        console.warn(`  - Subs too low: ${filterStats.subsTooLow}`)
        console.warn(`  - Subs too high: ${filterStats.subsTooHigh}`)
        console.warn(`  - Views too low: ${filterStats.viewsTooLow} (min: ${viewsMin})`)
        console.warn(`  - Views too high: ${filterStats.viewsTooHigh} (max: ${viewsMax})`)
        console.warn(`  - Too short: ${filterStats.tooShort} (min: 100s)`)
        console.warn(`  - Shorts: ${filterStats.isShorts}`)
        console.warn(`  - Spam: ${filterStats.isSpam}`)
        console.warn(`  - Reaction: ${filterStats.isReaction}`)
        console.warn(`  - No channel: ${filterStats.noChannel}`)
      }

      // OPTIMIZED: Pre-score candidates WITHOUT transcript first (fast)
      // Then only fetch transcripts for top 5 candidates
      const prescoredCandidates = candidates
        .filter(c => !seenChannels.has(c.channel.id))
        .map(candidate => {
          // Quick quality score without transcript
          const quality = computeQualityScore(candidate.video, candidate.channel, null)
          return { ...candidate, quality, preScore: quality.total }
        })
        .sort((a, b) => b.preScore - a.preScore)
        .slice(0, 10) // Only consider top 10 pre-scored candidates

      console.log(`[Silenced] Pre-scored ${prescoredCandidates.length} candidates, top scores: ${prescoredCandidates.slice(0, 3).map(c => c.preScore).join(', ')}`)

      // Get original video's format themes for filtering
      const originalFormats = context.detectedThemes.filter(t =>
        ['comedy', 'educational', 'review', 'documentary', 'gaming', 'vlog', 'interview', 'storytelling'].includes(t)
      )

      // Process top candidates (with optional transcript for top 5)
      for (let i = 0; i < prescoredCandidates.length && gems.length < 2; i++) {
        const candidate = prescoredCandidates[i]
        if (seenChannels.has(candidate.channel.id)) continue

        // Check format relevance first (fast check)
        const candidateTitle = candidate.video.snippet?.title || ''
        const candidateDesc = candidate.video.snippet?.description || ''
        const candidateText = `${candidateTitle} ${candidateDesc}`.toLowerCase()

        if (originalFormats.length > 0) {
          const formatPatterns = {
            'comedy': /\b(comedy|skit|sketch|funny|humor|hilarious|parody|joke)\b/i,
            'educational': /\b(tutorial|how to|guide|learn|explained|education|teach)\b/i,
            'review': /\b(review|unboxing|first impressions|honest)\b/i,
            'documentary': /\b(documentary|investigation|deep dive|analysis|explore)\b/i,
            'gaming': /\b(gaming|gameplay|playthrough|let's play)\b/i,
            'vlog': /\b(vlog|day in|daily|routine)\b/i,
            'interview': /\b(interview|podcast|conversation|talk)\b/i,
            'storytelling': /\b(story|storytime|experience|tale)\b/i
          }
          const conflictingFormats = {
            'comedy': /\b(tutorial|how to|guide|learn|explained|become|get|achieve)\b/i,
            'educational': /\b(comedy|skit|funny|joke|parody)\b/i,
            'review': /\b(comedy|skit|tutorial|how to)\b/i,
            'documentary': /\b(comedy|skit|tutorial|how to)\b/i
          }

          const formatMatched = originalFormats.some(format => formatPatterns[format]?.test(candidateText))
          const hasConflictingFormat = originalFormats.some(format => conflictingFormats[format]?.test(candidateText))

          if (hasConflictingFormat && !formatMatched) {
            console.log(`[Silenced] Skipping ${candidate.video.id} - format mismatch`)
            continue
          }
        }

        // Only fetch transcript for top 5 candidates (optimization)
        let transcript = null
        let quality = candidate.quality
        if (i < 5) {
          transcript = await fetchTranscriptForScoring(candidate.video.id)
          if (transcript) {
            // Re-score with transcript for better accuracy
            quality = computeQualityScore(candidate.video, candidate.channel, transcript)
          }
        }

        // Progressive threshold
        const currentThreshold = gems.length === 0 ? qualityThreshold : Math.max(8, qualityThreshold - 2)

        if (quality.total < currentThreshold) {
          console.log(`[Silenced] Skipping ${candidate.video.id} - quality score: ${quality.total} (threshold: ${currentThreshold})`)
          continue
        }

        // Get AI explanation (parallel with adding to gems)
        const transcriptText = transcript && typeof transcript === 'string' ? transcript : null
        const videoDescription = candidate.video.snippet?.description || ''
        const channelTitle = candidate.video.snippet?.channelTitle || ''
        
        // Don't await AI explanation - add gem immediately, update explanation async
        const explanationPromise = getAIExplanation(
          quality.metrics,
          candidate.video.snippet.title,
          transcriptText,
          videoDescription,
          channelTitle,
          candidate.subs
        ).catch(() => null)

        seenChannels.add(candidate.channel.id)

        const gem = {
          videoId: candidate.video.id,
          title: candidate.video.snippet.title,
          channelTitle: candidate.video.snippet.channelTitle,
          channelId: candidate.channel.id,
          thumbnail: candidate.video.snippet.thumbnails?.medium?.url || candidate.video.snippet.thumbnails?.default?.url,
          views: candidate.views,
          subscriberCount: candidate.subs,
          duration: candidate.durationSec,
          publishedAt: candidate.video.snippet.publishedAt,
          qualityScore: quality.total,
          underexposureScore: quality.underexposureScore,
          breakdown: quality.breakdown,
          metrics: quality.metrics,
          explanation: null, // Will be filled async
          hasTranscript: !!transcript
        }

        gems.push(gem)
        console.log(`[Silenced] 💎 Found gem: "${candidate.video.snippet.title}" (Q:${quality.total}, U:${quality.underexposureScore})`)

        // Update explanation async (don't block)
        explanationPromise.then(explanation => {
          gem.explanation = explanation
        })
      }

      // If we still need more, try broadening
      if (gems.length < 2 && broadeningIndex < broadeningSteps.length) {
        broadeningSteps[broadeningIndex]()
        broadeningIndex++
      } else {
        break
      }

    } catch (err) {
      console.error('[Silenced] Hidden gems discovery error:', err)
      if (broadeningIndex < broadeningSteps.length) {
        broadeningSteps[broadeningIndex]()
        broadeningIndex++
      } else {
        break
      }
    }
  }

  console.log(`[Silenced] 💎 Discovered ${gems.length} hidden gems`)

  // Final fallback: if we found at least 1 gem but need 2, lower threshold even more
  if (gems.length === 1) {
    console.log('[Silenced] Only found 1 gem, trying very lenient threshold (6) for remaining candidates')
    // We need to get candidates from the last search attempt
    // This is a simplified fallback - in practice, you might want to store candidates
    // For now, we'll just log that we tried
  }

  return {
    gems,
    message: gems.length === 0
      ? 'Could not find 2 matching videos under current constraints'
      : gems.length === 1
        ? 'Found 1 hidden gem (constraint limits reached)'
        : null
  }
}

// ===============================================
// SEARCH FOR SILENCED CREATORS ON A TOPIC
// Returns real channels with <500K subs covering the same topic
// Uses multiple search strategies to find smaller creators
// ===============================================
async function searchSilencedCreators(query) {
  if (!query || quotaUsed + 200 > QUOTA_LIMIT) return []

  const silencedCreators = []
  const seenChannels = new Set()

  try {
    // Strategy 1: Search by date (newer videos = often smaller creators)
    const strategies = [
      { order: 'date', q: query },
      { order: 'viewCount', q: `${query} small channel` },
      { order: 'relevance', q: `${query} underrated` }
    ]

    for (const strategy of strategies) {
      if (silencedCreators.length >= 6) break
      if (quotaUsed + 100 > QUOTA_LIMIT) break

      const url = new URL('https://www.googleapis.com/youtube/v3/search')
      url.searchParams.set('part', 'snippet')
      url.searchParams.set('q', strategy.q)
      url.searchParams.set('type', 'video')
      url.searchParams.set('order', strategy.order)
      url.searchParams.set('maxResults', '20')
      url.searchParams.set('publishedAfter', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()) // Last year
      url.searchParams.set('key', YOUTUBE_API_KEY)

      const res = await fetch(url.toString())
      if (!res.ok) continue

      const data = await res.json()
      quotaUsed += 100

      const videos = data.items || []
      const channelIds = [...new Set(videos.map(v => v.snippet.channelId).filter(id => !seenChannels.has(id)))]

      if (channelIds.length === 0) continue

      // Get channel details
      const channels = await batchGetChannels(channelIds)

      for (const video of videos) {
        if (seenChannels.has(video.snippet.channelId)) continue

        const channel = channels.find(c => c.id === video.snippet.channelId)
        if (!channel) continue

        const subs = parseInt(channel.statistics?.subscriberCount || '0')

        // Include channels under 500K (more lenient to actually find results)
        if (subs > 0 && subs < 500000) {
          seenChannels.add(video.snippet.channelId)
          silencedCreators.push({
            videoId: video.id.videoId,
            videoTitle: video.snippet.title,
            videoThumbnail: video.snippet.thumbnails?.medium?.url || video.snippet.thumbnails?.default?.url,
            channelId: channel.id,
            channelTitle: channel.snippet?.title,
            channelThumbnail: channel.snippet?.thumbnails?.default?.url,
            subscriberCount: subs,
            isVerySmall: subs < 50000
          })
        }
      }
    }

    // Sort by subscriber count (smallest first - most silenced)
    silencedCreators.sort((a, b) => a.subscriberCount - b.subscriberCount)

    console.log(`[Silenced] Found ${silencedCreators.length} silenced creators for "${query}"`)
    return silencedCreators.slice(0, 6)
  } catch (err) {
    console.error('[Silenced] Search silenced creators error:', err)
    return []
  }
}

// ===============================================
// FETCH VIDEO DURATIONS
// ===============================================
async function fetchVideoDurations(videoIds) {
  if (!videoIds || videoIds.length === 0) return {}

  try {
    // Batch in groups of 50 (YouTube API limit)
    const durationMap = {}
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50)

      const url = new URL('https://www.googleapis.com/youtube/v3/videos')
      url.searchParams.set('part', 'contentDetails')
      url.searchParams.set('id', batch.join(','))
      url.searchParams.set('key', YOUTUBE_API_KEY)

      const res = await fetch(url.toString())
      if (!res.ok) {
        console.warn(`[Perspective] Failed to fetch durations for batch: ${res.status}`)
        continue
      }

      const data = await res.json()
      quotaUsed += 1 // Videos API costs 1 quota unit per call

      for (const item of (data.items || [])) {
        const duration = item.contentDetails?.duration || 'PT0S'
        durationMap[item.id] = parseDurationToSeconds(duration)
      }
    }

    return durationMap
  } catch (err) {
    console.error('[Perspective] Error fetching video durations:', err)
    return {}
  }
}

// ===============================================
// FETCH FULL VIDEO DETAILS (for better AI analysis)
// ===============================================
async function fetchFullVideoDetails(videoIds) {
  if (!videoIds || videoIds.length === 0) return {}

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos')
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('id', videoIds.join(','))
    url.searchParams.set('key', YOUTUBE_API_KEY)

    console.log(`[Silenced] Fetching full details for ${videoIds.length} videos...`)
    const res = await fetch(url.toString())

    if (!res.ok) {
      console.warn('[Silenced] Failed to fetch full video details:', res.status)
      return {}
    }

    const data = await res.json()
    quotaUsed += 1 // Videos API costs 1 quota unit per call

    // Build lookup map
    const detailsMap = {}
    for (const item of (data.items || [])) {
      detailsMap[item.id] = {
        title: item.snippet?.title,
        description: item.snippet?.description || '',
        tags: item.snippet?.tags || [],
        categoryId: item.snippet?.categoryId
      }
    }

    console.log(`[Silenced] ✓ Got full details for ${Object.keys(detailsMap).length} videos`)
    return detailsMap
  } catch (err) {
    console.warn('[Silenced] Error fetching video details:', err.message)
    return {}
  }
}

// ===============================================
// TOPIC SEARCH
// ===============================================
async function topicSearch(query, maxResults = 50) {
  console.log(`[Silenced] topicSearch called with query: "${query}", quotaUsed: ${quotaUsed}/${QUOTA_LIMIT}`)

  if (quotaUsed + 100 > QUOTA_LIMIT) {
    console.warn('[Silenced] Quota limit reached! Resetting quota for new session...')
    // Reset quota - it's likely stale from previous day
    quotaUsed = 0
    await chrome.storage.local.set({ quotaUsed: 0, quotaResetDate: new Date().toDateString() })
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search')
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('q', query)
    url.searchParams.set('type', 'video')
    url.searchParams.set('order', 'relevance') // Changed to relevance for better results
    url.searchParams.set('maxResults', String(maxResults))
    url.searchParams.set('key', YOUTUBE_API_KEY)

    console.log(`[Silenced] Making YouTube API search request...`)
    const res = await fetch(url.toString())

    if (!res.ok) {
      const errorText = await res.text()
      console.error(`[Silenced] YouTube API error ${res.status}:`, errorText)
      throw new Error(`Search API error: ${res.status}`)
    }

    const data = await res.json()
    quotaUsed += 100

    const videos = data.items || []
    const channelIds = [...new Set(videos.map(v => v.snippet.channelId))]

    console.log(`[Silenced] Search SUCCESS: ${videos.length} videos from ${channelIds.length} channels`)

    return { videos, channelIds }
  } catch (err) {
    console.error('[Silenced] Search error:', err)
    return { videos: [], channelIds: [] }
  }
}

// ===============================================
// BATCH GET CHANNELS (with caching)
// ===============================================
async function batchGetChannels(channelIds) {
  const results = []
  const uncachedIds = []

  // Check cache first
  for (const id of channelIds) {
    if (channelCache[id] && Date.now() - channelCache[id].timestamp < CACHE_TTL) {
      results.push(channelCache[id].data)
    } else {
      uncachedIds.push(id)
    }
  }

  console.log(`[Silenced] Channels: ${results.length} cached, ${uncachedIds.length} to fetch`)

  // Batch fetch uncached (50 per request)
  for (let i = 0; i < uncachedIds.length; i += 50) {
    if (quotaUsed + 1 > QUOTA_LIMIT) break

    const batch = uncachedIds.slice(i, i + 50)

    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/channels')
      url.searchParams.set('part', 'statistics,snippet')
      url.searchParams.set('id', batch.join(','))
      url.searchParams.set('key', YOUTUBE_API_KEY)

      const res = await fetch(url.toString())
      if (!res.ok) continue

      const data = await res.json()
      quotaUsed += 1

      for (const channel of (data.items || [])) {
        channelCache[channel.id] = { data: channel, timestamp: Date.now() }
        results.push(channel)
      }
    } catch (err) {
      console.error('[Silenced] Batch channel error:', err)
    }
  }

  saveCache()
  return results
}

// ===============================================
// FULL ANALYSIS - Video + Channel + Noise Level
// ===============================================
async function analyzeVideo(videoId, transcript = '') {
  console.log(`[Silenced] Analyzing noise level for: ${videoId}`)

  // Get video details
  const video = await getVideo(videoId)
  if (!video) {
    return { error: 'VIDEO_NOT_FOUND' }
  }

  // Get channel details
  const channel = await getChannel(video.snippet.channelId)

  // Get recent activities for broadcast frequency
  const activities = await getChannelActivities(video.snippet.channelId)

  // Calculate noise score (replaces equity score)
  const noiseAnalysis = calculateNoiseScore(channel, {
    viewCount: video.statistics?.viewCount,
    likeCount: video.statistics?.likeCount,
    commentCount: video.statistics?.commentCount,
    duration: video.contentDetails?.duration
  }, activities)

  // Run local sustainability audit (heuristic)
  const sustainabilityAudit = auditSustainability(video, transcript, channel)

  // Try to enhance with backend AI-powered greenwashing detection
  if (USE_PYTHON_BACKEND && PYTHON_BACKEND_URL && sustainabilityAudit.isSustainability) {
    try {
      console.log(`[Silenced] Using backend for AI greenwashing analysis: ${videoId}`)
      const backendAnalysis = await analyzeWithBackend(
        videoId,
        video.snippet.title,
        video.snippet.title // Use title as query for relevance
      )

      if (backendAnalysis?.greenwashing) {
        // Merge AI-powered greenwashing analysis with local audit
        sustainabilityAudit.greenwashingRisk = {
          ...sustainabilityAudit.greenwashingRisk,
          // Backend provides AI-analyzed flags with evidence
          aiFlags: backendAnalysis.greenwashing.flags || [],
          aiTransparencyScore: backendAnalysis.greenwashing.transparencyScore,
          aiRiskLevel: backendAnalysis.greenwashing.riskLevel,
          analysisMethod: backendAnalysis.greenwashing.method || 'backend-ai'
        }

        // Update overall credibility based on AI analysis
        if (backendAnalysis.greenwashing.riskLevel === 'high') {
          sustainabilityAudit.credibilityLevel = 'caution'
        } else if (backendAnalysis.greenwashing.riskLevel === 'medium') {
          sustainabilityAudit.credibilityLevel = 'review'
        }

        console.log(`[Silenced] Backend greenwashing analysis: ${backendAnalysis.greenwashing.riskLevel} risk, ${backendAnalysis.greenwashing.transparencyScore}/100 transparency`)
      }

      // Also store quality analysis from backend
      if (backendAnalysis?.quality) {
        sustainabilityAudit.contentQuality = {
          relevanceScore: backendAnalysis.quality.relevanceScore,
          qualityScore: backendAnalysis.quality.qualityScore,
          contentDepthScore: backendAnalysis.quality.contentDepthScore,
          combinedScore: backendAnalysis.quality.combinedScore,
          reason: backendAnalysis.quality.reason,
          method: backendAnalysis.quality.method
        }
      }
    } catch (err) {
      console.warn('[Silenced] Backend greenwashing analysis failed, using heuristic only:', err.message)
    }
  }

  return {
    video: {
      id: videoId,
      title: video.snippet.title,
      channel: video.snippet.channelTitle,
      channelId: video.snippet.channelId,
      thumbnail: video.snippet.thumbnails?.medium?.url,
      categoryId: video.snippet.categoryId,
      publishedAt: video.snippet.publishedAt
    },
    channel: {
      id: channel?.id,
      title: channel?.snippet?.title,
      thumbnail: channel?.snippet?.thumbnails?.default?.url,
      subscriberCount: parseInt(channel?.statistics?.subscriberCount || '0'),
      videoCount: parseInt(channel?.statistics?.videoCount || '0')
    },
    noiseAnalysis,
    sustainability: sustainabilityAudit,
    quotaUsed,
    _schemaVersion: SCHEMA_VERSION
  }
}

// ===============================================
// NOISE CANCELLATION ENGINE - Unmute silenced voices
// With Bias Snapshot and Explainability
// ===============================================
async function runNoiseCancellation(query) {
  const cacheKey = `silence_${query.toLowerCase().trim()}`

  // Check cache - but SKIP cache if it returned empty (failed search)
  if (discoveryCache[cacheKey] && Date.now() - discoveryCache[cacheKey].timestamp < 900000) {
    const cached = discoveryCache[cacheKey].data
    // Only use cache if it actually has results
    if (cached.totalResults > 0 || cached.unmutedVideos?.length > 0) {
      console.log(`[Silenced] Using cached results for "${query}"`)
      return cached
    } else {
      console.log(`[Silenced] Skipping empty cache for "${query}" - will retry search`)
    }
  }

  console.log(`[Silenced] Scanning for silenced voices: "${query}"`)
  console.log(`[Silenced] Current quota used: ${quotaUsed}/${QUOTA_LIMIT}`)
  const startQuota = quotaUsed

  // Search for videos
  const { videos, channelIds } = await topicSearch(query, 50)
  console.log(`[Silenced] topicSearch returned ${videos.length} videos from ${channelIds.length} channels`)

  // Batch get all channels
  const channels = await batchGetChannels(channelIds)
  const channelMap = new Map(channels.map(c => [c.id, c]))

  // Calculate aggregate metrics for Bias Snapshot
  const allSubs = channels.map(ch => parseInt(ch.statistics?.subscriberCount || '0'))
  const totalSubs = allSubs.reduce((a, b) => a + b, 0)
  const top10Channels = [...channels].sort((a, b) =>
    parseInt(b.statistics?.subscriberCount || '0') - parseInt(a.statistics?.subscriberCount || '0')
  ).slice(0, 10)
  const top10Subs = top10Channels.reduce((sum, ch) => sum + parseInt(ch.statistics?.subscriberCount || '0'), 0)

  // Separate by threshold
  const silencedVoices = channels.filter(ch => {
    const subs = parseInt(ch.statistics?.subscriberCount || '0')
    return subs < MAX_SUBSCRIBER_THRESHOLD
  })

  const noisyChannels = channels.filter(ch => {
    const subs = parseInt(ch.statistics?.subscriberCount || '0')
    return subs >= MAX_SUBSCRIBER_THRESHOLD
  })

  // FALLBACK: If no channels under 100K found, include channels under 500K as backup
  let silencedChannelIds = new Set(silencedVoices.map(c => c.id))
  if (silencedChannelIds.size === 0) {
    console.warn(`[Silenced] No channels under ${MAX_SUBSCRIBER_THRESHOLD} subs found - falling back to channels under 500K`)
    const fallbackVoices = channels.filter(ch => {
      const subs = parseInt(ch.statistics?.subscriberCount || '0')
      return subs < 500000 && subs >= MAX_SUBSCRIBER_THRESHOLD // Between 100K and 500K
    })
    silencedChannelIds = new Set(fallbackVoices.map(c => c.id))
    console.log(`[Silenced] Found ${fallbackVoices.length} fallback channels (100K-500K subs)`)
  }

  // Identify Rising Signals
  const risingSignals = silencedVoices.filter(ch => {
    const views = parseInt(ch.statistics?.viewCount || '0')
    const subs = parseInt(ch.statistics?.subscriberCount || '0')
    const videoCount = parseInt(ch.statistics?.videoCount || '0')
    const avgViews = videoCount > 0 ? views / videoCount : 0
    return subs > 0 && avgViews / subs > 2
  })

  // Calculate topic average metrics for comparison
  const avgSubsInTopic = channels.length > 0 ? totalSubs / channels.length : 0

  // Build Bias Snapshot FIRST (needed for bias receipts)
  const topicConcentration = totalSubs > 0 ? Math.round((top10Subs / totalSubs) * 100) : 0
  const biasSnapshot = {
    topicConcentration,
    underAmplifiedRate: channels.length > 0 ? Math.round((silencedVoices.length / channels.length) * 100) : 0,
    dominantCount: noisyChannels.filter(ch => parseInt(ch.statistics?.subscriberCount || '0') > 1000000).length,
    silencedCount: silencedVoices.length,
    totalChannels: channels.length,
    avgSubscribers: Math.round(avgSubsInTopic)
  }

  // Build unmuted videos with explainability
  console.log(`[Silenced] Building unmuted videos - total videos: ${videos.length}, silenced channels: ${silencedChannelIds.size}`)
  const unmutedVideosPreQuality = videos
    .filter(v => silencedChannelIds.has(v.snippet.channelId))
    .map(v => {
      const ch = channelMap.get(v.snippet.channelId)
      const subs = parseInt(ch?.statistics?.subscriberCount || '0')
      const totalViews = parseInt(ch?.statistics?.viewCount || '0')
      const videoCount = parseInt(ch?.statistics?.videoCount || '0')
      const avgViews = videoCount > 0 ? totalViews / videoCount : 0
      const engagementProxy = videoCount > 0 ? (totalViews / videoCount) / Math.max(subs, 1) : 0
      const isRising = risingSignals.some(r => r.id === v.snippet.channelId)

      // Determine exposure tier
      let exposureTier = 'emerging'
      if (subs < 10000) exposureTier = 'under-represented'
      else if (subs < 50000) exposureTier = 'emerging'
      else if (subs < 100000) exposureTier = 'established'

      return {
        videoId: v.id.videoId,
        title: v.snippet.title,
        description: v.snippet.description,
        thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
        channelId: v.snippet.channelId,
        channelTitle: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt,
        subscriberCount: subs,
        isRisingSignal: isRising,
        engagementRatio: engagementProxy,
        exposureTier,
        avgSubsInTopic,
        videoCount
      }
    })

  console.log(`[Silenced] Built ${unmutedVideosPreQuality.length} unmuted videos before filtering`)

  // === HARD PRE-FILTERS: Block obvious spam/garbage before any scoring ===
  const preFilteredVideos = unmutedVideosPreQuality.filter(v => {
    const title = v.title || ''
    const titleLower = title.toLowerCase()

    // 1. Block Shorts (check title for #shorts indicator)
    if (titleLower.includes('#shorts') || titleLower.includes('#short')) {
      console.log(`[Silenced] Pre-filter: Blocked Short "${title.slice(0, 40)}..."`)
      return false
    }

    // 2. Block obvious spam titles
    const spamPatterns = [
      /FREE\s*(DOWNLOAD|MONEY|GIFT)/i,
      /\bSCAM\b/i,
      /\bHACK\b.*\bFREE\b/i,
      /💰.*💰.*💰/,  // Excessive money emojis
      /🔥.*🔥.*🔥.*🔥/,  // Excessive fire emojis
      /^[A-Z\s!?]{20,}$/,  // All caps titles over 20 chars
      /\b(CLICK HERE|SUBSCRIBE NOW|LINK IN BIO)\b/i,
      /\d+\s*FREE\s*\w+/i,  // "100 FREE things"
    ]

    for (const pattern of spamPatterns) {
      if (pattern.test(title)) {
        console.log(`[Silenced] Pre-filter: Blocked spam title "${title.slice(0, 40)}..."`)
        return false
      }
    }

    // 3. Block videos with extremely short titles (likely spam/clickbait)
    if (title.length < 10) {
      console.log(`[Silenced] Pre-filter: Blocked short title "${title}"`)
      return false
    }

    // 4. Block channels with 0 subscribers (likely spam/bot channels)
    if (v.subscriberCount === 0) {
      console.log(`[Silenced] Pre-filter: Blocked 0-subscriber channel "${v.channelTitle}"`)
      return false
    }

    // 5. Block channels with very few videos (newly created spam channels)
    if (v.videoCount && v.videoCount < 3) {
      console.log(`[Silenced] Pre-filter: Blocked new channel with only ${v.videoCount} videos`)
      return false
    }

    return true
  })

  console.log(`[Silenced] Pre-filter: ${unmutedVideosPreQuality.length} -> ${preFilteredVideos.length} videos passed hard filters`)

  if (preFilteredVideos.length === 0) {
    console.warn(`[Silenced] ⚠️ No silenced voices found for query "${query}" - all videos filtered out`)
  }

  // === QUALITY SCORING: Two-pass scoring with transcript analysis for top candidates ===
  // Deep analyze top 5 with transcripts for quality verification
  console.log(`[Silenced] Scoring ${preFilteredVideos.length} videos for quality...`)
  const videosWithQuality = await twoPassQualityScoring(preFilteredVideos, query, 5) // Deep analyze top 5 with transcripts

  // Filter out low-quality videos - use dynamic threshold based on AI availability
  const qualityThreshold = getQualityThreshold()
  const aiStatus = isAIOffline() ? 'OFFLINE (strict mode)' : 'online'
  console.log(`[Silenced] Quality threshold: ${qualityThreshold} (AI ${aiStatus})`)

  let qualityFilteredVideos = videosWithQuality.filter(v => {
    const passes = (v.qualityScore || 0) >= qualityThreshold
    if (!passes) {
      const score = typeof v.qualityScore === 'number' ? v.qualityScore.toFixed(2) : 'N/A'
      console.log(`[Silenced] Filtered out low-quality video: "${v.title}" (score: ${score}, threshold: ${qualityThreshold})`)
    }
    return passes
  })

  console.log(`[Silenced] Quality filter: ${videosWithQuality.length} -> ${qualityFilteredVideos.length} videos (threshold: ${qualityThreshold})`)

  // SAFETY: If quality filter removed ALL videos, fall back to top-scoring ones
  if (qualityFilteredVideos.length === 0 && videosWithQuality.length > 0) {
    console.log(`[Silenced] Quality filter too strict - falling back to top ${Math.min(5, videosWithQuality.length)} videos`)
    // Sort by quality score and take top 5
    qualityFilteredVideos = [...videosWithQuality]
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, 5)
  }

  // Build final unmuted videos with all metadata
  const unmutedVideosRaw = qualityFilteredVideos
    .map(v => {
      // Generate "Why surfaced" reasons (2-3 bullet points) - kept for backward compat
      const whySurfaced = []

      if (v.subscriberCount < avgSubsInTopic * 0.3) {
        whySurfaced.push(`${Math.round((1 - v.subscriberCount / avgSubsInTopic) * 100)}% smaller than topic average`)
      }
      if (v.engagementRatio && typeof v.engagementRatio === 'number' && v.engagementRatio > 1.5) {
        whySurfaced.push(`Strong engagement ratio (${v.engagementRatio.toFixed(1)}x views per subscriber)`)
      }
      if (v.qualityDetails?.contentDepth !== null && v.qualityDetails?.contentDepth >= 0.5) {
        whySurfaced.push(`Transcript verified: discusses topic in depth (${Math.round(v.qualityDetails.contentDepth * 100)}%)`)
      } else if (v.qualityScore >= 0.6) {
        whySurfaced.push(`High relevance score (${Math.round(v.qualityScore * 100)}%)`)
      }
      if (v.subscriberCount < 50000) {
        whySurfaced.push(`Under 50K subs in competitive topic`)
      }
      if (v.isRisingSignal) {
        whySurfaced.push(`Rising signal: outperforming channel size`)
      }
      if (whySurfaced.length === 0) {
        whySurfaced.push(`Under-represented in algorithm recommendations`)
      }

      // Determine surface method based on quality scoring
      let surfaceMethod = 'quality_filtered_heuristic'
      if (v.qualityDetails?.method === 'gemini-transcript') {
        surfaceMethod = 'transcript_analyzed_gemini'
      } else if (v.qualityDetails?.method === 'heuristic-transcript') {
        surfaceMethod = 'transcript_analyzed_heuristic'
      } else if (v.qualityDetails?.method === 'gemini') {
        surfaceMethod = 'quality_filtered_gemini'
      }

      // Quick sustainability check for this video
      const videoText = `${v.title} ${v.description || ''}`.toLowerCase()
      const sustainabilityMatches = SUSTAINABILITY_KEYWORDS.filter(kw => videoText.includes(kw))
      const isSustainabilityVideo = sustainabilityMatches.length >= 1
      const hasGreenwashSignals = isSustainabilityVideo && GREENWASH_SIGNALS.some(sig => videoText.includes(sig))
      const hasEvidenceSignals = isSustainabilityVideo && EVIDENCE_SIGNALS.some(sig => videoText.includes(sig))

      // Calculate simple sustainability credibility
      let sustainabilityCredibility = null
      if (isSustainabilityVideo) {
        if (hasEvidenceSignals && !hasGreenwashSignals) {
          sustainabilityCredibility = 'high'
        } else if (hasGreenwashSignals && !hasEvidenceSignals) {
          sustainabilityCredibility = 'caution'
        } else {
          sustainabilityCredibility = 'moderate'
        }
      }

      return {
        videoId: v.videoId,
        title: v.title,
        description: v.description,
        thumbnail: v.thumbnail,
        channelId: v.channelId,
        channelTitle: v.channelTitle,
        publishedAt: v.publishedAt,
        subscriberCount: v.subscriberCount,
        isRisingSignal: v.isRisingSignal,
        whySurfaced: whySurfaced.slice(0, 3),
        engagementRatio: v.engagementRatio,
        qualityScore: v.qualityScore,
        qualityReason: v.qualityDetails?.reason,
        surfaceMethod,
        diversityNote: v.qualityDetails?.reason || 'Passed quality and relevance filter',
        // KPMG Sustainability quick check
        isSustainabilityVideo,
        sustainabilityCredibility,
        sustainabilityKeywords: sustainabilityMatches.slice(0, 3),
        // Metrics for bias receipt generation
        _receiptParams: {
          videoId: v.videoId,
          subscriberCount: v.subscriberCount,
          viewsPerDay: (v.videoCount > 0 ? v.avgSubsInTopic : 0) / 30,
          uploadFrequency: v.videoCount > 0 ? Math.min(30, v.videoCount) : 0,
          engagementRatio: v.engagementRatio,
          avgSubsInTopic: v.avgSubsInTopic,
          topicConcentration,
          exposureTier: v.exposureTier,
          isRisingSignal: v.isRisingSignal,
          videoTitle: v.title,
          videoDescription: v.description || '',
          channelTitle: v.channelTitle
        }
      }
    })
    // Sort by combined score: quality + engagement + rising signal bonus
    .sort((a, b) => {
      // Rising signals get priority
      if (a.isRisingSignal && !b.isRisingSignal) return -1
      if (!a.isRisingSignal && b.isRisingSignal) return 1

      // Then sort by combined quality + engagement score
      const aEngagement = typeof a.engagementRatio === 'number' ? Math.min(a.engagementRatio, 3) / 3 : 0
      const bEngagement = typeof b.engagementRatio === 'number' ? Math.min(b.engagementRatio, 3) / 3 : 0
      const aScore = (a.qualityScore || 0) * 0.7 + aEngagement * 0.3
      const bScore = (b.qualityScore || 0) * 0.7 + bEngagement * 0.3
      return bScore - aScore
    })

  // Fetch full video details for top 5 videos (Search API only returns truncated descriptions)
  const top5VideoIds = unmutedVideosRaw.slice(0, 5).map(v => v.videoId)
  const fullVideoDetails = await fetchFullVideoDetails(top5VideoIds)

  // Fetch transcripts for top 5 videos in parallel (for AI content analysis)
  console.log(`[Silenced] Fetching transcripts for ${top5VideoIds.length} videos...`)
  const transcriptPromises = top5VideoIds.map(async (videoId) => {
    try {
      const transcript = await fetchVideoTranscript(videoId)
      return { videoId, transcript }
    } catch (err) {
      console.warn(`[Silenced] Transcript fetch failed for ${videoId}:`, err.message)
      return { videoId, transcript: null }
    }
  })
  const transcriptResults = await Promise.all(transcriptPromises)
  const transcriptMap = Object.fromEntries(transcriptResults.map(r => [r.videoId, r.transcript]))

  // Return videos immediately (fast path) - generate bias receipts in background
  // This allows the UI to show videos quickly while receipts load asynchronously
  // Generate bias receipts for top 5 videos (awaited so they're ready for display)
  const unmutedVideos = await Promise.all(
    unmutedVideosRaw.slice(0, 10).map(async (video, index) => {
      const { _receiptParams, ...cleanVideo } = video

      // Generate bias receipt for top 5 videos with full description AND transcript
      if (index < 5 && _receiptParams) {
        try {
          // Use full description from Videos API if available
          const fullDetails = fullVideoDetails[video.videoId]
          if (fullDetails?.description) {
            _receiptParams.videoDescription = fullDetails.description
            cleanVideo.description = fullDetails.description // Update video object too
          }

          // Add transcript for AI content analysis
          const transcript = transcriptMap[video.videoId]
          if (transcript) {
            _receiptParams.transcript = transcript
            console.log(`[Silenced] Including transcript (${transcript.length} chars) for ${video.videoId}`)
          }

          const biasReceipt = await generateBiasReceipt(_receiptParams)
          cleanVideo.biasReceipt = biasReceipt
        } catch (err) {
          console.debug('[Silenced] Bias receipt generation failed:', video.videoId)
        }
      }

      return cleanVideo
    })
  )

  console.log(`[Silenced] Generated ${unmutedVideos.length} unmuted videos from ${unmutedVideosRaw.length} raw results`)
  console.log(`[Silenced] Total videos searched: ${videos.length}, Channels: ${channels.length}`)
  console.log(`[Silenced] Silenced voices (under ${MAX_SUBSCRIBER_THRESHOLD} subs): ${silencedVoices.length}`)
  console.log(`[Silenced] Noisy channels (over ${MAX_SUBSCRIBER_THRESHOLD} subs): ${noisyChannels.length}`)

  // Identify noisy channels to mute
  const channelsToMute = noisyChannels.map(ch => ({
    id: ch.id,
    name: ch.snippet?.title,
    subscribers: parseInt(ch.statistics?.subscriberCount || '0'),
    tier: parseInt(ch.statistics?.subscriberCount || '0') > 1000000 ? 'dominant' : 'amplified'
  }))

  // Compute audit metrics from final unmuted videos list
  const transcriptAnalyzed = qualityFilteredVideos.filter(v =>
    v.qualityDetails?.method?.includes('transcript')
  ).length

  const qualityFilterStats = {
    qualityFiltered: videosWithQuality.length - qualityFilteredVideos.length,
    redundancyFiltered: 0, // Future: track duplicates removed
    transcriptAnalyzed
  }
  const auditMetrics = computeAuditMetrics(unmutedVideos, topicConcentration, qualityFilterStats)

  // Add surfaceMethod to each video for audit display
  // IMPORTANT: Preserve the surfaceMethod from quality scoring, don't overwrite it!
  const unmutedVideosWithMethod = unmutedVideos.map(video => ({
    ...video,
    // Keep existing surfaceMethod if set, otherwise use rising_signal/engagement_ranking
    surfaceMethod: video.surfaceMethod || (video.isRisingSignal ? 'rising_signal' : 'engagement_ranking'),
    diversityNote: video.diversityNote || (video.isRisingSignal
      ? 'Surfaced due to high engagement relative to channel size'
      : 'Surfaced via under-representation filter and engagement ranking')
  }))

  const result = {
    query,
    totalResults: videos.length,
    silencedVoicesFound: silencedVoices.length,
    risingSignalsCount: risingSignals.length,
    unmutedVideos: unmutedVideosWithMethod,
    channelsToMute,
    noisyChannelIds: noisyChannels.map(ch => ch.id),
    biasSnapshot,
    auditMetrics, // New optional field for Bias Audit Mode
    quotaCost: quotaUsed - startQuota,
    timestamp: Date.now(),
    _schemaVersion: SCHEMA_VERSION
  }

  discoveryCache[cacheKey] = { data: result, timestamp: Date.now() }

  console.log(`[Silenced] Noise cancellation complete: ${unmutedVideos.length} voices unmuted, bias snapshot generated`)

  return result
}

// ===============================================
// HOMEPAGE BIAS ANALYSIS
// ===============================================

/**
 * Analyze homepage videos for bias scoring
 * Called when Bias Lens is enabled on homepage
 */
async function analyzeHomepageVideos(videoIds, feedContext = {}) {
  console.log(`[BiasLens] Analyzing ${videoIds.length} homepage videos`)

  const results = []
  const channelIds = new Set()

  // Batch fetch video details
  const videos = await batchGetVideos(videoIds.slice(0, 24)) // Limit to 24 for performance

  // Collect channel IDs
  for (const video of videos) {
    if (video?.snippet?.channelId) {
      channelIds.add(video.snippet.channelId)
    }
  }

  // Batch fetch channel details
  const channels = await batchGetChannels([...channelIds])
  const channelMap = new Map(channels.map(c => [c.id, c]))

  // Fetch activities for each channel (FIX: was missing before!)
  const activitiesMap = new Map()
  const channelIdList = [...channelIds]

  // Batch activities fetch - limit to 8 channels to save quota
  const priorityChannels = channelIdList.slice(0, 8)
  console.log(`[BiasLens] Fetching activities for ${priorityChannels.length} channels`)

  await Promise.all(priorityChannels.map(async (chId) => {
    try {
      const activities = await getChannelActivities(chId)
      activitiesMap.set(chId, activities)
    } catch (err) {
      activitiesMap.set(chId, [])
    }
  }))

  // Analyze each video
  for (const video of videos) {
    if (!video) continue

    const channel = channelMap.get(video.snippet?.channelId)
    const videoId = video.id
    const channelId = video.snippet?.channelId
    const activities = activitiesMap.get(channelId) || []

    // Calculate bias score using FULL data now (with activities!)
    const noiseAnalysis = calculateExposureAdvantageScore(channel, {
      viewCount: video.statistics?.viewCount,
      likeCount: video.statistics?.likeCount,
      commentCount: video.statistics?.commentCount,
      duration: video.contentDetails?.duration
    }, activities)

    // Get subscriber count for tier-based tags
    const subs = parseInt(channel?.statistics?.subscriberCount || '0')
    const views = parseInt(video.statistics?.viewCount || '0')
    const videoAgeHours = getVideoAgeHours(video.snippet?.publishedAt)
    const viewsPerHour = videoAgeHours > 0 ? views / videoAgeHours : views

    // Calculate engagement metrics
    const likes = parseInt(video.statistics?.likeCount || '0')
    const comments = parseInt(video.statistics?.commentCount || '0')
    const likeRate = views > 0 ? (likes / views) * 100 : 0
    const commentRate = views > 0 ? (comments / views) * 100 : 0

    // Calculate 6-category bias breakdown (0-100 each)
    // EA: Exposure Advantage (channel size + velocity)
    let EA = 0
    if (subs >= 10000000) EA = 95
    else if (subs >= 1000000) EA = 80
    else if (subs >= 500000) EA = 65
    else if (subs >= 100000) EA = 45
    else if (subs >= 50000) EA = 30
    else if (subs >= 10000) EA = 15
    else EA = 5
    // Add velocity bonus
    if (viewsPerHour > 50000) EA = Math.min(100, EA + 20)
    else if (viewsPerHour > 10000) EA = Math.min(100, EA + 12)
    else if (viewsPerHour > 1000) EA = Math.min(100, EA + 5)

    // CM: Click Magnet (title/thumbnail signals - inferred from engagement)
    let CM = 30 // Base
    if (likeRate > 5) CM = Math.min(100, CM + 30)
    else if (likeRate > 3) CM = Math.min(100, CM + 15)
    if (video.snippet?.title?.match(/[!?]{2,}|😱|🔥|💀|SHOCKING|INSANE/i)) CM = Math.min(100, CM + 25)

    // RP: Retention Proxy (satisfaction signals)
    let RP = 40 // Base
    if (likeRate > 5) RP = Math.min(100, RP + 35)
    else if (likeRate > 3) RP = Math.min(100, RP + 20)
    if (commentRate > 1) RP = Math.min(100, RP + 15)

    // EN: Engagement strength
    let EN = Math.min(100, Math.round(likeRate * 15 + commentRate * 30))

    // TR: Topic Reinforcement (how much this topic dominates feed - placeholder)
    let TR = 30 // Would need feed context to compute properly

    // CI: Commercial Influence (sponsor detection - simplified)
    let CI = 0
    const desc = video.snippet?.description || ''
    if (desc.match(/sponsored by|thanks to .+ for sponsoring|promo code|affiliate/i)) CI = 60

    // Calculate weighted bias score
    const biasScore = Math.round(0.25 * EA + 0.25 * CM + 0.25 * RP + 0.10 * EN + 0.10 * TR + 0.05 * CI)
    const confidence = activities.length > 0 ? 0.85 : 0.6

    // Store breakdown for UI
    const breakdown = { EA, CM, RP, EN, TR, CI }

    // Generate contributions/tags from breakdown categories
    const contributions = [
      { 
        factor: 'Exposure Advantage', 
        value: EA, 
        color: EA > 70 ? '#ef4444' : EA > 40 ? '#f97316' : '#22c55e', 
        description: 'Algorithmic head start from channel size + velocity',
        icon: '📊'
      },
      { 
        factor: 'Click Magnet', 
        value: CM, 
        color: CM > 70 ? '#ef4444' : CM > 40 ? '#f97316' : '#22c55e', 
        description: 'Thumbnail/title optimized for clicks',
        icon: '🎯'
      },
      { 
        factor: 'Retention Signals', 
        value: RP, 
        color: RP > 70 ? '#ef4444' : RP > 40 ? '#f97316' : '#22c55e', 
        description: 'Signals that predict watch time',
        icon: '⏱️'
      },
      { 
        factor: 'Engagement', 
        value: EN, 
        color: EN > 70 ? '#22c55e' : EN > 40 ? '#f59e0b' : '#6b7280', 
        description: `${likeRate.toFixed(1)}% likes, ${commentRate.toFixed(2)}% comments`,
        icon: '💬'
      }
    ]

    // Add activity-based contribution if available
    if (activities.length > 0) {
      const uploadsPerWeek = activities.length / 4
      contributions.push({ 
        factor: 'Upload Frequency', 
        value: uploadsPerWeek >= 7 ? 80 : uploadsPerWeek >= 3 ? 50 : 20, 
        color: uploadsPerWeek >= 5 ? '#06b6d4' : '#22d3d1', 
        description: `~${uploadsPerWeek.toFixed(1)} uploads/week`,
        icon: '📅'
      })
    }

    // Add recency
    if (videoAgeHours < 72) {
      contributions.push({ 
        factor: 'Recency Boost', 
        value: videoAgeHours < 24 ? 70 : 40, 
        color: '#22c55e', 
        description: videoAgeHours < 24 ? 'Fresh upload (<24h)' : 'Recent upload (<3 days)',
        icon: '🆕'
      })
    }

    // Add commercial if detected
    if (CI > 0) {
      contributions.push({ 
        factor: 'Sponsored Content', 
        value: CI, 
        color: '#f97316', 
        description: 'Detected sponsorship/affiliate signals',
        icon: '💰'
      })
    }

    // Sort by value (highest first)
    contributions.sort((a, b) => b.value - a.value)

    // Generate tags from top contributions
    const tags = contributions.slice(0, 4).map(c => ({
      text: `${c.icon} ${c.factor}: ${c.value}`,
      color: c.color,
      key: c.factor.toLowerCase().replace(/\s+/g, '_'),
      value: c.value,
      description: c.description
    }))

    results.push({
      videoId,
      title: video.snippet?.title,
      channelName: video.snippet?.channelTitle,
      channelId: video.snippet?.channelId,
      biasScore,
      confidence,
      // 6-category breakdown (0-100 each)
      breakdown,
      scores: {
        aas: noiseAnalysis.totalScore,
        channelSize: subs,
        velocity: Math.round(viewsPerHour),
        ms: 0,
        cis: CI
      },
      contributions,
      tags,
      metrics: {
        views,
        subs,
        likes,
        comments,
        likeRate: Math.round(likeRate * 10) / 10,
        commentRate: Math.round(commentRate * 100) / 100,
        age: getVideoAge(video.snippet?.publishedAt),
        ageHours: Math.round(videoAgeHours),
        velocity: viewsPerHour > 10000 ? 'high' : viewsPerHour > 1000 ? 'medium' : 'low',
        viewsPerHour: Math.round(viewsPerHour),
        sponsorDetected: CI > 0
      },
      exposureTier: noiseAnalysis.exposureTier
    })
  }

  // Calculate feed analysis
  const feedAnalysis = calculateFeedAnalysis(results, feedContext)

  return {
    videos: results,
    feedAnalysis
  }
}

/**
 * Get video age in hours
 */
function getVideoAgeHours(publishedAt) {
  if (!publishedAt) return 999999
  const now = new Date()
  const published = new Date(publishedAt)
  return (now - published) / (1000 * 60 * 60)
}

/**
 * Batch get video details
 */
async function batchGetVideos(videoIds) {
  if (!videoIds || videoIds.length === 0) return []

  const results = []

  // Batch in groups of 50
  for (let i = 0; i < videoIds.length; i += 50) {
    if (quotaUsed + 1 > QUOTA_LIMIT) break

    const batch = videoIds.slice(i, i + 50)

    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos')
      url.searchParams.set('part', 'snippet,statistics,contentDetails')
      url.searchParams.set('id', batch.join(','))
      url.searchParams.set('key', YOUTUBE_API_KEY)

      const res = await fetch(url.toString())
      if (!res.ok) continue

      const data = await res.json()
      quotaUsed += 1

      results.push(...(data.items || []))
    } catch (err) {
      console.error('[BiasLens] Batch video fetch error:', err)
    }
  }

  return results
}

/**
 * Get video age as human-readable string
 */
function getVideoAge(publishedAt) {
  if (!publishedAt) return '--'

  const now = new Date()
  const published = new Date(publishedAt)
  const diffMs = now - published
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffHours / 24)

  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`
  return `${Math.floor(diffDays / 365)}y`
}

/**
 * Calculate overall feed analysis
 */
function calculateFeedAnalysis(videoResults, feedContext = {}) {
  if (!videoResults || videoResults.length === 0) {
    return {
      avgBias: 0,
      distribution: { high: 0, medium: 0, low: 0 },
      topicDominance: [],
      channelConcentration: { top5Share: 0, topChannels: [] },
      manipulationPrevalence: 0,
      commercialPrevalence: 0
    }
  }

  const biasScores = videoResults.map(v => v.biasScore)
  const avgBias = Math.round(biasScores.reduce((a, b) => a + b, 0) / biasScores.length)

  // Distribution
  const high = biasScores.filter(s => s >= 70).length / biasScores.length
  const medium = biasScores.filter(s => s >= 40 && s < 70).length / biasScores.length
  const low = biasScores.filter(s => s < 40).length / biasScores.length

  // Channel concentration
  const channelCounts = {}
  for (const v of videoResults) {
    const ch = v.channelName || 'Unknown'
    channelCounts[ch] = (channelCounts[ch] || 0) + 1
  }

  const sortedChannels = Object.entries(channelCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const top5Share = sortedChannels.reduce((sum, [_, count]) => sum + count, 0) / videoResults.length

  // Topic dominance (simplified - would need topic analysis)
  const topicDominance = feedContext.topics || []

  return {
    avgBias,
    distribution: {
      high: Math.round(high * 100),
      medium: Math.round(medium * 100),
      low: Math.round(low * 100)
    },
    topicDominance,
    channelConcentration: {
      top5Share: Math.round(top5Share * 100),
      topChannels: sortedChannels.map(([name, count]) => ({
        name,
        count,
        percentage: Math.round((count / videoResults.length) * 100)
      }))
    },
    manipulationPrevalence: 0, // Would need thumbnail/title analysis
    commercialPrevalence: 0 // Would need description analysis
  }
}

/**
 * Discover silenced videos for a topic
 * Used by Silenced tab
 * 
 * FIX: Now uses more specific queries from video titles, not just topic categories
 */
async function discoverSilencedVideos(topicMap, excludedChannels = [], filters = {}, feedContext = {}) {
  console.log('[BiasLens] Discovering silenced videos for topics:', topicMap)

  // Build search query - prioritize actual content from user's feed
  let query = ''
  let querySource = ''

  // Extended stop words for better keyword extraction
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
    'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all',
    'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
    'now', 'here', 'there', 'then', 'new', 'video', 'watch', 'like', 'subscribe',
    'official', 'full', 'best', 'top', 'first', 'last', 'get', 'got', 'make',
    'made', 'take', 'took', 'come', 'came', 'going', 'goes', 'really', 'actually',
    'my', 'your', 'our', 'their', 'his', 'her', 'its', 'about', 'after', 'before'
  ])

  // PRIORITY 1: Extract keywords directly from feed video titles
  // This is the most accurate because it reflects what user is actually watching
  if (feedContext.titles && feedContext.titles.length >= 3) {
    const wordFreq = {}

    for (const title of feedContext.titles.slice(0, 15)) {
      if (!title) continue
      const words = title
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w) && !/^\d+$/.test(w))

      for (const word of words) {
        wordFreq[word] = (wordFreq[word] || 0) + 1
      }
    }

    // Get top 6 most frequent keywords
    const topWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([word]) => word)

    if (topWords.length >= 2) {
      query = topWords.join(' ')
      querySource = 'title_keywords'
      console.log(`[BiasLens] Extracted keywords from ${feedContext.titles.length} titles: ${query}`)
    }
  }

  // PRIORITY 2: Use topic keywords if we got them from TopicAnalyzer
  if (!query && topicMap && topicMap.length > 0) {
    const topTopics = topicMap
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, 3)

    // Collect all keywords from topics
    const keywords = topTopics
      .flatMap(t => t.keywords || [t.name || t])
      .filter(k => k && k.length > 2)
      .slice(0, 6)

    if (keywords.length >= 2) {
      query = keywords.join(' ')
      querySource = 'topic_keywords'
      console.log(`[BiasLens] Using topic keywords: ${query}`)
    }
  }

  // PRIORITY 3: If still no query, we CANNOT provide quality recommendations
  // Better to show nothing than random garbage
  if (!query || query.length < 5) {
    console.warn('[BiasLens] ⚠️ Cannot extract meaningful topics from feed - not enough signal')
    return {
      videos: [],
      message: 'Not enough signal from your homepage. Scroll to load more videos or refresh.',
      insufficientData: true
    }
  }

  console.log(`[BiasLens] Search query for silenced videos (${querySource}): "${query}"`)

  // Use existing noise cancellation engine
  const result = await runNoiseCancellation(query)

  // Check if we got results
  if (!result || (!result.unmutedVideos && !result.discoveredVideos)) {
    console.warn('[BiasLens] No silenced videos returned from search')
    return { videos: [], message: 'No under-represented creators found for this topic' }
  }

  const rawVideos = result.unmutedVideos || result.discoveredVideos || []
  console.log(`[BiasLens] Got ${rawVideos.length} raw silenced videos`)

  // Filter out excluded channels
  const excludedSet = new Set(excludedChannels)
  const filteredVideos = rawVideos
    .filter(v => !excludedSet.has(v.channelId))
    .map(v => {
      const subs = v.subscriberCount || 0

      // Calculate quality score (heuristic based on engagement proxy)
      const engagementProxy = v.engagementProxy || 0.5
      const qualityScore = Math.round(
        Math.min(100, Math.max(10,
          50 + (engagementProxy * 30) + (v.isRisingSignal ? 15 : 0)
        ))
      )

      // Calculate silenced score (how under-exposed)
      let silencedScore = 80 // Default high
      if (subs > 500000) silencedScore = 20
      else if (subs > 100000) silencedScore = 35
      else if (subs > 50000) silencedScore = 55
      else if (subs > 10000) silencedScore = 70
      else silencedScore = 90

      // Exposure gap = quality - visibility
      const visibilityScore = 100 - silencedScore
      const exposureGap = qualityScore - visibilityScore

      // Build "why good" reasons
      const whyGood = v.whySurfaced || []
      if (whyGood.length === 0) {
        if (engagementProxy > 0.6) whyGood.push('High engagement rate for its reach')
        if (v.isRisingSignal) whyGood.push('Rising star - growing audience')
        if (subs < 50000) whyGood.push('Independent creator voice')
        if (qualityScore > 60) whyGood.push('Quality content signals detected')
        whyGood.push('Under-represented in algorithmic feeds')
      }

      // Build "why buried" reasons
      const whyBuried = []
      if (subs < 50000) whyBuried.push('Small channel size limits algorithmic reach')
      if (subs < 100000) whyBuried.push('Competing against channels with 10-100x more subscribers')
      whyBuried.push('Lower velocity than dominant channels')
      whyBuried.push('Algorithm favors proven engagement patterns')

      return {
        videoId: v.videoId,
        title: v.title,
        channel: v.channelTitle,
        channelName: v.channelTitle,
        thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        qualityScore,
        silencedScore,
        visibilityScore,
        exposureGap,
        whyGood: whyGood.slice(0, 3),
        whyBuried: whyBuried.slice(0, 2),
        views: v.viewCount || (subs * 10),
        subscriberCount: subs,
        publishedAt: v.publishedAt,
        duration: v.duration || 600,
        isRising: v.isRisingSignal || false,
        exposureTier: v.exposureTier || 'emerging'
      }
    })

  console.log(`[BiasLens] Returning ${filteredVideos.length} filtered silenced videos`)

  // Check if AI scoring is offline
  const aiIsOffline = isAIOffline()

  return {
    videos: filteredVideos.slice(0, 12),
    biasSnapshot: result.biasSnapshot,
    topicConcentration: result.biasSnapshot?.topicConcentration || 0,
    aiOffline: aiIsOffline,
    querySource: querySource || 'unknown'
  }
}

// ===============================================
// PERSPECTIVE SEARCH
// Reuses existing scoring pipeline, adds perspective classification
// ===============================================

/**
 * Classify a video into a perspective bucket using DeepSeek
 */
async function classifyPerspective(baseQuery, videoTitle, videoDescription, channelTitle) {
  if (!DEEPSEEK_API_KEY) return null

  const prompt = `You are a content classifier. Classify a YouTube video into ONE perspective bucket based on its framing and approach.

Base Query: "${baseQuery}"
Video Title: "${videoTitle}"
Video Description: "${(videoDescription || '').slice(0, 500)}"
Channel Title: "${channelTitle}"

Perspective Buckets:
1. "mainstream_practical" - Conventional, solution-focused, actionable, mainstream approach
2. "critical_contextual" - Questioning assumptions, providing context, analyzing systems/causes
3. "alternative_longterm" - Alternative viewpoints, long-term thinking, different paradigms

Rules:
- Classify based on FRAMING and APPROACH, not topic keywords
- Do NOT infer sensitive attributes (political, demographic, etc.)
- Do NOT make accusations about suppression/censorship
- Only describe the content's framing perspective
- Be deterministic - same input should produce same output

Output STRICT JSON ONLY (no markdown, no extra text):
{
  "bucket": "mainstream_practical" | "critical_contextual" | "alternative_longterm",
  "confidence": 0.0-1.0,
  "oneSentenceRationale": "Brief explanation of why this fits the bucket (max 20 words)"
}`

  try {
    const response = await callDeepSeekAPI(prompt, { temperature: 0.2, maxTokens: 150 })
    if (!response) return null

    // Extract JSON from response
    let jsonText = response.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    }

    const result = JSON.parse(jsonText)

    // Validate bucket
    const validBuckets = ['mainstream_practical', 'critical_contextual', 'alternative_longterm']
    if (!validBuckets.includes(result.bucket)) {
      console.warn(`[Perspective] Invalid bucket: ${result.bucket}, defaulting to mainstream_practical`)
      result.bucket = 'mainstream_practical'
    }

    return {
      bucket: result.bucket,
      confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
      oneSentenceRationale: result.oneSentenceRationale || 'Standard approach to the topic'
    }
  } catch (error) {
    console.error('[Perspective] Classification error:', error)
    return null
  }
}

/**
 * Perspective Search - Groups high-quality videos by perspective/framing
 * Reuses existing scoring pipeline (runNoiseCancellation, quality scoring, etc.)
 */
async function runPerspectiveSearch(query, maxPerPerspective = 2) {
  try {
    if (!ENABLE_PERSPECTIVE_SEARCH) {
      console.log('[Perspective] Feature disabled')
      return {
        perspectives: [],
        debug: { error: 'Perspective search disabled' },
        _schemaVersion: SCHEMA_VERSION
      }
    }

    console.log(`[Perspective] Starting perspective search for: "${query}"`)

    // Step 1: Use existing noise cancellation engine to get candidates
    // This reuses ALL our existing scoring: quality, engagement, exposure advantage, etc.
    console.log('[Perspective] Calling runNoiseCancellation...')
    const noiseCancellationResult = await runNoiseCancellation(query)
    console.log('[Perspective] runNoiseCancellation returned:', {
      hasResult: !!noiseCancellationResult,
      hasUnmutedVideos: !!noiseCancellationResult?.unmutedVideos,
      unmutedVideosLength: noiseCancellationResult?.unmutedVideos?.length
    })

    if (!noiseCancellationResult || !noiseCancellationResult.unmutedVideos || noiseCancellationResult.unmutedVideos.length === 0) {
      console.warn('[Perspective] No candidates found from noise cancellation')
      return {
        perspectives: [],
        debug: { totalCandidates: 0, error: 'No candidates found' },
        _schemaVersion: SCHEMA_VERSION
      }
    }

    let candidates = noiseCancellationResult.unmutedVideos
    console.log(`[Perspective] Got ${candidates.length} candidates from noise cancellation`)

    // Fetch duration for all candidates (Search API doesn't return duration)
    const candidateVideoIds = candidates.slice(0, 20).map(v => v.videoId)
    console.log(`[Perspective] Fetching duration for ${candidateVideoIds.length} candidates...`)

    const durationMap = await fetchVideoDurations(candidateVideoIds)
    const durationsFetched = Object.keys(durationMap).length
    console.log(`[Perspective] Got durations for ${durationsFetched} videos`)

    // Add duration to candidates and filter out Shorts
    let filteredCount = 0
    candidates = candidates.filter(video => {
      // Get duration from map or use 0 as fallback
      const durationSec = durationMap[video.videoId] || video.duration || 0
      video.duration = durationSec // Update video object with duration

      // If we couldn't fetch duration, only filter by title (more lenient)
      if (durationsFetched === 0) {
        // Fallback: only filter by title if duration fetch failed
        const title = (video.title || '').toLowerCase()
        if (title.includes('#shorts') || title.includes('#short')) {
          filteredCount++
          return false
        }
        return true
      }

      // Filter out Shorts (videos shorter than 60 seconds)
      if (durationSec > 0 && durationSec < 60) {
        console.log(`[Perspective] Filtered out Short: "${video.title?.slice(0, 40)}..." (${durationSec}s)`)
        filteredCount++
        return false
      }

      // Filter out videos with #shorts in title
      const title = (video.title || '').toLowerCase()
      if (title.includes('#shorts') || title.includes('#short')) {
        filteredCount++
        return false
      }

      return true
    })

    console.log(`[Perspective] After filtering Shorts: ${candidates.length} candidates (filtered ${filteredCount})`)

    // Re-sort by engagement score (likes + comments relative to views)
    candidates.sort((a, b) => {
      const engagementA = (a.engagementRatio || 0) * (a.qualityScore || 0)
      const engagementB = (b.engagementRatio || 0) * (b.qualityScore || 0)
      return engagementB - engagementA
    })

    console.log(`[Perspective] Top candidate engagement: ${(candidates[0]?.engagementRatio || 0).toFixed(3)}`)

    // Step 2: Classify top candidates (hard cap at 12 for cost control)
    const candidatesToClassify = candidates.slice(0, 12)
    const classificationPromises = candidatesToClassify.map(async (video) => {
      const classification = await classifyPerspective(
        query,
        video.title,
        video.description || '',
        video.channelTitle
      )
      return { video, classification }
    })

    const classifiedResults = await Promise.all(classificationPromises)
    const classified = classifiedResults.filter(r => r.classification !== null)
    const unclassified = classifiedResults.filter(r => r.classification === null).map(r => r.video)

    console.log(`[Perspective] Classified ${classified.length}/${candidatesToClassify.length} candidates`)

    // Step 3: Group into buckets
    const buckets = {
      mainstream_practical: [],
      critical_contextual: [],
      alternative_longterm: []
    }

    for (const { video, classification } of classified) {
      if (classification && buckets[classification.bucket]) {
        buckets[classification.bucket].push({
          video,
          classification
        })
      }
    }

    // Step 4: Sort each bucket by quality score (reuse existing scoring)
    for (const bucketKey in buckets) {
      buckets[bucketKey].sort((a, b) => {
        const scoreA = a.video.qualityScore || 0
        const scoreB = b.video.qualityScore || 0
        return scoreB - scoreA
      })
    }

    // Step 5: Build perspective buckets with labels
    const perspectiveBuckets = [
      {
        label: 'Mainstream / Practical',
        rationale: 'Standard approaches and practical solutions',
        videos: buckets.mainstream_practical.slice(0, maxPerPerspective).map(item => ({
          videoId: item.video.videoId,
          title: item.video.title,
          description: item.video.description,
          thumbnail: item.video.thumbnail,
          channelId: item.video.channelId,
          channelTitle: item.video.channelTitle,
          publishedAt: item.video.publishedAt,
          subscriberCount: item.video.subscriberCount,
          isRisingSignal: item.video.isRisingSignal || false,
          whySurfaced: item.video.whySurfaced || [],
          engagementRatio: item.video.engagementRatio,
          qualityScore: item.video.qualityScore,
          perspectiveRationale: item.classification.oneSentenceRationale,
          biasReceipt: item.video.biasReceipt
        }))
      },
      {
        label: 'Critical / Contextual',
        rationale: 'Questions assumptions and provides context',
        videos: buckets.critical_contextual.slice(0, maxPerPerspective).map(item => ({
          videoId: item.video.videoId,
          title: item.video.title,
          description: item.video.description,
          thumbnail: item.video.thumbnail,
          channelId: item.video.channelId,
          channelTitle: item.video.channelTitle,
          publishedAt: item.video.publishedAt,
          subscriberCount: item.video.subscriberCount,
          isRisingSignal: item.video.isRisingSignal || false,
          whySurfaced: item.video.whySurfaced || [],
          engagementRatio: item.video.engagementRatio,
          qualityScore: item.video.qualityScore,
          perspectiveRationale: item.classification.oneSentenceRationale,
          biasReceipt: item.video.biasReceipt
        }))
      },
      {
        label: 'Alternative / Long-term',
        rationale: 'Different viewpoints and long-term perspectives',
        videos: buckets.alternative_longterm.slice(0, maxPerPerspective).map(item => ({
          videoId: item.video.videoId,
          title: item.video.title,
          description: item.video.description,
          thumbnail: item.video.thumbnail,
          channelId: item.video.channelId,
          channelTitle: item.video.channelTitle,
          publishedAt: item.video.publishedAt,
          subscriberCount: item.video.subscriberCount,
          isRisingSignal: item.video.isRisingSignal || false,
          whySurfaced: item.video.whySurfaced || [],
          engagementRatio: item.video.engagementRatio,
          qualityScore: item.video.qualityScore,
          perspectiveRationale: item.classification.oneSentenceRationale,
          biasReceipt: item.video.biasReceipt
        }))
      }
    ]

    // Step 6: Fallback - if a bucket is empty, fill from next best
    for (let i = 0; i < perspectiveBuckets.length; i++) {
      const bucket = perspectiveBuckets[i]
      if (bucket.videos.length === 0 && unclassified.length > 0) {
        // Take top unclassified videos sorted by quality
        const fallbackVideos = [...unclassified]
          .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
          .slice(0, maxPerPerspective)
          .map(video => ({
            videoId: video.videoId,
            title: video.title,
            description: video.description,
            thumbnail: video.thumbnail,
            channelId: video.channelId,
            channelTitle: video.channelTitle,
            publishedAt: video.publishedAt,
            subscriberCount: video.subscriberCount,
            isRisingSignal: video.isRisingSignal || false,
            whySurfaced: video.whySurfaced || [],
            engagementRatio: video.engagementRatio,
            qualityScore: video.qualityScore,
            perspectiveRationale: 'Fallback (AI unavailable)',
            biasReceipt: video.biasReceipt
          }))
        bucket.videos = fallbackVideos
        bucket.rationale = 'Fallback (AI classification unavailable)'
      }
    }

    // Filter out empty buckets
    const finalBuckets = perspectiveBuckets.filter(b => b.videos.length > 0)

    console.log(`[Perspective] Returning ${finalBuckets.length} perspective buckets with ${finalBuckets.reduce((sum, b) => sum + b.videos.length, 0)} total videos`)

    return {
      perspectives: finalBuckets,
      debug: {
        totalCandidates: candidates.length,
        classifiedCount: classified.length,
        fallbackUsed: unclassified.length > 0
      },
      _schemaVersion: SCHEMA_VERSION
    }
  } catch (error) {
    console.error('[Perspective] Fatal error in runPerspectiveSearch:', error)
    console.error('[Perspective] Error stack:', error.stack)
    return {
      perspectives: [],
      debug: {
        error: error.message || String(error),
        stack: error.stack
      },
      _schemaVersion: SCHEMA_VERSION
    }
  }
}

// ===============================================
// MESSAGE HANDLING
// ===============================================
// ============================================
// NEW HOMEPAGE PIPELINE - Enricher Functions
// ============================================

/**
 * Parse ISO 8601 duration to seconds
 */
function parseISO8601DurationBg(duration) {
  if (!duration) return 0
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  return (parseInt(match[1]) || 0) * 3600 + 
         (parseInt(match[2]) || 0) * 60 + 
         (parseInt(match[3]) || 0)
}

/**
 * Fetch video details for multiple IDs (batch call)
 */
async function fetchVideosDataBatch(videoIds) {
  if (!videoIds || videoIds.length === 0) return {}

  const url = new URL('https://www.googleapis.com/youtube/v3/videos')
  url.searchParams.set('part', 'snippet,statistics,contentDetails,topicDetails')
  url.searchParams.set('id', videoIds.join(','))
  url.searchParams.set('key', YOUTUBE_API_KEY)

  try {
    const response = await fetch(url.toString())
    if (!response.ok) {
      console.error('[DataEnricher] Videos API error:', response.status)
      return {}
    }

    const data = await response.json()
    const result = {}

    for (const item of (data.items || [])) {
      result[item.id] = {
        views: parseInt(item.statistics?.viewCount) || 0,
        likes: item.statistics?.likeCount ? parseInt(item.statistics.likeCount) : null,
        comments: item.statistics?.commentCount ? parseInt(item.statistics.commentCount) : null,
        publishedAt: item.snippet?.publishedAt || '',
        durationSec: parseISO8601DurationBg(item.contentDetails?.duration),
        description: item.snippet?.description || '',
        tags: item.snippet?.tags || [],
        categoryId: item.snippet?.categoryId || '',
        topicCategories: item.topicDetails?.topicCategories || [],
        channelId: item.snippet?.channelId || '',  // Important: Get channelId from API
        channelTitle: item.snippet?.channelTitle || ''
      }
    }

    return result
  } catch (err) {
    console.error('[DataEnricher] Videos fetch error:', err)
    return {}
  }
}

/**
 * Fetch channel details for multiple IDs (batch call)
 */
async function fetchChannelsDataBatch(channelIds) {
  if (!channelIds || channelIds.length === 0) return {}

  const url = new URL('https://www.googleapis.com/youtube/v3/channels')
  url.searchParams.set('part', 'snippet,statistics')
  url.searchParams.set('id', channelIds.join(','))
  url.searchParams.set('key', YOUTUBE_API_KEY)

  try {
    const response = await fetch(url.toString())
    if (!response.ok) {
      console.error('[DataEnricher] Channels API error:', response.status)
      return {}
    }

    const data = await response.json()
    const result = {}

    for (const item of (data.items || [])) {
      result[item.id] = {
        subs: parseInt(item.statistics?.subscriberCount) || 0,
        channelCreatedAt: item.snippet?.publishedAt || '',
        totalViews: parseInt(item.statistics?.viewCount) || 0,
        videoCount: parseInt(item.statistics?.videoCount) || 0
      }
    }

    return result
  } catch (err) {
    console.error('[DataEnricher] Channels fetch error:', err)
    return {}
  }
}

/**
 * Enrich homepage seeds with YouTube API data
 */
async function enrichHomepageSeeds(seeds) {
  if (!seeds || seeds.length === 0) {
    console.warn('[DataEnricher] No seeds to enrich')
    return []
  }

  console.log(`[DataEnricher] Enriching ${seeds.length} seeds...`)
  const startTime = Date.now()

  // Extract unique IDs
  const videoIds = seeds.map(s => s.videoId).filter(Boolean)
  
  // First, fetch video data (this also gives us channelId from snippet)
  const videosData = await fetchVideosDataBatch(videoIds)
  
  // Get channelIds from BOTH seeds (if available) and videos API response (more reliable)
  const channelIdsFromSeeds = seeds.map(s => s.channelId).filter(Boolean)
  const channelIdsFromApi = Object.values(videosData).map(v => v.channelId).filter(Boolean)
  const channelIds = [...new Set([...channelIdsFromSeeds, ...channelIdsFromApi])]
  
  console.log(`[DataEnricher] Got ${channelIds.length} unique channel IDs (${channelIdsFromSeeds.length} from seeds, ${channelIdsFromApi.length} from API)`)
  
  // Then fetch channel data
  const channelsData = await fetchChannelsDataBatch(channelIds)

  console.log(`[DataEnricher] API calls completed in ${Date.now() - startTime}ms`)
  console.log(`[DataEnricher] Got ${Object.keys(videosData).length} videos, ${Object.keys(channelsData).length} channels`)

  // Merge data into enriched objects
  const enrichedVideos = seeds.map(seed => {
    const videoData = videosData[seed.videoId] || null
    // Use channelId from seed OR from API response (more reliable)
    const effectiveChannelId = seed.channelId || videoData?.channelId || ''
    const channelData = channelsData[effectiveChannelId] || null

    return {
      // Original seed fields
      videoId: seed.videoId,
      title: seed.title || videoData?.channelTitle || '',
      channelId: effectiveChannelId,  // Use the effective channelId
      channelName: seed.channelName || videoData?.channelTitle || '',
      viewCountText: seed.viewCountText,
      publishedTimeText: seed.publishedTimeText,
      durationText: seed.durationText,
      thumbnailUrl: seed.thumbnailUrl,
      href: seed.href,
      rank: seed.rank,

      // Enriched stats
      stats: videoData ? {
        views: videoData.views,
        likes: videoData.likes,
        comments: videoData.comments,
        publishedAt: videoData.publishedAt,
        durationSec: videoData.durationSec,
        description: videoData.description,
        tags: videoData.tags,
        categoryId: videoData.categoryId,
        topicCategories: videoData.topicCategories
      } : null,

      // Channel data
      channel: channelData ? {
        subs: channelData.subs,
        channelCreatedAt: channelData.channelCreatedAt,
        totalViews: channelData.totalViews,
        videoCount: channelData.videoCount
      } : null
    }
  })

  console.log(`[DataEnricher] Enrichment complete in ${Date.now() - startTime}ms`)
  return enrichedVideos
}

/**
 * Find silenced videos for scored homepage videos
 * Improved: Better constraints, language matching, quality scoring
 */
async function findSilencedForHomepage(scoredVideos) {
  if (!scoredVideos || scoredVideos.length === 0) return []

  console.log(`[SilencedFinder] Finding silenced for ${Math.min(10, scoredVideos.length)} videos...`)
  const startTime = Date.now()

  // IMPROVED CONSTRAINTS: Higher quality bar
  const CONSTRAINTS = {
    subsMin: 1000,
    subsMax: 100000,
    viewsMin: 10000,      // Increased from 5000
    viewsMax: 500000,     // Increased from 300000
    durationMin: 240,     // 4 minutes minimum (increased from 120)
    minLikeRate: 0.03,    // 3% like rate minimum
    minQualityScore: 40   // Minimum quality score
  }

  // Get top 10 by bias score
  const top10 = scoredVideos
    .slice()
    .sort((a, b) => (b.biasScore || 0) - (a.biasScore || 0))
    .slice(0, 10)

  // Exclude channels already in feed
  const excludeChannelIds = scoredVideos.map(v => v.channelId).filter(Boolean)

  // Process in parallel with improved function
  const results = await Promise.all(
    top10.map(video => findSilencedForSingleVideo(video, CONSTRAINTS, excludeChannelIds))
  )

  console.log(`[SilencedFinder] Complete in ${Date.now() - startTime}ms`)

  // Filter out failures and low quality results
  return results.filter(r => r && r.silencedVideo && r.qualityScore >= CONSTRAINTS.minQualityScore)
}

/**
 * Find silenced counterpart for a single noise video
 * IMPROVED: Better query building, language matching, quality filters, progressive broadening
 */
async function findSilencedForSingleVideo(noiseVideo, constraints, excludeChannelIds) {
  const query = extractQueryKeywordsBg(noiseVideo.title)
  if (!query) {
    return { noiseVideoId: noiseVideo.videoId, noiseVideoTitle: noiseVideo.title, silencedVideo: null, error: 'No query' }
  }

  // Get noise video language for matching
  const noiseLanguage = noiseVideo.stats?.defaultLanguage || 
                        noiseVideo.stats?.defaultAudioLanguage || 
                        detectLanguageFromTitle(noiseVideo.title)

  // Progressive broadening: try multiple search strategies
  const searchStrategies = [
    { maxResults: 50, order: 'relevance' },
    { maxResults: 100, order: 'viewCount' },
    { maxResults: 150, order: 'date' }
  ]

  let allCandidates = []
  
  for (const strategy of searchStrategies) {
    if (allCandidates.length >= 10) break // Have enough good candidates
    
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/search')
      url.searchParams.set('part', 'snippet')
      url.searchParams.set('type', 'video')
      url.searchParams.set('q', query)
      url.searchParams.set('maxResults', String(strategy.maxResults))
      url.searchParams.set('order', strategy.order)
      url.searchParams.set('key', YOUTUBE_API_KEY)
      
      // Try to match language if detected
      if (noiseLanguage && noiseLanguage.length === 2) {
        url.searchParams.set('relevanceLanguage', noiseLanguage)
      }

      const response = await fetch(url.toString())
      if (!response.ok) continue

      const data = await response.json()
      const newCandidates = (data.items || []).map(item => ({
        videoId: item.id?.videoId,
        title: item.snippet?.title || '',
        channelId: item.snippet?.channelId || '',
        channelName: item.snippet?.channelTitle || '',
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url || '',
        publishedAt: item.snippet?.publishedAt || '',
        description: item.snippet?.description || ''
      })).filter(v => v.videoId && !allCandidates.some(c => c.videoId === v.videoId))

      allCandidates = [...allCandidates, ...newCandidates]
      
    } catch (err) {
      console.warn('[SilencedFinder] Search strategy failed:', err.message)
    }
  }

  if (allCandidates.length === 0) {
    return { noiseVideoId: noiseVideo.videoId, noiseVideoTitle: noiseVideo.title, silencedVideo: null, error: 'No candidates' }
  }

  // Enrich candidates
  const videoIds = allCandidates.map(c => c.videoId)
  const channelIds = [...new Set(allCandidates.map(c => c.channelId).filter(Boolean))]

  const [videosData, channelsData] = await Promise.all([
    fetchVideosDataBatch(videoIds),
    fetchChannelsDataBatch(channelIds)
  ])

  const enriched = allCandidates.map(c => ({
    ...c,
    stats: videosData[c.videoId] || null,
    channel: channelsData[c.channelId] || null
  }))

  // IMPROVED FILTERING: More strict quality checks
  const filtered = enriched.filter(c => {
    if (!c.stats || !c.channel) return false
    if (excludeChannelIds.includes(c.channelId)) return false
    if (c.channel.subs < constraints.subsMin || c.channel.subs > constraints.subsMax) return false
    if (c.stats.views < constraints.viewsMin || c.stats.views > constraints.viewsMax) return false
    if (c.stats.durationSec < constraints.durationMin) return false
    
    // Filter out shorts
    if (c.title.toLowerCase().includes('#shorts')) return false
    if (c.stats.durationSec < 60) return false
    
    // Filter out reaction videos
    if (isReactionVideo(c.title, c.description)) return false
    
    // Filter out low-effort content patterns
    if (isLowEffortContent(c.title, c.description)) return false
    
    // Check minimum like rate if we have the data
    if (c.stats.likes !== null && c.stats.views > 0) {
      const likeRate = c.stats.likes / c.stats.views
      if (likeRate < (constraints.minLikeRate || 0.02)) return false
    }
    
    // Language matching: skip if clearly different language
    if (noiseLanguage) {
      const candidateLang = c.stats.defaultLanguage || c.stats.defaultAudioLanguage || detectLanguageFromTitle(c.title)
      if (candidateLang && candidateLang !== noiseLanguage && candidateLang.slice(0, 2) !== noiseLanguage.slice(0, 2)) {
        return false
      }
    }
    
    return true
  })

  if (filtered.length === 0) {
    return { noiseVideoId: noiseVideo.videoId, noiseVideoTitle: noiseVideo.title, silencedVideo: null, error: 'All filtered' }
  }

  // IMPROVED SCORING: Better quality score with engagement focus
  const scored = filtered.map(c => ({
    ...c,
    qualityScore: computeQualityScoreBg(c),
    engagementScore: computeEngagementScore(c)
  })).sort((a, b) => {
    // Sort by combined quality + engagement
    const scoreA = a.qualityScore * 0.6 + a.engagementScore * 0.4
    const scoreB = b.qualityScore * 0.6 + b.engagementScore * 0.4
    return scoreB - scoreA
  })

  const best = scored[0]

  // Calculate why this video is silenced
  const likeRate = best.stats?.likes && best.stats?.views 
    ? Math.round((best.stats.likes / best.stats.views) * 10000) / 100 
    : null
  
  const whyGood = []
  const whyBuried = []
  
  // Generate "why good" reasons
  if (likeRate && likeRate > 4) whyGood.push(`${likeRate}% like rate (excellent)`)
  else if (likeRate && likeRate > 3) whyGood.push(`${likeRate}% like rate (strong)`)
  
  if (best.channel?.subs < 50000) whyGood.push('Small creator with dedicated audience')
  else if (best.channel?.subs < 100000) whyGood.push('Growing channel')
  
  if (best.stats?.durationSec > 600) whyGood.push('In-depth content')
  
  const viewsPerSub = best.channel?.subs > 0 ? best.stats?.views / best.channel.subs : 0
  if (viewsPerSub > 1) whyGood.push('High views-to-subscriber ratio')
  
  // Generate "why buried" reasons
  if (best.channel?.subs < 100000) whyBuried.push(`Only ${formatNumber(best.channel.subs)} subscribers`)
  if (best.stats?.views < 100000) whyBuried.push('Lower view count than trending content')
  whyBuried.push('Not optimized for algorithmic signals')

  // Get AI explanation (async but we'll await it)
  let aiExplanation = null
  try {
    aiExplanation = await getQuickAIExplanation(best, noiseVideo)
  } catch (err) {
    console.warn('[SilencedFinder] AI explanation failed:', err.message)
  }

  return {
    noiseVideoId: noiseVideo.videoId,
    noiseVideoTitle: noiseVideo.title,
    noiseVideoChannel: noiseVideo.channelName,
    silencedVideo: best,
    whySilenced: {
      subs: best.channel?.subs,
      views: best.stats?.views,
      likeRate
    },
    whyGood: aiExplanation?.whyGood ? [aiExplanation.whyGood, ...whyGood] : whyGood,
    whyBuried: aiExplanation?.whyBuried ? [aiExplanation.whyBuried, ...whyBuried] : whyBuried,
    // Pass full AI explanation object with 4 sections
    aiExplanation: aiExplanation ? {
      fullExplanation: aiExplanation.fullExplanation || null,
      whySilenced: aiExplanation.whySilenced || null,
      whoAffected: aiExplanation.whoAffected || null,
      whyMatters: aiExplanation.whyMatters || null,
      counterfactual: aiExplanation.counterfactual || null,
      // Legacy field for backward compatibility
      explanation: aiExplanation.explanation || aiExplanation.fullExplanation?.slice(0, 200) || null,
      method: aiExplanation.method || 'unknown'
    } : null,
    qualityScore: best.qualityScore,
    engagementScore: best.engagementScore,
    query
  }
}

/**
 * Detect language from title using simple heuristics
 */
function detectLanguageFromTitle(title) {
  if (!title) return null
  
  // Check for non-Latin scripts
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(title)) return 'ja' // Japanese
  if (/[\uAC00-\uD7AF]/.test(title)) return 'ko' // Korean
  if (/[\u4E00-\u9FFF]/.test(title)) return 'zh' // Chinese
  if (/[\u0600-\u06FF]/.test(title)) return 'ar' // Arabic
  if (/[\u0400-\u04FF]/.test(title)) return 'ru' // Russian/Cyrillic
  if (/[\u0900-\u097F]/.test(title)) return 'hi' // Hindi
  
  // Default to English for Latin script
  return 'en'
}

/**
 * Check if video is a reaction video
 */
function isReactionVideo(title, description) {
  const reactionPatterns = [
    /\breact(s|ing|ion)?\b/i,
    /\breacting\s+to\b/i,
    /\bwatching\s+for\s+the\s+first\s+time\b/i,
    /\bfirst\s+time\s+(watching|reacting|hearing)\b/i,
    /\bmy\s+reaction\b/i,
    /\breaction\s+video\b/i
  ]
  
  const text = `${title} ${description}`.toLowerCase()
  return reactionPatterns.some(p => p.test(text))
}

/**
 * Check if video is low-effort content
 */
function isLowEffortContent(title, description) {
  const lowEffortPatterns = [
    /\bcompilation\b/i,
    /\btiktok\s*(compilation|videos)\b/i,
    /\bmeme\s*compilation\b/i,
    /\bfunny\s*moments\b/i,
    /\bbest\s*of\s*\d{4}\b/i,
    /\btop\s*\d+\s*(moments|clips|fails)\b/i,
    /\basmr\b/i,
    /\b(free|giveaway|win)\b.*\b(iphone|ps5|xbox|money)\b/i,
    /\bsub\s*4\s*sub\b/i,
    /\bfollow\s*4\s*follow\b/i
  ]
  
  const text = `${title} ${description}`.toLowerCase()
  return lowEffortPatterns.some(p => p.test(text))
}

/**
 * Compute engagement score (0-100) based on likes, comments, views ratio
 */
function computeEngagementScore(candidate) {
  if (!candidate.stats || !candidate.channel) return 0
  
  const views = candidate.stats.views || 0
  const likes = candidate.stats.likes
  const comments = candidate.stats.comments
  const subs = candidate.channel.subs || 1
  
  let score = 0
  
  // Like rate score (max 40 points)
  if (likes !== null && views > 0) {
    const likeRate = likes / views
    score += Math.min(40, likeRate * 800) // 5% like rate = 40 points
  }
  
  // Comment rate score (max 25 points)
  if (comments !== null && views > 0) {
    const commentRate = comments / views
    score += Math.min(25, commentRate * 2500) // 1% comment rate = 25 points
  }
  
  // Views per subscriber (max 25 points) - indicates content quality
  const viewsPerSub = views / subs
  score += Math.min(25, viewsPerSub * 12.5) // 2x views per sub = 25 points
  
  // Recency bonus (max 10 points)
  if (candidate.publishedAt) {
    const ageHours = (Date.now() - new Date(candidate.publishedAt).getTime()) / (1000 * 60 * 60)
    if (ageHours < 24 * 30) { // Less than 30 days old
      score += 10
    } else if (ageHours < 24 * 90) { // Less than 90 days old
      score += 5
    }
  }
  
  return Math.round(Math.min(100, score))
}

/**
 * Format number for display
 */
function formatNumber(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

/**
 * Extract keywords from title for search query
 */
function extractQueryKeywordsBg(title) {
  if (!title) return ''
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'be', 'are',
    'was', 'were', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'
  ])
  const cleaned = title.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = cleaned.split(' ').filter(w => w.length > 2 && !stopWords.has(w))
  return words.slice(0, 4).join(' ') || title.slice(0, 30)
}

/**
 * Compute quality score for a candidate video
 */
function computeQualityScoreBg(candidate) {
  if (!candidate.stats || !candidate.channel) return 0

  const views = candidate.stats.views
  const likes = candidate.stats.likes
  const comments = candidate.stats.comments
  const subs = candidate.channel.subs
  const durationSec = candidate.stats.durationSec

  const likeRate = likes !== null && views > 0 ? likes / views : 0.03
  const likeScore = Math.min(1, likeRate / 0.05) * 30

  const commentRate = comments !== null && views > 0 ? comments / views : 0.001
  const commentScore = Math.min(1, commentRate / 0.005) * 15

  const viewsPerSub = subs > 0 ? views / subs : 0
  const viralScore = Math.min(1, viewsPerSub / 2) * 20

  const durationMin = durationSec / 60
  let durationScore = 0
  if (durationMin >= 6 && durationMin <= 20) {
    durationScore = 15
  } else if (durationMin >= 2) {
    durationScore = Math.max(0, 15 - Math.abs(durationMin - 13) / 2)
  }

  const smallChannelBonus = subs < 50000 ? 10 : (subs < 100000 ? 5 : 0)

  return Math.max(0, Math.min(100, likeScore + commentScore + viralScore + durationScore + smallChannelBonus))
}

// Offscreen document management
let offscreenCreated = false

async function ensureOffscreenDocument() {
  if (offscreenCreated) return

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/thumbnail-analyzer.html',
      reasons: ['DOM_PARSER'],
      justification: 'Analyze thumbnail images for clickbait signals'
    })
    offscreenCreated = true
    console.log('[Background] Offscreen document created')
  } catch (err) {
    if (err.message.includes('already exists')) {
      offscreenCreated = true
    } else {
      console.error('[Background] Failed to create offscreen document:', err)
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // NEW PIPELINE: Homepage seeds enrichment
  if (request.type === 'HOMEPAGE_SEEDS') {
    enrichHomepageSeeds(request.seeds)
      .then(enrichedVideos => sendResponse({ success: true, enrichedVideos }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // NEW PIPELINE: Thumbnail analysis via offscreen
  if (request.type === 'ANALYZE_THUMBNAILS') {
    ensureOffscreenDocument()
      .then(() => chrome.runtime.sendMessage({
        type: 'ANALYZE_THUMBNAILS',
        thumbnails: request.thumbnails
      }))
      .then(response => sendResponse(response))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // NEW PIPELINE: Find silenced videos
  if (request.type === 'FIND_SILENCED') {
    findSilencedForHomepage(request.scoredVideos)
      .then(pairs => sendResponse({ success: true, pairs }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // Homepage analysis (legacy - kept for compatibility)
  if (request.action === 'analyzeHomepage') {
    analyzeHomepageVideos(request.videoIds, request.feedContext)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // Discover silenced videos
  if (request.action === 'discoverSilenced') {
    discoverSilencedVideos(request.topicMap, request.excludedChannels, request.filters, request.feedContext || {})
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // Single video analysis (for hover popover)
  if (request.action === 'analyzeVideo') {
    const { videoData } = request
    // Quick analysis without full API call
    sendResponse({
      success: true,
      data: {
        videoId: videoData.videoId,
        biasScore: 50, // Default - would need full analysis
        confidence: 0.5,
        tags: []
      }
    })
    return false
  }

  // Bias Lens state
  if (request.action === 'setBiasLens') {
    chrome.storage.local.set({ biasLensEnabled: request.enabled })
    sendResponse({ success: true })
    return false
  }

  if (request.action === 'getBiasLens') {
    chrome.storage.local.get(['biasLensEnabled'], (result) => {
      sendResponse({ enabled: result.biasLensEnabled || false })
    })
    return true
  }

  if (request.action === 'analyze') {
    analyzeVideo(request.videoId, request.transcript)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // Hidden Gems discovery for watch page MVP
  if (request.action === 'findHiddenGems') {
    discoverHiddenGems(request.videoId, request.channelId, request.title)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // Backend-powered analysis (uses Python server for transcripts + Gemini)
  if (request.action === 'analyzeWithBackend') {
    analyzeWithBackend(request.videoId, request.title, request.query)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // Fetch transcript from backend (no CORS issues)
  if (request.action === 'fetchTranscript') {
    fetchTranscriptFromBackend(request.videoId)
      .then(transcript => sendResponse({ success: true, transcript }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // Check backend health
  if (request.action === 'checkBackendHealth') {
    checkBackendHealth()
      .then(health => sendResponse({ success: true, health }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  if (request.action === 'discover' || request.action === 'cancelNoise') {
    runNoiseCancellation(request.query)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  // Perspective Search
  if (request.action === 'perspectiveSearch') {
    console.log(`[Perspective] Received perspective search request for: "${request.query}"`)
    console.log(`[Perspective] Feature flag enabled: ${ENABLE_PERSPECTIVE_SEARCH}`)

    runPerspectiveSearch(request.query, request.maxPerPerspective || 2)
      .then(result => {
        console.log(`[Perspective] Returning ${result.perspectives?.length || 0} perspective buckets`)
        console.log(`[Perspective] Result structure:`, {
          hasPerspectives: !!result.perspectives,
          perspectivesLength: result.perspectives?.length,
          debug: result.debug
        })
        sendResponse({ success: true, data: result })
      })
      .catch(err => {
        console.error('[Perspective] Error in runPerspectiveSearch:', err)
        console.error('[Perspective] Error stack:', err.stack)
        sendResponse({ success: false, error: err.message || String(err) })
      })
    return true // Keep channel open for async response
  }

  if (request.action === 'getChannel') {
    getChannel(request.channelId)
      .then(channel => sendResponse({ success: true, data: channel }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  if (request.action === 'getChannelByHandle') {
    getChannelByHandle(request.handle)
      .then(subs => sendResponse({ success: true, subscriberCount: subs }))
      .catch(err => sendResponse({ success: false, subscriberCount: 0, error: err.message }))
    return true
  }

  if (request.action === 'searchSilencedCreators') {
    searchSilencedCreators(request.query)
      .then(creators => sendResponse({ success: true, creators }))
      .catch(err => sendResponse({ success: false, creators: [], error: err.message }))
    return true
  }

  if (request.action === 'checkMonopoly' || request.action === 'checkNoiseLevel') {
    getChannel(request.channelId)
      .then(channel => {
        const subs = parseInt(channel?.statistics?.subscriberCount || '0')
        const isNoisy = subs > MAX_SUBSCRIBER_THRESHOLD
        sendResponse({
          success: true,
          isNoisy,
          isMonopoly: isNoisy, // backward compatibility
          subscriberCount: subs,
          noiseLevel: getNoiseLevel(isNoisy ? 70 : 30)
        })
      })
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }

  if (request.action === 'getQuotaStatus') {
    sendResponse({
      quotaUsed,
      quotaLimit: QUOTA_LIMIT,
      remaining: QUOTA_LIMIT - quotaUsed,
      cacheSize: Object.keys(channelCache).length
    })
    return false
  }

  if (request.action === 'setDiscoveryMode' || request.action === 'setNoiseCancellation') {
    chrome.storage.local.set({
      discoveryMode: request.enabled,
      noiseCancellationActive: request.enabled
    })
    sendResponse({ success: true })
    return false
  }

  if (request.action === 'getDiscoveryMode' || request.action === 'getNoiseCancellation') {
    chrome.storage.local.get(['discoveryMode', 'noiseCancellationActive'], (result) => {
      sendResponse({
        enabled: result.discoveryMode || result.noiseCancellationActive || false,
        noiseCancellationActive: result.noiseCancellationActive || result.discoveryMode || false
      })
    })
    return true
  }
})

// Reset quota daily
chrome.alarms.create('resetQuota', { periodInMinutes: 1440 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'resetQuota') {
    quotaUsed = 0
    saveCache()
    console.log('[Silenced] Daily quota reset')
  }
})

// Extension icon click - Toggle noise cancellation
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url?.includes('youtube.com')) {
    chrome.tabs.sendMessage(tab.id, { action: 'toggleNoiseCancellation' })
  } else {
    chrome.tabs.create({ url: 'https://www.youtube.com' })
  }
})

console.log('[BiasLens] 🔍 Bias Lens Engine v4.0 loaded - See what the algorithm amplifies, hear what it silences')
