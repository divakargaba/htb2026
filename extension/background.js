// Silenced - Discovery Engine Background Service Worker
// Advanced Equity Score Calculation + Sustainability Audit

const YOUTUBE_API_KEY = 'AIzaSyAV_xT7shJvRyip9yCSpvx7ogZhiPpi2LY'
const MAX_SUBSCRIBER_THRESHOLD = 100000 // Discovery filter threshold
const MONOPOLY_THRESHOLD = 1000000 // 1M subs = monopoly
const CACHE_TTL = 86400000 // 24 hours in ms

// Quota costs
const QUOTA_LIMIT = 10000
let quotaUsed = 0

// In-memory cache (also synced to localStorage for persistence)
let channelCache = {}
let discoveryCache = {}

// ===============================================
// PERSISTENCE - Load cache from localStorage
// ===============================================
async function loadCache() {
  try {
    const stored = await chrome.storage.local.get(['channelCache', 'quotaUsed', 'quotaResetDate'])
    
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
    
    // Reset quota if new day
    const today = new Date().toDateString()
    if (stored.quotaResetDate !== today) {
      quotaUsed = 0
      await chrome.storage.local.set({ quotaUsed: 0, quotaResetDate: today })
    } else {
      quotaUsed = stored.quotaUsed || 0
    }
    
    console.log(`[Silenced] Cache loaded: ${Object.keys(channelCache).length} channels, ${quotaUsed} quota used`)
  } catch (err) {
    console.error('[Silenced] Cache load error:', err)
  }
}

async function saveCache() {
  try {
    await chrome.storage.local.set({ 
      channelCache, 
      quotaUsed,
      quotaResetDate: new Date().toDateString()
    })
  } catch (err) {
    console.error('[Silenced] Cache save error:', err)
  }
}

// Initialize cache on load
loadCache()

// ===============================================
// EQUITY SCORE CALCULATION ENGINE
// Weighted average of 4 API-derived metrics
// ===============================================
function calculateEquityScore(channel, videoStats, activities) {
  const subs = parseInt(channel?.statistics?.subscriberCount || '0')
  const views = parseInt(videoStats?.viewCount || '0')
  const likes = parseInt(videoStats?.likeCount || '0')
  const comments = parseInt(videoStats?.commentCount || '0')
  const duration = parseDuration(videoStats?.duration || 'PT0S')
  const recentUploads = activities?.length || 0
  
  // =========================================
  // 1. MONOPOLY FACTOR (40% weight)
  // High score = high bias (large channels)
  // =========================================
  let monopolyScore = 0
  let monopolyExplanation = ''
  
  if (subs >= 10000000) {
    monopolyScore = 100
    monopolyExplanation = 'Mega-creator (10M+ subs) - Maximum algorithmic advantage'
  } else if (subs >= 5000000) {
    monopolyScore = 90
    monopolyExplanation = 'Major creator (5M+ subs) - Extreme recommendation priority'
  } else if (subs >= MONOPOLY_THRESHOLD) {
    monopolyScore = 80
    monopolyExplanation = 'Large creator (1M+ subs) - Strong algorithmic favoritism'
  } else if (subs >= 500000) {
    monopolyScore = 60
    monopolyExplanation = 'Established creator (500K+ subs) - Significant recommendation boost'
  } else if (subs >= 100000) {
    monopolyScore = 40
    monopolyExplanation = 'Growing creator (100K+ subs) - Moderate algorithmic support'
  } else if (subs >= 10000) {
    monopolyScore = 20
    monopolyExplanation = 'Small creator (10K+ subs) - Limited algorithmic visibility'
  } else {
    monopolyScore = 5
    monopolyExplanation = 'Micro creator (<10K subs) - Minimal algorithmic reach'
  }
  
  // =========================================
  // 2. ENGAGEMENT-TO-REACH RATIO (30% weight)
  // Lower ratio = algorithm pushing regardless of quality
  // =========================================
  const engagementRatio = views > 0 ? ((comments + likes) / views) * 100 : 0
  let engagementScore = 0
  let engagementExplanation = ''
  
  // Monopolies often have LOWER engagement ratios because algorithm pushes them anyway
  if (engagementRatio < 0.5) {
    engagementScore = 90
    engagementExplanation = `Very low engagement (${engagementRatio.toFixed(2)}%) - Algorithm pushing despite poor interaction`
  } else if (engagementRatio < 1) {
    engagementScore = 70
    engagementExplanation = `Low engagement (${engagementRatio.toFixed(2)}%) - Views outpace genuine interaction`
  } else if (engagementRatio < 3) {
    engagementScore = 50
    engagementExplanation = `Average engagement (${engagementRatio.toFixed(2)}%) - Typical algorithmic content`
  } else if (engagementRatio < 5) {
    engagementScore = 30
    engagementExplanation = `Good engagement (${engagementRatio.toFixed(2)}%) - Audience genuinely interested`
  } else {
    engagementScore = 10
    engagementExplanation = `Excellent engagement (${engagementRatio.toFixed(2)}%) - Rising Star potential`
  }
  
  // =========================================
  // 3. UPLOAD DENSITY (20% weight)
  // High frequency = gaming upload velocity algorithm
  // =========================================
  let uploadScore = 0
  let uploadExplanation = ''
  
  // recentUploads = videos in last 30 days from activities.list
  if (recentUploads >= 30) {
    uploadScore = 100
    uploadExplanation = `${recentUploads} uploads/month - Extreme upload frequency bias`
  } else if (recentUploads >= 20) {
    uploadScore = 80
    uploadExplanation = `${recentUploads} uploads/month - High frequency gaming`
  } else if (recentUploads >= 10) {
    uploadScore = 60
    uploadExplanation = `${recentUploads} uploads/month - Regular upload schedule`
  } else if (recentUploads >= 4) {
    uploadScore = 40
    uploadExplanation = `${recentUploads} uploads/month - Moderate frequency`
  } else {
    uploadScore = 15
    uploadExplanation = `${recentUploads} uploads/month - Quality over quantity approach`
  }
  
  // =========================================
  // 4. RETENTION GAMING (10% weight)
  // 8-10 min mark = optimized for algorithm
  // =========================================
  let retentionScore = 0
  let retentionExplanation = ''
  
  const minutes = duration / 60
  if (minutes >= 8 && minutes <= 12) {
    retentionScore = 100
    retentionExplanation = `${minutes.toFixed(1)} min - Optimized for mid-roll ads (8-12 min sweet spot)`
  } else if (minutes >= 6 && minutes < 8) {
    retentionScore = 70
    retentionExplanation = `${minutes.toFixed(1)} min - Near optimal ad placement length`
  } else if (minutes > 12 && minutes <= 20) {
    retentionScore = 60
    retentionExplanation = `${minutes.toFixed(1)} min - Long-form for maximum watch time`
  } else if (minutes > 20) {
    retentionScore = 40
    retentionExplanation = `${minutes.toFixed(1)} min - Deep content, less algorithmically optimized`
  } else {
    retentionScore = 20
    retentionExplanation = `${minutes.toFixed(1)} min - Short form, limited ad revenue optimization`
  }
  
  // =========================================
  // CALCULATE WEIGHTED TOTAL
  // =========================================
  const totalScore = Math.round(
    (monopolyScore * 0.40) +
    (engagementScore * 0.30) +
    (uploadScore * 0.20) +
    (retentionScore * 0.10)
  )
  
  return {
    totalScore,
    breakdown: [
      {
        factor: 'Recommendation Monopoly',
        score: monopolyScore,
        weight: 40,
        weighted: Math.round(monopolyScore * 0.40),
        explanation: monopolyExplanation,
        metric: `${fmt(subs)} subscribers`
      },
      {
        factor: 'Engagement-to-Reach Ratio',
        score: engagementScore,
        weight: 30,
        weighted: Math.round(engagementScore * 0.30),
        explanation: engagementExplanation,
        metric: `${engagementRatio.toFixed(2)}% ratio`
      },
      {
        factor: 'Upload Frequency Bias',
        score: uploadScore,
        weight: 20,
        weighted: Math.round(uploadScore * 0.20),
        explanation: uploadExplanation,
        metric: `${recentUploads} videos/30 days`
      },
      {
        factor: 'Watch Time Exploitation',
        score: retentionScore,
        weight: 10,
        weighted: Math.round(retentionScore * 0.10),
        explanation: retentionExplanation,
        metric: `${minutes.toFixed(1)} minutes`
      }
    ],
    rawMetrics: {
      subscriberCount: subs,
      viewCount: views,
      likeCount: likes,
      commentCount: comments,
      engagementRatio,
      duration: minutes,
      recentUploads
    }
  }
}

// ===============================================
// KPMG SUSTAINABILITY AUDIT MODULE
// ===============================================
const SUSTAINABILITY_CATEGORIES = {
  27: 'Education',
  28: 'Science & Technology',
  25: 'News & Politics',
  22: 'People & Blogs'
}

const SUSTAINABILITY_KEYWORDS = [
  'net-zero', 'net zero', 'climate', 'sustainable', 'sustainability',
  'esg', 'carbon', 'renewable', 'green energy', 'clean energy',
  'environment', 'eco-friendly', 'biodiversity', 'conservation'
]

const CLIMATE_JUSTICE_POSITIVE = [
  'equity', 'justice', 'community', 'indigenous', 'global south',
  'grassroots', 'local impact', 'frontline communities', 'environmental justice',
  'inclusive', 'marginalized', 'vulnerable communities', 'social impact'
]

const CLIMATE_JUSTICE_NEGATIVE = [
  'corporate offset', 'carbon credits only', 'greenwashing',
  'virtue signaling', 'marketing campaign', 'sponsored by oil'
]

function auditSustainability(video, transcript = '') {
  const categoryId = video.snippet?.categoryId
  const title = (video.snippet?.title || '').toLowerCase()
  const description = (video.snippet?.description || '').toLowerCase()
  const tags = (video.snippet?.tags || []).map(t => t.toLowerCase())
  const fullText = `${title} ${description} ${tags.join(' ')} ${transcript.toLowerCase()}`
  
  // Check if sustainability-related category
  const isSustainabilityCategory = SUSTAINABILITY_CATEGORIES.hasOwnProperty(categoryId)
  
  // Check for sustainability keywords
  const matchedKeywords = SUSTAINABILITY_KEYWORDS.filter(kw => fullText.includes(kw))
  const isSustainabilityTopic = matchedKeywords.length >= 2 || 
    (matchedKeywords.length >= 1 && isSustainabilityCategory)
  
  if (!isSustainabilityTopic) {
    return {
      isSustainability: false,
      auditResult: null
    }
  }
  
  // === CLIMATE JUSTICE AUDIT ===
  const positiveSignals = CLIMATE_JUSTICE_POSITIVE.filter(term => fullText.includes(term))
  const negativeSignals = CLIMATE_JUSTICE_NEGATIVE.filter(term => fullText.includes(term))
  
  // Calculate audit score
  let auditScore = 50 // Start neutral
  auditScore += positiveSignals.length * 15 // +15 per positive signal
  auditScore -= negativeSignals.length * 20 // -20 per negative signal
  auditScore = Math.max(0, Math.min(100, auditScore))
  
  // Determine badge eligibility
  const passesAudit = auditScore >= 60 && positiveSignals.length >= 1
  
  // Determine audit level
  let auditLevel = 'UNVERIFIED'
  let badgeColor = '#666'
  
  if (auditScore >= 80 && positiveSignals.length >= 2) {
    auditLevel = 'KPMG SUSTAINABILITY VERIFIED'
    badgeColor = '#00E676'
  } else if (auditScore >= 60) {
    auditLevel = 'CLIMATE JUSTICE CERTIFIED'
    badgeColor = '#4CAF50'
  } else if (auditScore >= 40) {
    auditLevel = 'PARTIAL COMPLIANCE'
    badgeColor = '#FFC107'
  } else {
    auditLevel = 'AUDIT WARNING'
    badgeColor = '#FF5722'
  }
  
  return {
    isSustainability: true,
    auditResult: {
      score: auditScore,
      level: auditLevel,
      badgeColor,
      passesAudit,
      category: SUSTAINABILITY_CATEGORIES[categoryId] || 'General',
      matchedKeywords,
      positiveSignals,
      negativeSignals,
      recommendation: passesAudit 
        ? 'Content demonstrates awareness of climate equity and community impact.'
        : 'Content could improve by including diverse perspectives and community-level solutions.'
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
// TOPIC SEARCH
// ===============================================
async function topicSearch(query, maxResults = 50) {
  if (quotaUsed + 100 > QUOTA_LIMIT) {
    console.warn('[Silenced] Quota limit approaching')
    return { videos: [], channelIds: [] }
  }
  
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search')
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('q', query)
    url.searchParams.set('type', 'video')
    url.searchParams.set('order', 'rating') // Order by rating for quality alternatives
    url.searchParams.set('maxResults', String(maxResults))
    url.searchParams.set('key', YOUTUBE_API_KEY)
    
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`Search API error: ${res.status}`)
    
    const data = await res.json()
    quotaUsed += 100
    
    const videos = data.items || []
    const channelIds = [...new Set(videos.map(v => v.snippet.channelId))]
    
    console.log(`[Silenced] Search: ${videos.length} videos from ${channelIds.length} channels`)
    
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
// FULL ANALYSIS - Video + Channel + Equity Score
// ===============================================
async function analyzeVideo(videoId, transcript = '') {
  console.log(`[Silenced] Analyzing video: ${videoId}`)
  
  // Get video details
  const video = await getVideo(videoId)
  if (!video) {
    return { error: 'VIDEO_NOT_FOUND' }
  }
  
  // Get channel details
  const channel = await getChannel(video.snippet.channelId)
  
  // Get recent activities for upload density
  const activities = await getChannelActivities(video.snippet.channelId)
  
  // Calculate equity score
  const equityScore = calculateEquityScore(channel, {
    viewCount: video.statistics?.viewCount,
    likeCount: video.statistics?.likeCount,
    commentCount: video.statistics?.commentCount,
    duration: video.contentDetails?.duration
  }, activities)
  
  // Run sustainability audit
  const sustainabilityAudit = auditSustainability(video, transcript)
  
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
    equityScore,
    sustainability: sustainabilityAudit,
    quotaUsed
  }
}

// ===============================================
// DISCOVERY ENGINE - Find equity alternatives
// ===============================================
async function runDiscoveryEngine(query) {
  const cacheKey = `discovery_${query.toLowerCase().trim()}`
  
  if (discoveryCache[cacheKey] && Date.now() - discoveryCache[cacheKey].timestamp < 900000) {
    return discoveryCache[cacheKey].data
  }
  
  console.log(`[Silenced] Discovery: "${query}"`)
  const startQuota = quotaUsed
  
  // Search for videos
  const { videos, channelIds } = await topicSearch(query, 50)
  
  // Batch get all channels
  const channels = await batchGetChannels(channelIds)
  const channelMap = new Map(channels.map(c => [c.id, c]))
  
  // Filter to equity channels (under threshold) and hide monopolies (>100K in sidebar)
  const equityChannels = channels.filter(ch => {
    const subs = parseInt(ch.statistics?.subscriberCount || '0')
    return subs < MAX_SUBSCRIBER_THRESHOLD
  })
  
  const equityChannelIds = new Set(equityChannels.map(c => c.id))
  
  // Identify Rising Stars (high engagement ratio)
  const risingStars = equityChannels.filter(ch => {
    const views = parseInt(ch.statistics?.viewCount || '0')
    const subs = parseInt(ch.statistics?.subscriberCount || '0')
    const videos = parseInt(ch.statistics?.videoCount || '0')
    const avgViews = videos > 0 ? views / videos : 0
    return subs > 0 && avgViews / subs > 2
  })
  
  // Build discovered videos
  const discoveredVideos = videos
    .filter(v => equityChannelIds.has(v.snippet.channelId))
    .map(v => {
      const ch = channelMap.get(v.snippet.channelId)
      const subs = parseInt(ch?.statistics?.subscriberCount || '0')
      const isRising = risingStars.some(r => r.id === v.snippet.channelId)
      
      return {
        videoId: v.id.videoId,
        title: v.snippet.title,
        description: v.snippet.description,
        thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
        channelId: v.snippet.channelId,
        channelTitle: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt,
        subscriberCount: subs,
        isRisingStar: isRising
      }
    })
    .sort((a, b) => {
      if (a.isRisingStar && !b.isRisingStar) return -1
      if (!a.isRisingStar && b.isRisingStar) return 1
      return 0
    })
  
  // Identify monopoly channels to hide
  const monopolyChannelIds = channels
    .filter(ch => parseInt(ch.statistics?.subscriberCount || '0') > MAX_SUBSCRIBER_THRESHOLD)
    .map(ch => ch.id)
  
  const result = {
    query,
    totalResults: videos.length,
    equityCreators: equityChannels.length,
    risingStarsCount: risingStars.length,
    discoveredVideos,
    monopolyChannelIds,
    quotaCost: quotaUsed - startQuota,
    timestamp: Date.now()
  }
  
  discoveryCache[cacheKey] = { data: result, timestamp: Date.now() }
  
  console.log(`[Silenced] Discovery complete: ${discoveredVideos.length} equity videos, ${monopolyChannelIds.length} monopolies hidden`)
  
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
  
  if (request.action === 'discover') {
    runDiscoveryEngine(request.query)
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
  
  if (request.action === 'checkMonopoly') {
    getChannel(request.channelId)
      .then(channel => {
        const subs = parseInt(channel?.statistics?.subscriberCount || '0')
        sendResponse({ 
          success: true, 
          isMonopoly: subs > MAX_SUBSCRIBER_THRESHOLD,
          subscriberCount: subs
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
  
  if (request.action === 'setDiscoveryMode') {
    chrome.storage.local.set({ discoveryMode: request.enabled })
    sendResponse({ success: true })
    return false
  }
  
  if (request.action === 'getDiscoveryMode') {
    chrome.storage.local.get(['discoveryMode'], (result) => {
      sendResponse({ enabled: result.discoveryMode || false })
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

// Extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url?.includes('youtube.com')) {
    chrome.tabs.sendMessage(tab.id, { action: 'toggleDiscoveryMode' })
  } else {
    chrome.tabs.create({ url: 'https://www.youtube.com' })
  }
})

console.log('[Silenced] Discovery Engine v2.0 loaded - Equity Score + Sustainability Audit')
