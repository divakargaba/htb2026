/**
 * Silenced by the Algorithm - Scoring Engine
 * 
 * Three-tier scoring system for bias analysis:
 * - AAS (Algorithmic Advantage Score): How well video fits YouTube's amplification incentives
 * - MS (Manipulation Score): How engineered the packaging is for clicks/retention
 * - CIS (Commercial Influence Score): Observable monetization and sponsorship signals
 * 
 * Final Bias Score = 0.55*AAS + 0.25*MS + 0.20*CIS
 */

;(function() {
'use strict';

// ============================================
// CONSTANTS & WEIGHTS
// ============================================

const BIAS_WEIGHTS = {
  AAS: 0.55,  // Algorithmic Advantage Score
  MS: 0.25,   // Manipulation Score
  CIS: 0.20   // Commercial Influence Score
}

const AAS_WEIGHTS = {
  ctrProxy: 0.26,
  retentionProxy: 0.26,
  personalizationFit: 0.18,
  engagementStrength: 0.12,
  authority: 0.10,
  recencyTrend: 0.08
}

const MS_WEIGHTS = {
  thumbnailAbuse: 0.50,
  titleBait: 0.35,
  titleTranscriptMismatch: 0.15
}

const CIS_WEIGHTS = {
  sponsorDetection: 0.40,
  corporateSignals: 0.35,
  monetizationFriendliness: 0.25
}

const QUALITY_WEIGHTS = {
  relevanceToTopics: 0.35,
  depthSubstance: 0.20,
  constructiveEngagement: 0.15,
  productionQuality: 0.10,
  novelty: 0.10,
  lowManipulation: 0.10
}

// Tag colors for different contribution types
const TAG_COLORS = {
  ctrProxy: '#f97316',           // Orange
  retentionProxy: '#ef4444',     // Red
  personalizationFit: '#3b82f6', // Blue
  engagementStrength: '#8b5cf6', // Purple
  authority: '#06b6d4',          // Cyan
  recencyTrend: '#f59e0b',       // Amber
  thumbnailAbuse: '#dc2626',     // Dark red
  titleBait: '#ea580c',          // Dark orange
  sponsorDetection: '#65a30d',   // Lime
  corporateSignals: '#0891b2',   // Teal
  quality: '#10b981',            // Green
  silenced: '#22c55e'            // Light green
}

// Human-readable labels for tags
const TAG_LABELS = {
  ctrProxy: 'Click Magnet',
  retentionProxy: 'Retention Trap',
  personalizationFit: 'Feed Match',
  engagementStrength: 'Engagement Engine',
  authority: 'Authority Boost',
  recencyTrend: 'Trend Spike',
  thumbnailAbuse: 'Thumb Abuse',
  titleBait: 'Title Bait',
  titleTranscriptMismatch: 'Mismatch',
  sponsorDetection: 'Sponsored',
  corporateSignals: 'Corporate',
  monetizationFriendliness: 'Ad-Friendly'
}

// ============================================
// ALGORITHMIC ADVANTAGE SCORE (AAS)
// ============================================

/**
 * Calculate CTR Proxy score (0-100)
 * Based on thumbnail and title click-magnet signals
 */
function calculateCTRProxy(thumbnailAnalysis, titleAnalysis) {
  const thumbScore = thumbnailAnalysis?.abuseScore || 0
  const titleScore = titleAnalysis?.baitScore || 0
  
  // CTR proxy is a combination of thumbnail appeal and title curiosity
  // Higher manipulation = higher predicted CTR
  const ctrProxy = (thumbScore * 0.6) + (titleScore * 0.4)
  
  return {
    score: Math.round(Math.min(100, ctrProxy)),
    contribution: Math.round(ctrProxy * AAS_WEIGHTS.ctrProxy),
    factors: {
      thumbnailAppeal: thumbScore,
      titleCuriosity: titleScore
    }
  }
}

/**
 * Calculate Retention Proxy score (0-100)
 * Based on duration, pacing, and hook patterns
 */
function calculateRetentionProxy(videoData, transcriptAnalysis) {
  let score = 50 // Base score
  const factors = {}
  
  // Duration sweet spot (8-15 minutes is optimal for YouTube)
  const durationMinutes = (videoData.duration || 0) / 60
  if (durationMinutes >= 8 && durationMinutes <= 15) {
    score += 20
    factors.durationOptimal = true
  } else if (durationMinutes >= 5 && durationMinutes <= 20) {
    score += 10
    factors.durationGood = true
  } else if (durationMinutes < 1) {
    score += 15 // Shorts get boost
    factors.isShort = true
  }
  
  // Transcript-based signals
  if (transcriptAnalysis) {
    // Hook density in first 120 seconds
    if (transcriptAnalysis.hookDensity > 0.5) {
      score += 15
      factors.strongHooks = true
    }
    
    // WPM (fast pace = higher retention typically)
    if (transcriptAnalysis.wpm > 150 && transcriptAnalysis.wpm < 200) {
      score += 10
      factors.optimalPace = true
    }
    
    // Cliffhanger patterns
    if (transcriptAnalysis.cliffhangerCount > 3) {
      score += 10
      factors.cliffhangers = true
    }
  }
  
  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    contribution: Math.round(Math.min(100, score) * AAS_WEIGHTS.retentionProxy),
    factors
  }
}

/**
 * Calculate Personalization Fit score (0-100)
 * How well video matches user's current feed topic profile
 */
function calculatePersonalizationFit(videoData, feedTopicProfile) {
  if (!feedTopicProfile || !feedTopicProfile.topics || feedTopicProfile.topics.length === 0) {
    return { score: 50, contribution: Math.round(50 * AAS_WEIGHTS.personalizationFit), factors: {} }
  }
  
  let score = 0
  const factors = {}
  
  const videoTitle = (videoData.title || '').toLowerCase()
  const videoChannel = (videoData.channelName || '').toLowerCase()
  
  // Check topic match
  for (const topic of feedTopicProfile.topics) {
    const topicKeywords = topic.keywords || [topic.name.toLowerCase()]
    for (const keyword of topicKeywords) {
      if (videoTitle.includes(keyword.toLowerCase())) {
        score += topic.weight * 100
        factors.topicMatch = topic.name
        break
      }
    }
  }
  
  // Check channel loop (repeated channels get boost)
  if (feedTopicProfile.channelLoop && feedTopicProfile.channelLoop.includes(videoChannel)) {
    score += 30
    factors.channelLoop = true
  }
  
  return {
    score: Math.round(Math.min(100, score)),
    contribution: Math.round(Math.min(100, score) * AAS_WEIGHTS.personalizationFit),
    factors
  }
}

/**
 * Calculate Engagement Strength score (0-100)
 * Based on like/view and comment/view ratios
 */
function calculateEngagementStrength(videoData, channelData) {
  let score = 50
  const factors = {}
  
  const views = videoData.views || 1
  const likes = videoData.likes || 0
  const comments = videoData.comments || 0
  const subs = channelData?.subscribers || 1
  
  // Like-to-view ratio (good is > 3%)
  const likeRatio = (likes / views) * 100
  if (likeRatio > 5) {
    score += 25
    factors.excellentLikeRatio = likeRatio.toFixed(2) + '%'
  } else if (likeRatio > 3) {
    score += 15
    factors.goodLikeRatio = likeRatio.toFixed(2) + '%'
  } else if (likeRatio > 1) {
    score += 5
    factors.averageLikeRatio = likeRatio.toFixed(2) + '%'
  }
  
  // Comment-to-view ratio (good is > 0.5%)
  const commentRatio = (comments / views) * 100
  if (commentRatio > 1) {
    score += 20
    factors.highCommentRatio = commentRatio.toFixed(2) + '%'
  } else if (commentRatio > 0.5) {
    score += 10
    factors.goodCommentRatio = commentRatio.toFixed(2) + '%'
  }
  
  // Normalized by channel size (smaller channels with high engagement = stronger signal)
  const viewsPerSub = views / subs
  if (viewsPerSub > 0.5) {
    score += 10
    factors.highReach = true
  }
  
  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    contribution: Math.round(Math.min(100, score) * AAS_WEIGHTS.engagementStrength),
    factors
  }
}

/**
 * Calculate Authority score (0-100)
 * Based on channel size, age, and consistency
 */
function calculateAuthority(channelData) {
  let score = 0
  const factors = {}
  
  const subs = channelData?.subscribers || 0
  const channelAge = channelData?.ageMonths || 0
  const uploadConsistency = channelData?.uploadsPerMonth || 0
  
  // Subscriber count (log scale)
  if (subs >= 10000000) {
    score += 50
    factors.megaChannel = true
  } else if (subs >= 1000000) {
    score += 40
    factors.millionClub = true
  } else if (subs >= 100000) {
    score += 30
    factors.established = true
  } else if (subs >= 10000) {
    score += 20
    factors.growing = true
  } else if (subs >= 1000) {
    score += 10
    factors.small = true
  }
  
  // Channel age
  if (channelAge >= 60) { // 5+ years
    score += 25
    factors.veteran = true
  } else if (channelAge >= 24) { // 2+ years
    score += 15
    factors.experienced = true
  } else if (channelAge >= 12) {
    score += 10
    factors.established = true
  }
  
  // Upload consistency
  if (uploadConsistency >= 4) {
    score += 25
    factors.consistent = true
  } else if (uploadConsistency >= 2) {
    score += 15
    factors.regular = true
  } else if (uploadConsistency >= 1) {
    score += 5
    factors.occasional = true
  }
  
  return {
    score: Math.round(Math.min(100, score)),
    contribution: Math.round(Math.min(100, score) * AAS_WEIGHTS.authority),
    factors
  }
}

/**
 * Calculate Recency/Trend score (0-100)
 * Based on video age, velocity, and topic trending
 */
function calculateRecencyTrend(videoData, feedTopicProfile) {
  let score = 50
  const factors = {}
  
  const ageHours = videoData.ageHours || 0
  const views = videoData.views || 0
  const velocity = ageHours > 0 ? views / ageHours : 0
  
  // Recency boost
  if (ageHours < 24) {
    score += 25
    factors.fresh = true
  } else if (ageHours < 72) {
    score += 15
    factors.recent = true
  } else if (ageHours < 168) { // 1 week
    score += 5
    factors.thisWeek = true
  }
  
  // Velocity (views per hour)
  if (velocity > 10000) {
    score += 25
    factors.viral = true
  } else if (velocity > 1000) {
    score += 15
    factors.trending = true
  } else if (velocity > 100) {
    score += 5
    factors.growing = true
  }
  
  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    contribution: Math.round(Math.min(100, score) * AAS_WEIGHTS.recencyTrend),
    factors
  }
}

/**
 * Calculate full AAS (Algorithmic Advantage Score)
 */
function calculateAAS(videoData, channelData, thumbnailAnalysis, titleAnalysis, transcriptAnalysis, feedTopicProfile) {
  const ctr = calculateCTRProxy(thumbnailAnalysis, titleAnalysis)
  const retention = calculateRetentionProxy(videoData, transcriptAnalysis)
  const personalization = calculatePersonalizationFit(videoData, feedTopicProfile)
  const engagement = calculateEngagementStrength(videoData, channelData)
  const authority = calculateAuthority(channelData)
  const recency = calculateRecencyTrend(videoData, feedTopicProfile)
  
  const totalScore = Math.round(
    ctr.score * AAS_WEIGHTS.ctrProxy +
    retention.score * AAS_WEIGHTS.retentionProxy +
    personalization.score * AAS_WEIGHTS.personalizationFit +
    engagement.score * AAS_WEIGHTS.engagementStrength +
    authority.score * AAS_WEIGHTS.authority +
    recency.score * AAS_WEIGHTS.recencyTrend
  )
  
  return {
    score: totalScore,
    components: {
      ctrProxy: ctr,
      retentionProxy: retention,
      personalizationFit: personalization,
      engagementStrength: engagement,
      authority: authority,
      recencyTrend: recency
    }
  }
}

// ============================================
// MANIPULATION SCORE (MS)
// ============================================

/**
 * Calculate full MS (Manipulation Score)
 */
function calculateMS(thumbnailAnalysis, titleAnalysis, transcriptAnalysis) {
  const thumbAbuse = thumbnailAnalysis?.abuseScore || 0
  const titleBait = titleAnalysis?.baitScore || 0
  
  // Title-transcript mismatch (if transcript available)
  let mismatchScore = 0
  if (transcriptAnalysis && titleAnalysis) {
    mismatchScore = transcriptAnalysis.titleMismatchScore || 0
  }
  
  const totalScore = Math.round(
    thumbAbuse * MS_WEIGHTS.thumbnailAbuse +
    titleBait * MS_WEIGHTS.titleBait +
    mismatchScore * MS_WEIGHTS.titleTranscriptMismatch
  )
  
  return {
    score: totalScore,
    components: {
      thumbnailAbuse: {
        score: thumbAbuse,
        contribution: Math.round(thumbAbuse * MS_WEIGHTS.thumbnailAbuse)
      },
      titleBait: {
        score: titleBait,
        contribution: Math.round(titleBait * MS_WEIGHTS.titleBait)
      },
      titleTranscriptMismatch: {
        score: mismatchScore,
        contribution: Math.round(mismatchScore * MS_WEIGHTS.titleTranscriptMismatch)
      }
    }
  }
}

// ============================================
// COMMERCIAL INFLUENCE SCORE (CIS)
// ============================================

/**
 * Calculate full CIS (Commercial Influence Score)
 */
function calculateCIS(videoData, channelData) {
  let sponsorScore = 0
  let corporateScore = 0
  let monetizationScore = 0
  
  const description = (videoData.description || '').toLowerCase()
  const title = (videoData.title || '').toLowerCase()
  const channelName = (channelData?.name || '').toLowerCase()
  
  // Sponsor detection
  const sponsorPatterns = [
    /sponsored by/i, /thanks to .* for sponsoring/i, /use code/i,
    /affiliate link/i, /#ad\b/i, /paid promotion/i, /partner/i,
    /discount code/i, /promo code/i
  ]
  
  for (const pattern of sponsorPatterns) {
    if (pattern.test(description)) {
      sponsorScore += 20
    }
  }
  sponsorScore = Math.min(100, sponsorScore)
  
  // Corporate signals
  const corporatePatterns = [
    /official/i, /records/i, /studio/i, /entertainment/i,
    /media/i, /network/i, /tv/i, /news/i
  ]
  
  for (const pattern of corporatePatterns) {
    if (pattern.test(channelName)) {
      corporateScore += 25
    }
  }
  
  if (channelData?.verified) {
    corporateScore += 20
  }
  
  if ((channelData?.subscribers || 0) > 5000000) {
    corporateScore += 20
  }
  
  corporateScore = Math.min(100, corporateScore)
  
  // Monetization friendliness (advertiser-safe signals)
  const safePatterns = [
    /review/i, /unboxing/i, /tutorial/i, /how to/i,
    /best .* 202/i, /top 10/i, /comparison/i
  ]
  
  for (const pattern of safePatterns) {
    if (pattern.test(title)) {
      monetizationScore += 15
    }
  }
  monetizationScore = Math.min(100, monetizationScore)
  
  const totalScore = Math.round(
    sponsorScore * CIS_WEIGHTS.sponsorDetection +
    corporateScore * CIS_WEIGHTS.corporateSignals +
    monetizationScore * CIS_WEIGHTS.monetizationFriendliness
  )
  
  return {
    score: totalScore,
    components: {
      sponsorDetection: {
        score: sponsorScore,
        contribution: Math.round(sponsorScore * CIS_WEIGHTS.sponsorDetection)
      },
      corporateSignals: {
        score: corporateScore,
        contribution: Math.round(corporateScore * CIS_WEIGHTS.corporateSignals)
      },
      monetizationFriendliness: {
        score: monetizationScore,
        contribution: Math.round(monetizationScore * CIS_WEIGHTS.monetizationFriendliness)
      }
    }
  }
}

// ============================================
// FINAL BIAS SCORE
// ============================================

/**
 * Calculate final Bias Score (0-100)
 * BiasScore = 0.55*AAS + 0.25*MS + 0.20*CIS
 */
function calculateBiasScore(videoData, channelData, thumbnailAnalysis, titleAnalysis, transcriptAnalysis, feedTopicProfile) {
  const aas = calculateAAS(videoData, channelData, thumbnailAnalysis, titleAnalysis, transcriptAnalysis, feedTopicProfile)
  const ms = calculateMS(thumbnailAnalysis, titleAnalysis, transcriptAnalysis)
  const cis = calculateCIS(videoData, channelData)
  
  const biasScore = Math.round(
    aas.score * BIAS_WEIGHTS.AAS +
    ms.score * BIAS_WEIGHTS.MS +
    cis.score * BIAS_WEIGHTS.CIS
  )
  
  // Calculate confidence based on data availability
  let confidence = 0.25 // Base confidence
  if (videoData.views) confidence += 0.15
  if (channelData?.subscribers) confidence += 0.10
  if (thumbnailAnalysis) confidence += 0.15
  if (titleAnalysis) confidence += 0.10
  if (transcriptAnalysis) confidence += 0.25
  
  return {
    biasScore,
    confidence: Math.min(1, confidence),
    scores: {
      aas: aas.score,
      ms: ms.score,
      cis: cis.score
    },
    breakdown: {
      aas,
      ms,
      cis
    }
  }
}

// ============================================
// QUALITY SCORE (for Silenced tab)
// ============================================

/**
 * Calculate Quality Score for Silenced candidates (0-100)
 */
function calculateQualityScore(videoData, channelData, transcriptAnalysis, feedTopicProfile, thumbnailAnalysis, titleAnalysis) {
  let relevanceScore = 0
  let depthScore = 50
  let engagementScore = 50
  let productionScore = 50
  let noveltyScore = 50
  let lowManipScore = 50
  
  // Relevance to Noise topics
  if (feedTopicProfile && feedTopicProfile.topics) {
    const videoTitle = (videoData.title || '').toLowerCase()
    for (const topic of feedTopicProfile.topics) {
      const keywords = topic.keywords || [topic.name.toLowerCase()]
      for (const kw of keywords) {
        if (videoTitle.includes(kw.toLowerCase())) {
          relevanceScore += topic.weight * 150
        }
      }
    }
  }
  relevanceScore = Math.min(100, relevanceScore)
  
  // Depth and substance (from transcript)
  if (transcriptAnalysis) {
    depthScore = 30
    if (transcriptAnalysis.sourceCitations > 0) {
      depthScore += transcriptAnalysis.sourceCitations * 10
    }
    if (transcriptAnalysis.conceptDensity > 5) {
      depthScore += 20
    }
    if (transcriptAnalysis.structuredExplanations > 3) {
      depthScore += 15
    }
    depthScore = Math.min(100, depthScore)
  }
  
  // Constructive engagement
  const views = videoData.views || 1
  const comments = videoData.comments || 0
  const commentRatio = (comments / views) * 100
  if (commentRatio > 1) {
    engagementScore = 80
  } else if (commentRatio > 0.5) {
    engagementScore = 65
  }
  
  // Low manipulation (inverse of thumbnail/title abuse)
  const thumbAbuse = thumbnailAnalysis?.abuseScore || 50
  const titleBait = titleAnalysis?.baitScore || 50
  lowManipScore = 100 - ((thumbAbuse + titleBait) / 2)
  
  // Novelty (not in channel loop)
  if (feedTopicProfile?.channelLoop) {
    const channelName = (videoData.channelName || '').toLowerCase()
    if (!feedTopicProfile.channelLoop.some(c => c.toLowerCase() === channelName)) {
      noveltyScore = 80
    } else {
      noveltyScore = 20
    }
  }
  
  const totalScore = Math.round(
    relevanceScore * QUALITY_WEIGHTS.relevanceToTopics +
    depthScore * QUALITY_WEIGHTS.depthSubstance +
    engagementScore * QUALITY_WEIGHTS.constructiveEngagement +
    productionScore * QUALITY_WEIGHTS.productionQuality +
    noveltyScore * QUALITY_WEIGHTS.novelty +
    lowManipScore * QUALITY_WEIGHTS.lowManipulation
  )
  
  return {
    score: totalScore,
    components: {
      relevance: relevanceScore,
      depth: depthScore,
      engagement: engagementScore,
      production: productionScore,
      novelty: noveltyScore,
      lowManipulation: lowManipScore
    }
  }
}

/**
 * Calculate Visibility Score (how much distribution advantage video already has)
 */
function calculateVisibilityScore(videoData, channelData, thumbnailAnalysis, titleAnalysis) {
  // Visibility is essentially a simplified version of bias score
  // focusing on authority and packaging advantages
  
  let authorityScore = 0
  const subs = channelData?.subscribers || 0
  
  if (subs >= 1000000) authorityScore = 80
  else if (subs >= 100000) authorityScore = 60
  else if (subs >= 10000) authorityScore = 40
  else authorityScore = 20
  
  const thumbAbuse = thumbnailAnalysis?.abuseScore || 50
  const titleBait = titleAnalysis?.baitScore || 50
  const packagingAdvantage = (thumbAbuse + titleBait) / 2
  
  const views = videoData.views || 0
  const ageHours = videoData.ageHours || 1
  const velocity = views / ageHours
  
  let velocityScore = 0
  if (velocity > 10000) velocityScore = 100
  else if (velocity > 1000) velocityScore = 70
  else if (velocity > 100) velocityScore = 40
  else velocityScore = 20
  
  return Math.round(
    authorityScore * 0.4 +
    packagingAdvantage * 0.3 +
    velocityScore * 0.3
  )
}

/**
 * Calculate Silenced Score
 * SilencedScore = clamp(0, 100, 0.7*Quality + 0.3*(Quality - Visibility + 50))
 */
function calculateSilencedScore(videoData, channelData, transcriptAnalysis, feedTopicProfile, thumbnailAnalysis, titleAnalysis) {
  const quality = calculateQualityScore(videoData, channelData, transcriptAnalysis, feedTopicProfile, thumbnailAnalysis, titleAnalysis)
  const visibility = calculateVisibilityScore(videoData, channelData, thumbnailAnalysis, titleAnalysis)
  
  const exposureGap = quality.score - visibility
  const silencedScore = Math.round(
    Math.max(0, Math.min(100,
      0.7 * quality.score + 0.3 * (quality.score - visibility + 50)
    ))
  )
  
  return {
    silencedScore,
    qualityScore: quality.score,
    visibilityScore: visibility,
    exposureGap,
    qualityBreakdown: quality.components
  }
}

// ============================================
// TAG GENERATION
// ============================================

/**
 * Generate dynamic tags from top contributing factors
 */
function generateDynamicTags(biasResult, maxTags = 4) {
  const contributions = []
  
  // Collect all contributions from AAS
  if (biasResult.breakdown?.aas?.components) {
    for (const [key, data] of Object.entries(biasResult.breakdown.aas.components)) {
      if (data.contribution > 5) {
        contributions.push({
          key,
          label: TAG_LABELS[key] || key,
          value: data.contribution,
          color: TAG_COLORS[key] || '#6b7280'
        })
      }
    }
  }
  
  // Collect from MS
  if (biasResult.breakdown?.ms?.components) {
    for (const [key, data] of Object.entries(biasResult.breakdown.ms.components)) {
      if (data.contribution > 5) {
        contributions.push({
          key,
          label: TAG_LABELS[key] || key,
          value: data.contribution,
          color: TAG_COLORS[key] || '#6b7280'
        })
      }
    }
  }
  
  // Collect from CIS
  if (biasResult.breakdown?.cis?.components) {
    for (const [key, data] of Object.entries(biasResult.breakdown.cis.components)) {
      if (data.contribution > 5) {
        contributions.push({
          key,
          label: TAG_LABELS[key] || key,
          value: data.contribution,
          color: TAG_COLORS[key] || '#6b7280'
        })
      }
    }
  }
  
  // Sort by contribution and take top N
  contributions.sort((a, b) => b.value - a.value)
  
  return contributions.slice(0, maxTags).map(c => ({
    text: `${c.label} +${c.value}`,
    color: c.color,
    key: c.key,
    value: c.value
  }))
}

/**
 * Generate tags for Silenced videos
 */
function generateSilencedTags(silencedResult, maxTags = 3) {
  const tags = []
  
  if (silencedResult.exposureGap > 20) {
    tags.push({
      text: `Exposure Gap +${silencedResult.exposureGap}`,
      color: TAG_COLORS.silenced,
      positive: true
    })
  }
  
  if (silencedResult.qualityBreakdown) {
    if (silencedResult.qualityBreakdown.depth > 70) {
      tags.push({
        text: 'High Depth Content',
        color: TAG_COLORS.quality,
        positive: true
      })
    }
    
    if (silencedResult.qualityBreakdown.novelty > 70) {
      tags.push({
        text: 'New Perspective',
        color: '#06b6d4',
        positive: true
      })
    }
    
    if (silencedResult.qualityBreakdown.lowManipulation > 70) {
      tags.push({
        text: 'Low Clickbait',
        color: TAG_COLORS.quality,
        positive: true
      })
    }
    
    if (silencedResult.qualityBreakdown.engagement > 70) {
      tags.push({
        text: 'Strong Engagement',
        color: '#8b5cf6',
        positive: true
      })
    }
  }
  
  return tags.slice(0, maxTags)
}

// ============================================
// FEED ANALYSIS
// ============================================

/**
 * Analyze entire feed and compute aggregate metrics
 */
function analyzeFeed(videoResults) {
  if (!videoResults || videoResults.length === 0) {
    return null
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
  
  // Manipulation prevalence
  const avgManipulation = videoResults
    .filter(v => v.scores?.ms !== undefined)
    .reduce((sum, v) => sum + v.scores.ms, 0) / videoResults.length || 0
  
  // Commercial prevalence
  const commercialCount = videoResults.filter(v => (v.scores?.cis || 0) > 50).length
  const commercialPrevalence = commercialCount / videoResults.length
  
  return {
    avgBias,
    distribution: {
      high: Math.round(high * 100),
      medium: Math.round(medium * 100),
      low: Math.round(low * 100)
    },
    channelConcentration: {
      top5Share: Math.round(top5Share * 100),
      topChannels: sortedChannels.map(([name, count]) => ({
        name,
        count,
        percentage: Math.round((count / videoResults.length) * 100)
      }))
    },
    manipulationPrevalence: Math.round(avgManipulation),
    commercialPrevalence: Math.round(commercialPrevalence * 100)
  }
}

// ============================================
// EXPORTS
// ============================================

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateBiasScore,
    calculateAAS,
    calculateMS,
    calculateCIS,
    calculateQualityScore,
    calculateSilencedScore,
    generateDynamicTags,
    generateSilencedTags,
    analyzeFeed,
    BIAS_WEIGHTS,
    AAS_WEIGHTS,
    MS_WEIGHTS,
    CIS_WEIGHTS,
    TAG_COLORS,
    TAG_LABELS
  }
}

// Export for browser
if (typeof window !== 'undefined') {
  window.ScoringEngine = {
    calculateBiasScore,
    calculateAAS,
    calculateMS,
    calculateCIS,
    calculateQualityScore,
    calculateSilencedScore,
    generateDynamicTags,
    generateSilencedTags,
    analyzeFeed,
    BIAS_WEIGHTS,
    AAS_WEIGHTS,
    MS_WEIGHTS,
    CIS_WEIGHTS,
    TAG_COLORS,
    TAG_LABELS
  }
}

})(); // End IIFE
