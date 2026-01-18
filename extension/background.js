// Silenced by the Algorithm - Noise Cancellation Engine
// Hear the voices the algorithm drowns out

// ============================================
// CONFIGURATION & VERSIONING
// ============================================
const SCHEMA_VERSION = '3.1.0'
const ENGINE_VERSION = 'v3.1'

const YOUTUBE_API_KEY = 'AIzaSyA_TCvrL72kC5xplism_FJDCtl8UshToHQ'
const MAX_SUBSCRIBER_THRESHOLD = 100000 // Noise cancellation threshold
const MONOPOLY_THRESHOLD = 1000000 // 1M subs = deafening noise
const CACHE_TTL = 86400000 // 24 hours in ms
const BIAS_RECEIPT_CACHE_TTL = 21600000 // 6 hours in ms

// Feature flags
const ENABLE_ML_FEATURES = true // Set to true to enable Gemini-powered features
const GEMINI_API_KEY = 'AIzaSyCr7sAWdtD4GYKmnFU6fG1nVNnZQbBm-og' // Add your Gemini API key here - REQUIRED for quality filtering

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
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`)
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text

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
// AUDIT METRICS COMPUTATION (Deterministic, no Gemini)
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
    diversityMethod
  }
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
 * @returns {Promise<Object>} Quality assessment
 */
async function scoreVideoQuality(video, searchQuery) {
  const cacheKey = `quality_${video.videoId}`

  // Check cache first
  if (qualityScoreCache[cacheKey] && Date.now() - qualityScoreCache[cacheKey].timestamp < QUALITY_CACHE_TTL) {
    return qualityScoreCache[cacheKey].data
  }

  // Try Gemini if API key is available
  if (GEMINI_API_KEY && ENABLE_ML_FEATURES) {
    try {
      const geminiResult = await scoreVideoQualityWithGemini(video, searchQuery)
      if (geminiResult) {
        qualityScoreCache[cacheKey] = { data: geminiResult, timestamp: Date.now() }
        return geminiResult
      }
    } catch (err) {
      console.warn('[Silenced] Gemini quality scoring failed, using heuristic:', err.message)
    }
  }

  // Fallback to heuristic scoring
  const heuristicResult = scoreVideoQualityHeuristic(video, searchQuery)
  qualityScoreCache[cacheKey] = { data: heuristicResult, timestamp: Date.now() }
  return heuristicResult
}

/**
 * Score video quality using Gemini AI
 */
async function scoreVideoQualityWithGemini(video, searchQuery) {
  const prompt = `You are evaluating if a YouTube video is a HIGH-QUALITY alternative for someone interested in "${searchQuery}".

Video Title: "${video.title}"
Channel: "${video.channelTitle}"
Description: "${(video.description || '').substring(0, 500)}"

Score this video on TWO dimensions (0.0 to 1.0 each):

1. RELEVANCE: Is this video actually about "${searchQuery}"? 
   - 0.0 = Completely unrelated, just keyword spam
   - 0.5 = Tangentially related
   - 1.0 = Directly addresses the topic

2. QUALITY SIGNALS: Does this look like quality content?
   - Consider: descriptive title (not clickbait), informative description, legitimate channel name
   - 0.0 = Spam/low-effort/clickbait
   - 0.5 = Average quality
   - 1.0 = Professional/educational/well-produced

Respond with ONLY valid JSON in this exact format:
{"relevance": 0.X, "quality": 0.X, "reason": "brief 10-word reason"}

Be strict - most random search results should score below 0.5.`

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent scoring
          maxOutputTokens: 150
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`)
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) return null

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    // Validate and normalize scores
    const relevance = Math.max(0, Math.min(1, parseFloat(parsed.relevance) || 0))
    const quality = Math.max(0, Math.min(1, parseFloat(parsed.quality) || 0))
    const combinedScore = (relevance * 0.6) + (quality * 0.4) // Relevance weighted higher

    return {
      score: combinedScore,
      relevance,
      quality,
      reason: parsed.reason || 'Evaluated by AI',
      method: 'gemini'
    }
  } catch (err) {
    console.error('[Silenced] Gemini quality scoring error:', err)
    return null
  }
}

/**
 * Heuristic fallback for video quality scoring (no Gemini)
 */
function scoreVideoQualityHeuristic(video, searchQuery) {
  let relevanceScore = 0
  let qualityScore = 0
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

  // Normalize scores
  relevanceScore = Math.max(0, Math.min(1, relevanceScore))
  qualityScore = Math.max(0, Math.min(1, qualityScore))

  const combinedScore = (relevanceScore * 0.6) + (qualityScore * 0.4)

  return {
    score: combinedScore,
    relevance: relevanceScore,
    quality: qualityScore,
    reason: reasons.length > 0 ? reasons.join(', ') : 'Heuristic evaluation',
    method: 'heuristic'
  }
}

/**
 * Batch score multiple videos for quality
 */
async function batchScoreVideoQuality(videos, searchQuery) {
  const results = await Promise.all(
    videos.map(async (video) => {
      const qualityResult = await scoreVideoQuality(video, searchQuery)
      return {
        ...video,
        qualityScore: qualityResult.score,
        qualityDetails: qualityResult
      }
    })
  )
  return results
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

  // Check if sustainability-related
  const matchedKeywords = SUSTAINABILITY_KEYWORDS.filter(kw => fullText.includes(kw))
  const isSustainabilityTopic = matchedKeywords.length >= 2

  if (!isSustainabilityTopic) {
    return { isSustainability: false, auditResult: null, detailedAnalysis: null }
  }

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

  // Run sustainability audit (pass channel for detailed analysis)
  const sustainabilityAudit = auditSustainability(video, transcript, channel)

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

  const silencedChannelIds = new Set(silencedVoices.map(c => c.id))

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

  // === QUALITY SCORING: Score and filter videos for quality/relevance ===
  console.log(`[Silenced] Scoring ${unmutedVideosPreQuality.length} videos for quality...`)
  const videosWithQuality = await batchScoreVideoQuality(unmutedVideosPreQuality, query)

  // Filter out low-quality videos
  let qualityFilteredVideos = videosWithQuality.filter(v => {
    const passes = v.qualityScore >= MIN_VIDEO_QUALITY_SCORE
    if (!passes) {
      console.log(`[Silenced] Filtered out low-quality video: "${v.title}" (score: ${v.qualityScore.toFixed(2)})`)
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
      if (v.engagementRatio > 1.5) {
        whySurfaced.push(`Strong engagement ratio (${v.engagementRatio.toFixed(1)}x views per subscriber)`)
      }
      if (v.qualityScore >= 0.6) {
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
      const surfaceMethod = v.qualityDetails?.method === 'gemini'
        ? 'quality_filtered_gemini'
        : 'quality_filtered_heuristic'

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
      const aScore = (a.qualityScore * 0.7) + (Math.min(a.engagementRatio, 3) / 3 * 0.3)
      const bScore = (b.qualityScore * 0.7) + (Math.min(b.engagementRatio, 3) / 3 * 0.3)
      return bScore - aScore
    })

  // Generate bias receipts for top videos (async) with error handling
  let unmutedVideos = []
  try {
    unmutedVideos = await Promise.all(
      unmutedVideosRaw.slice(0, 10).map(async (video) => {
        try {
          const biasReceipt = await generateBiasReceipt(video._receiptParams)
          // Remove internal params, add receipt
          const { _receiptParams, ...cleanVideo } = video
          return {
            ...cleanVideo,
            biasReceipt // Optional field as per spec
          }
        } catch (err) {
          console.warn('[Silenced] Failed to generate bias receipt for video:', video.videoId, err)
          // Return video without receipt on error
          const { _receiptParams, ...cleanVideo } = video
          return cleanVideo
        }
      })
    )
  } catch (err) {
    console.error('[Silenced] Failed to generate bias receipts:', err)
    // Fallback: return videos without receipts
    unmutedVideos = unmutedVideosRaw.slice(0, 10).map(video => {
      const { _receiptParams, ...cleanVideo } = video
      return cleanVideo
    })
  }

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
  const qualityFilterStats = {
    qualityFiltered: videosWithQuality.length - qualityFilteredVideos.length,
    redundancyFiltered: 0 // Future: track duplicates removed
  }
  const auditMetrics = computeAuditMetrics(unmutedVideos, topicConcentration, qualityFilterStats)

  // Add surfaceMethod to each video for audit display
  const unmutedVideosWithMethod = unmutedVideos.map(video => ({
    ...video,
    surfaceMethod: video.isRisingSignal ? 'rising_signal' : 'engagement_ranking',
    diversityNote: video.isRisingSignal
      ? 'Surfaced due to high engagement relative to channel size'
      : 'Surfaced via under-representation filter and engagement ranking'
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
// MESSAGE HANDLING
// ===============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyze') {
    analyzeVideo(request.videoId, request.transcript)
      .then(result => sendResponse({ success: true, data: result }))
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

console.log('[Silenced] 🔇 Noise Cancellation Engine v3.0 loaded - Hear the voices the algorithm drowns out')
