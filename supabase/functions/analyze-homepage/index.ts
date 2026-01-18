/**
 * Analyze Homepage Edge Function
 * 
 * Batch analyzes videos from YouTube homepage for bias scoring.
 * Returns bias scores, contributions, and feed-level analysis.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SCHEMA_VERSION = '4.0.0'
const FUNCTION_VERSION = 'v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Bias score weights
const BIAS_WEIGHTS = {
  AAS: 0.55,  // Algorithmic Advantage Score
  MS: 0.25,   // Manipulation Score
  CIS: 0.20   // Commercial Influence Score
}

// Tag colors
const TAG_COLORS: Record<string, string> = {
  ctrProxy: '#f97316',
  retentionProxy: '#ef4444',
  personalizationFit: '#3b82f6',
  engagementStrength: '#8b5cf6',
  authority: '#06b6d4',
  recencyTrend: '#f59e0b',
  thumbnailAbuse: '#dc2626',
  titleBait: '#ea580c',
  sponsorDetection: '#65a30d',
  corporateSignals: '#0891b2'
}

// Tag labels
const TAG_LABELS: Record<string, string> = {
  ctrProxy: 'Click Magnet',
  retentionProxy: 'Retention Trap',
  personalizationFit: 'Feed Match',
  engagementStrength: 'Engagement Engine',
  authority: 'Authority Boost',
  recencyTrend: 'Trend Spike',
  thumbnailAbuse: 'Thumb Abuse',
  titleBait: 'Title Bait',
  sponsorDetection: 'Sponsored',
  corporateSignals: 'Corporate'
}

interface VideoInput {
  videoId: string
  title?: string
  channelName?: string
  channelId?: string
  views?: number
  likes?: number
  comments?: number
  duration?: number
  publishedAt?: string
  thumbnailUrl?: string
  subscriberCount?: number
}

interface FeedContext {
  topicProfile?: {
    topics: Array<{ name: string; weight: number; keywords?: string[] }>
    channelLoop?: string[]
  }
}

interface AnalysisResult {
  videoId: string
  biasScore: number
  confidence: number
  scores: {
    aas: number
    ms: number
    cis: number
  }
  contributions: Array<{
    factor: string
    value: number
    color: string
  }>
  tags: Array<{
    text: string
    color: string
    key: string
    value: number
  }>
  metrics: {
    views: number
    subs: number
    age: string
    velocity: string
    thumbAbuse: number
    sponsorDetected: boolean
  }
}

/**
 * Calculate Algorithmic Advantage Score
 */
function calculateAAS(video: VideoInput, feedContext: FeedContext): { score: number; breakdown: Record<string, number> } {
  const subs = video.subscriberCount || 0
  const views = video.views || 0
  const likes = video.likes || 0
  const comments = video.comments || 0
  
  // Authority score (based on subscriber count)
  let authorityScore = 0
  if (subs >= 10000000) authorityScore = 100
  else if (subs >= 1000000) authorityScore = 80
  else if (subs >= 100000) authorityScore = 60
  else if (subs >= 10000) authorityScore = 40
  else authorityScore = 20
  
  // Engagement score
  const engagementRatio = views > 0 ? ((likes + comments) / views) * 100 : 0
  let engagementScore = Math.min(100, engagementRatio * 10)
  
  // Recency score
  let recencyScore = 50
  if (video.publishedAt) {
    const ageHours = (Date.now() - new Date(video.publishedAt).getTime()) / (1000 * 60 * 60)
    if (ageHours < 24) recencyScore = 100
    else if (ageHours < 72) recencyScore = 80
    else if (ageHours < 168) recencyScore = 60
    else recencyScore = 40
  }
  
  // Velocity score
  const ageHours = video.publishedAt 
    ? (Date.now() - new Date(video.publishedAt).getTime()) / (1000 * 60 * 60)
    : 24
  const viewsPerHour = views / Math.max(1, ageHours)
  let velocityScore = 0
  if (viewsPerHour >= 10000) velocityScore = 100
  else if (viewsPerHour >= 1000) velocityScore = 70
  else if (viewsPerHour >= 100) velocityScore = 40
  else velocityScore = 20
  
  // Personalization fit (if topic profile available)
  let personalizationScore = 50
  if (feedContext.topicProfile?.channelLoop?.includes(video.channelName || '')) {
    personalizationScore = 80
  }
  
  // Calculate total
  const totalScore = Math.round(
    authorityScore * 0.30 +
    engagementScore * 0.15 +
    recencyScore * 0.20 +
    velocityScore * 0.20 +
    personalizationScore * 0.15
  )
  
  return {
    score: totalScore,
    breakdown: {
      authority: authorityScore,
      engagement: engagementScore,
      recency: recencyScore,
      velocity: velocityScore,
      personalization: personalizationScore
    }
  }
}

/**
 * Calculate Manipulation Score (simplified without thumbnail/title analysis)
 */
function calculateMS(video: VideoInput): { score: number; breakdown: Record<string, number> } {
  // Without actual thumbnail/title analysis, use heuristics
  const title = video.title || ''
  
  // Title bait detection
  let titleBaitScore = 0
  const baitPatterns = [
    /you won't believe/i,
    /shocking/i,
    /exposed/i,
    /insane/i,
    /must see/i,
    /[!?]{2,}/
  ]
  
  for (const pattern of baitPatterns) {
    if (pattern.test(title)) {
      titleBaitScore += 15
    }
  }
  titleBaitScore = Math.min(100, titleBaitScore)
  
  // Caps ratio
  const letters = title.replace(/[^a-zA-Z]/g, '')
  const upperCase = title.replace(/[^A-Z]/g, '').length
  const capsRatio = letters.length > 0 ? upperCase / letters.length : 0
  const capsScore = capsRatio > 0.3 ? 50 : capsRatio > 0.1 ? 25 : 0
  
  const totalScore = Math.round(
    titleBaitScore * 0.60 +
    capsScore * 0.40
  )
  
  return {
    score: totalScore,
    breakdown: {
      titleBait: titleBaitScore,
      caps: capsScore
    }
  }
}

/**
 * Calculate Commercial Influence Score
 */
function calculateCIS(video: VideoInput): { score: number; breakdown: Record<string, number> } {
  const title = (video.title || '').toLowerCase()
  const subs = video.subscriberCount || 0
  
  // Corporate signals
  let corporateScore = 0
  if (subs >= 5000000) corporateScore += 40
  if (subs >= 1000000) corporateScore += 20
  
  // Sponsor detection (simplified)
  let sponsorScore = 0
  const sponsorPatterns = [
    /sponsored/i,
    /\bad\b/i,
    /partnership/i,
    /promo/i
  ]
  
  for (const pattern of sponsorPatterns) {
    if (pattern.test(title)) {
      sponsorScore += 25
    }
  }
  sponsorScore = Math.min(100, sponsorScore)
  
  const totalScore = Math.round(
    corporateScore * 0.50 +
    sponsorScore * 0.50
  )
  
  return {
    score: totalScore,
    breakdown: {
      corporate: corporateScore,
      sponsor: sponsorScore
    }
  }
}

/**
 * Analyze a single video
 */
function analyzeVideo(video: VideoInput, feedContext: FeedContext): AnalysisResult {
  const aas = calculateAAS(video, feedContext)
  const ms = calculateMS(video)
  const cis = calculateCIS(video)
  
  // Calculate final bias score
  const biasScore = Math.round(
    aas.score * BIAS_WEIGHTS.AAS +
    ms.score * BIAS_WEIGHTS.MS +
    cis.score * BIAS_WEIGHTS.CIS
  )
  
  // Generate contributions
  const contributions: Array<{ factor: string; value: number; color: string }> = []
  
  if (aas.breakdown.authority > 50) {
    contributions.push({
      factor: 'Authority Boost',
      value: Math.round(aas.breakdown.authority * 0.30),
      color: TAG_COLORS.authority
    })
  }
  
  if (aas.breakdown.velocity > 50) {
    contributions.push({
      factor: 'Trend Spike',
      value: Math.round(aas.breakdown.velocity * 0.20),
      color: TAG_COLORS.recencyTrend
    })
  }
  
  if (aas.breakdown.personalization > 60) {
    contributions.push({
      factor: 'Feed Match',
      value: Math.round(aas.breakdown.personalization * 0.15),
      color: TAG_COLORS.personalizationFit
    })
  }
  
  if (ms.breakdown.titleBait > 30) {
    contributions.push({
      factor: 'Title Bait',
      value: Math.round(ms.breakdown.titleBait * 0.25),
      color: TAG_COLORS.titleBait
    })
  }
  
  if (cis.breakdown.corporate > 30) {
    contributions.push({
      factor: 'Corporate',
      value: Math.round(cis.breakdown.corporate * 0.20),
      color: TAG_COLORS.corporateSignals
    })
  }
  
  // Sort by value
  contributions.sort((a, b) => b.value - a.value)
  
  // Generate tags
  const tags = contributions.slice(0, 4).map(c => ({
    text: `${c.factor} +${c.value}`,
    color: c.color,
    key: c.factor.toLowerCase().replace(/\s+/g, '_'),
    value: c.value
  }))
  
  // Get video age
  let age = '--'
  if (video.publishedAt) {
    const ageHours = (Date.now() - new Date(video.publishedAt).getTime()) / (1000 * 60 * 60)
    if (ageHours < 24) age = `${Math.round(ageHours)}h`
    else if (ageHours < 168) age = `${Math.round(ageHours / 24)}d`
    else age = `${Math.round(ageHours / 168)}w`
  }
  
  // Determine velocity
  const ageHours = video.publishedAt 
    ? (Date.now() - new Date(video.publishedAt).getTime()) / (1000 * 60 * 60)
    : 24
  const viewsPerHour = (video.views || 0) / Math.max(1, ageHours)
  const velocity = viewsPerHour >= 10000 ? 'high' : viewsPerHour >= 1000 ? 'medium' : 'low'
  
  return {
    videoId: video.videoId,
    biasScore,
    confidence: 0.7,
    scores: {
      aas: aas.score,
      ms: ms.score,
      cis: cis.score
    },
    contributions,
    tags,
    metrics: {
      views: video.views || 0,
      subs: video.subscriberCount || 0,
      age,
      velocity,
      thumbAbuse: 0, // Would need thumbnail analysis
      sponsorDetected: cis.breakdown.sponsor > 0
    }
  }
}

/**
 * Calculate feed-level analysis
 */
function calculateFeedAnalysis(results: AnalysisResult[], feedContext: FeedContext) {
  if (results.length === 0) {
    return {
      avgBias: 0,
      distribution: { high: 0, medium: 0, low: 0 },
      topicDominance: [],
      channelConcentration: { top5Share: 0, topChannels: [] },
      manipulationPrevalence: 0,
      commercialPrevalence: 0
    }
  }
  
  const biasScores = results.map(r => r.biasScore)
  const avgBias = Math.round(biasScores.reduce((a, b) => a + b, 0) / biasScores.length)
  
  // Distribution
  const high = biasScores.filter(s => s >= 70).length / biasScores.length
  const medium = biasScores.filter(s => s >= 40 && s < 70).length / biasScores.length
  const low = biasScores.filter(s => s < 40).length / biasScores.length
  
  // Manipulation prevalence
  const avgMS = results.reduce((sum, r) => sum + r.scores.ms, 0) / results.length
  
  // Commercial prevalence
  const commercialCount = results.filter(r => r.scores.cis > 30).length
  
  return {
    avgBias,
    distribution: {
      high: Math.round(high * 100),
      medium: Math.round(medium * 100),
      low: Math.round(low * 100)
    },
    topicDominance: feedContext.topicProfile?.topics || [],
    channelConcentration: {
      top5Share: 0, // Would need channel data
      topChannels: []
    },
    manipulationPrevalence: Math.round(avgMS),
    commercialPrevalence: Math.round((commercialCount / results.length) * 100)
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  
  // Health check
  if (req.method === 'GET') {
    return new Response(JSON.stringify({
      status: 'healthy',
      version: FUNCTION_VERSION,
      schema: SCHEMA_VERSION
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    const { videos, feedContext = {} } = await req.json()
    
    if (!videos || !Array.isArray(videos)) {
      return new Response(JSON.stringify({
        error: 'Invalid request: videos array required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Analyze each video
    const results = videos.map((video: VideoInput) => analyzeVideo(video, feedContext))
    
    // Calculate feed analysis
    const feedAnalysis = calculateFeedAnalysis(results, feedContext)
    
    return new Response(JSON.stringify({
      videos: results,
      feedAnalysis,
      _schemaVersion: SCHEMA_VERSION,
      _functionVersion: FUNCTION_VERSION
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('[analyze-homepage] Error:', error)
    
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
