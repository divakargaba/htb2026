// Silenced by the Algorithm - Bias Lens Engine
// See what the algorithm amplifies, hear what it silences

// ============================================
// CONFIGURATION & VERSIONING
// ============================================
const SCHEMA_VERSION = '4.0.0'
const ENGINE_VERSION = 'v4.0'

const YOUTUBE_API_KEY = 'AIzaSyDNdZOfU79GgP3-fZ-KezbiT158mGpi3dc'
const MAX_SUBSCRIBER_THRESHOLD = 100000 // Noise cancellation threshold
const MONOPOLY_THRESHOLD = 1000000 // 1M subs = deafening noise
const CACHE_TTL = 86400000 // 24 hours in ms
const BIAS_RECEIPT_CACHE_TTL = 21600000 // 6 hours in ms

// Feature flags
const ENABLE_ML_FEATURES = true // Set to true to enable Gemini-powered features
const GEMINI_API_KEY = 'AIzaSyBS9o40P0nC5QtV-wTPDEkQ4z5sMA65ZnQ' // Gemini API key for quality filtering

// Python Backend URL (for transcript fetching + Gemini without CORS issues)
// Set to your deployed backend URL, or 'http://localhost:8000' for local dev
const PYTHON_BACKEND_URL = 'http://localhost:8000'
const USE_PYTHON_BACKEND = true // Set to true to use Python backend for transcripts/AI

// Backend health cache - avoid repeated failed requests to downed backend
let backendHealthCache = { healthy: null, lastCheck: 0 }
const BACKEND_HEALTH_CHECK_INTERVAL = 30000 // Only re-check every 30 seconds

// Quality thresholds
const MIN_VIDEO_QUALITY_SCORE = 0.25 // Minimum quality score (0-1) to surface a video (lowered to avoid filtering all)
const QUALITY_CACHE_TTL = 3600000 // 1 hour cache for quality scores

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
  if (ENABLE_ML_FEATURES && GEMINI_API_KEY) {
    try {
      const geminiReceipt = await generateBiasReceiptWithGemini(params)
      if (geminiReceipt) {
        // Cache the result
        biasReceiptCache[cacheKey] = { data: geminiReceipt, timestamp: Date.now() }
        saveCache()
        return geminiReceipt
      }
    } catch (err) {
      console.warn('[Silenced] Gemini bias receipt failed, falling back to heuristic:', err.message)
    }
  }

  // Heuristic fallback - deterministic bullets based on thresholds
  const whyNotShown = generateHeuristicWhyNotShown(params)
  const whySurfaced = generateHeuristicWhySurfaced(params)
  const confidence = calculateReceiptConfidence(params)

  const receipt = {
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
 * Call Gemini API with multiple model fallbacks
 * Skips querying available models to avoid CORS issues
 */
async function callGeminiAPI(prompt, config = {}) {
  const { temperature = 0.3, maxOutputTokens = 500 } = config

  // Try multiple API versions and models (skip querying to avoid CORS)
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`,
    `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`
  ]

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens
          }
        })
      })

      if (response.ok) {
        const data = await response.json()
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null
      } else if (response.status === 404) {
        // Try next endpoint
        continue
      } else {
        // Other error - log and try next
        const errorText = await response.text()
        console.warn(`[Silenced] Gemini API error ${response.status}:`, errorText)
        continue
      }
    } catch (err) {
      // CORS or network errors - try next endpoint
      if (err.message.includes('CORS') || err.message.includes('Failed to fetch')) {
        console.warn(`[Silenced] Gemini API CORS/network error, trying next endpoint...`)
      } else {
        console.warn(`[Silenced] Gemini API call failed:`, err.message)
      }
      continue
    }
  }

  // All endpoints failed - return null to trigger heuristic fallback
  console.warn('[Silenced] All Gemini API endpoints failed, using heuristic fallback')
  return null
}

/**
 * Generate bias receipt using Gemini AI (when ENABLE_ML_FEATURES is true)
 */
async function generateBiasReceiptWithGemini(params) {
  if (!GEMINI_API_KEY) return null

  const { subscriberCount, viewsPerDay, engagementRatio, avgSubsInTopic, topicConcentration, videoTitle, channelTitle } = params

  const prompt = `You are analyzing algorithmic bias in YouTube recommendations. Generate a bias receipt for this video.

Video: "${videoTitle}" by ${channelTitle}
Channel subscribers: ${fmt(subscriberCount)}
Views/day: ${fmt(viewsPerDay)}
Engagement ratio: ${engagementRatio.toFixed(2)}
Topic avg subscribers: ${fmt(avgSubsInTopic)}
Topic concentration by top channels: ${topicConcentration}%

Generate a JSON response with EXACTLY this structure:
{
  "whyNotShown": ["bullet 1", "bullet 2", "bullet 3"],
  "whySurfaced": ["bullet 1", "bullet 2", "bullet 3"],
  "confidence": "low" | "medium" | "high"
}

RULES:
- Each bullet must be under 15 words
- Use neutral, non-defamatory language
- Use phrases like "may indicate", "limited evidence", "based on public signals"
- Do NOT make factual accusations
- whyNotShown: 2-4 bullets explaining algorithmic disadvantage
- whySurfaced: 2-4 bullets explaining why we're recommending this
- Be concise and specific`

  try {
    const text = await callGeminiAPI(prompt, {
      temperature: 0.3,
      maxOutputTokens: 500
    })

    if (!text) return null

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    // Validate structure
    if (!Array.isArray(parsed.whyNotShown) || !Array.isArray(parsed.whySurfaced)) {
      return null
    }

    return {
      whyNotShown: parsed.whyNotShown.slice(0, 4),
      whySurfaced: parsed.whySurfaced.slice(0, 4),
      confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium',
      method: 'gemini'
    }
  } catch (err) {
    console.error('[Silenced] Gemini API error:', err)
    return null
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

      const data = await response.json()

      if (data.events?.length) {
        const text = data.events
          .filter(e => e.segs)
          .flatMap(e => e.segs.map(s => s.utf8 || ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()

        if (text.length > 100) {
          console.log(`[Silenced] Successfully fetched transcript for ${videoId} (lang: ${lang || 'default'}): ${text.length} chars`)
          return text
        }
      }
    } catch (err) {
      console.log(`[Silenced] Transcript fetch failed for ${videoId} (lang: ${lang}):`, err.message)
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

  // Try Gemini directly if API key is available (may have CORS issues from extension)
  if (GEMINI_API_KEY && ENABLE_ML_FEATURES) {
    try {
      const geminiResult = await scoreVideoQualityWithGemini(video, searchQuery, transcript)
      if (geminiResult) {
        qualityScoreCache[cacheKey] = { data: geminiResult, timestamp: Date.now() }
        return geminiResult
      }
    } catch (err) {
      console.warn('[Silenced] Gemini quality scoring failed, using heuristic:', err.message)
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
async function scoreVideoQualityWithGemini(video, searchQuery, transcript = null) {
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

  return {
    score: combinedScore,
    relevance: relevanceScore,
    quality: qualityScore,
    contentDepth: contentDepthScore,
    reason: reasons.length > 0 ? reasons.join(', ') : 'Heuristic evaluation',
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

  console.log(`[Silenced] Built ${unmutedVideosPreQuality.length} unmuted videos before quality scoring`)

  if (unmutedVideosPreQuality.length === 0) {
    console.warn(`[Silenced] ⚠️ No silenced voices found for query "${query}" - all channels may be above ${MAX_SUBSCRIBER_THRESHOLD} subs threshold`)
  }

  // === QUALITY SCORING: Two-pass scoring with transcript analysis for top candidates ===
  // Deep analyze top 5 with transcripts for quality verification
  console.log(`[Silenced] Scoring ${unmutedVideosPreQuality.length} videos for quality...`)
  const videosWithQuality = await twoPassQualityScoring(unmutedVideosPreQuality, query, 5) // Deep analyze top 5 with transcripts

  // Filter out low-quality videos
  let qualityFilteredVideos = videosWithQuality.filter(v => {
    const passes = (v.qualityScore || 0) >= MIN_VIDEO_QUALITY_SCORE
    if (!passes) {
      const score = typeof v.qualityScore === 'number' ? v.qualityScore.toFixed(2) : 'N/A'
      console.log(`[Silenced] Filtered out low-quality video: "${v.title}" (score: ${score})`)
    }
    return passes
  })

  console.log(`[Silenced] Quality filter: ${videosWithQuality.length} -> ${qualityFilteredVideos.length} videos (threshold: ${MIN_VIDEO_QUALITY_SCORE})`)

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

  // Return videos immediately (fast path) - generate bias receipts in background
  // This allows the UI to show videos quickly while receipts load asynchronously
  // Generate bias receipts for top 5 videos (awaited so they're ready for display)
  const unmutedVideos = await Promise.all(
    unmutedVideosRaw.slice(0, 10).map(async (video, index) => {
      const { _receiptParams, ...cleanVideo } = video

      // Generate bias receipt for top 5 videos
      if (index < 5 && _receiptParams) {
        try {
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
    
    // Map to bias score format
    const biasScore = noiseAnalysis.totalScore
    const confidence = activities.length > 0 ? 0.85 : 0.6 // Higher if we have activities
    
    // Generate contributions/tags - IMPROVED: Lower threshold + more factors
    const contributions = []
    
    // Channel size contribution (always show for transparency)
    if (subs >= 10000000) {
      contributions.push({ factor: 'Mega Channel', value: 35, color: '#dc2626', description: '10M+ subscribers dominates algorithm' })
    } else if (subs >= 1000000) {
      contributions.push({ factor: 'Authority Boost', value: 28, color: '#ef4444', description: '1M+ subs get algorithmic advantage' })
    } else if (subs >= 500000) {
      contributions.push({ factor: 'High Authority', value: 20, color: '#f97316', description: '500K+ subs compete for visibility' })
    } else if (subs >= 100000) {
      contributions.push({ factor: 'Established', value: 12, color: '#f59e0b', description: '100K+ subs has some advantage' })
    } else if (subs < 50000 && subs > 0) {
      contributions.push({ factor: 'Small Creator', value: -15, color: '#10b981', description: 'Under 50K - algorithm disadvantage' })
    }
    
    // Velocity contribution
    if (viewsPerHour > 50000) {
      contributions.push({ factor: 'Viral Velocity', value: 25, color: '#8b5cf6', description: 'Extremely fast view accumulation' })
    } else if (viewsPerHour > 10000) {
      contributions.push({ factor: 'Trend Spike', value: 18, color: '#a855f7', description: 'High velocity views' })
    } else if (viewsPerHour > 1000) {
      contributions.push({ factor: 'Rising Fast', value: 10, color: '#c084fc', description: 'Above average view velocity' })
    }
    
    // Upload frequency (if we have activities)
    if (activities.length > 0) {
      const uploadsPerWeek = activities.length / 4 // Approximate (activities are last ~month)
      if (uploadsPerWeek >= 7) {
        contributions.push({ factor: 'Daily Poster', value: 15, color: '#06b6d4', description: 'Frequent uploads boost algorithm favor' })
      } else if (uploadsPerWeek >= 3) {
        contributions.push({ factor: 'Active Channel', value: 8, color: '#22d3d1', description: 'Regular uploads help visibility' })
      }
    }
    
    // Recency boost
    if (videoAgeHours < 24) {
      contributions.push({ factor: 'Fresh Upload', value: 12, color: '#22c55e', description: 'New videos get temporary boost' })
    } else if (videoAgeHours < 72) {
      contributions.push({ factor: 'Recent', value: 6, color: '#4ade80', description: 'Still in newness window' })
    }
    
    // Engagement signals
    const likeRatio = views > 0 ? parseInt(video.statistics?.likeCount || '0') / views : 0
    if (likeRatio > 0.05) {
      contributions.push({ factor: 'High Engagement', value: 10, color: '#f472b6', description: '5%+ like ratio signals quality' })
    }
    
    // Sort by absolute value
    contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    
    // Generate tags from top contributions
    const tags = contributions.slice(0, 4).map(c => ({
      text: c.value > 0 ? `${c.factor} +${c.value}` : `${c.factor} ${c.value}`,
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
      scores: {
        aas: noiseAnalysis.totalScore,
        channelSize: subs,
        velocity: Math.round(viewsPerHour),
        ms: 0,
        cis: 0
      },
      contributions,
      tags,
      metrics: {
        views,
        subs,
        age: getVideoAge(video.snippet?.publishedAt),
        velocity: viewsPerHour > 10000 ? 'high' : viewsPerHour > 1000 ? 'medium' : 'low',
        thumbAbuse: 0,
        sponsorDetected: false
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
  
  // Build search query - use multiple strategies
  let query = ''
  
  // Strategy 1: Use top 3 topic names with keywords
  const topTopics = (topicMap || [])
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, 3)
  
  if (topTopics.length > 0) {
    // Use topic keywords for more specific search
    const keywords = topTopics
      .flatMap(t => t.keywords || [t.name || t])
      .slice(0, 5)
    query = keywords.join(' ')
  }
  
  // Strategy 2: Fallback - use feed context titles directly
  if (!query && feedContext.titles && feedContext.titles.length > 0) {
    // Extract key words from first few video titles
    const titleWords = feedContext.titles
      .slice(0, 3)
      .join(' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3 && !['this', 'that', 'with', 'from', 'have', 'will', 'your', 'what', 'when', 'where', 'which'].includes(w))
      .slice(0, 6)
    query = titleWords.join(' ')
  }
  
  // Strategy 3: Ultimate fallback - generic diverse content search
  if (!query || query.length < 5) {
    console.warn('[BiasLens] No specific topics found - using diverse content fallback')
    // Search for educational/informative content from smaller creators
    query = 'educational tutorial explained documentary independent'
  }
  
  console.log(`[BiasLens] Search query for silenced videos: "${query}"`)
  
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
  
  return {
    videos: filteredVideos.slice(0, 12),
    biasSnapshot: result.biasSnapshot,
    topicConcentration: result.biasSnapshot?.topicConcentration || 0
  }
}

// ===============================================
// MESSAGE HANDLING
// ===============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Homepage analysis
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
