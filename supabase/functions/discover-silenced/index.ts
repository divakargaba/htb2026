/**
 * Discover Silenced Edge Function
 * 
 * Discovers high-quality videos that are under-exposed relative to their quality.
 * Uses topic matching and quality scoring to find hidden gems.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SCHEMA_VERSION = '4.0.0'
const FUNCTION_VERSION = 'v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Topic {
  name: string
  weight: number
  keywords?: string[]
}

interface DiscoverRequest {
  topicMap: Topic[]
  excludedChannels?: string[]
  filters?: {
    minViews?: number
    minSubs?: number
    maxSubs?: number
    requireTranscript?: boolean
  }
}

interface SilencedVideo {
  videoId: string
  title: string
  channel: string
  thumbnail: string
  qualityScore: number
  silencedScore: number
  exposureGap: number
  whyGood: string[]
  whyBuried: string[]
  views: number
  publishedAt: string
  duration: number
}

/**
 * Calculate quality score for a video
 */
function calculateQualityScore(video: any, topics: Topic[]): number {
  let score = 50 // Base score
  
  const title = (video.title || '').toLowerCase()
  
  // Topic relevance
  for (const topic of topics) {
    const keywords = topic.keywords || [topic.name.toLowerCase()]
    for (const keyword of keywords) {
      if (title.includes(keyword.toLowerCase())) {
        score += topic.weight * 30
        break
      }
    }
  }
  
  // Quality signals in title
  const qualitySignals = [
    /\b(documentary|explained|analysis|review|tutorial|guide)\b/i,
    /\b(deep dive|in-depth|comprehensive)\b/i,
    /\b(expert|professional|scientist|researcher)\b/i
  ]
  
  for (const pattern of qualitySignals) {
    if (pattern.test(title)) {
      score += 10
    }
  }
  
  // Negative signals
  const negativeSignals = [
    /\b(prank|challenge|reaction|drama)\b/i,
    /[!?]{3,}/,
    /\b(shocking|insane|crazy)\b/i
  ]
  
  for (const pattern of negativeSignals) {
    if (pattern.test(title)) {
      score -= 10
    }
  }
  
  // Engagement ratio (if available)
  if (video.likes && video.views && video.views > 0) {
    const likeRatio = (video.likes / video.views) * 100
    if (likeRatio > 5) score += 15
    else if (likeRatio > 3) score += 10
  }
  
  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * Calculate visibility/exposure score
 */
function calculateVisibilityScore(video: any): number {
  const subs = video.subscriberCount || 0
  const views = video.views || 0
  
  // Subscriber-based visibility
  let subScore = 0
  if (subs >= 1000000) subScore = 90
  else if (subs >= 500000) subScore = 75
  else if (subs >= 100000) subScore = 60
  else if (subs >= 50000) subScore = 45
  else if (subs >= 10000) subScore = 30
  else subScore = 15
  
  // View velocity
  const ageHours = video.publishedAt 
    ? (Date.now() - new Date(video.publishedAt).getTime()) / (1000 * 60 * 60)
    : 168
  const viewsPerHour = views / Math.max(1, ageHours)
  
  let velocityScore = 0
  if (viewsPerHour >= 10000) velocityScore = 100
  else if (viewsPerHour >= 1000) velocityScore = 70
  else if (viewsPerHour >= 100) velocityScore = 40
  else velocityScore = 20
  
  return Math.round(subScore * 0.6 + velocityScore * 0.4)
}

/**
 * Generate "why good" reasons
 */
function generateWhyGood(video: any, qualityScore: number, topics: Topic[]): string[] {
  const reasons: string[] = []
  const title = (video.title || '').toLowerCase()
  
  // Topic match
  for (const topic of topics) {
    if (title.includes(topic.name.toLowerCase())) {
      reasons.push(`Relevant to your interest in ${topic.name}`)
      break
    }
  }
  
  // Quality signals
  if (/\b(explained|analysis|review)\b/i.test(title)) {
    reasons.push('In-depth content format')
  }
  
  if (/\b(tutorial|guide|how to)\b/i.test(title)) {
    reasons.push('Educational/instructional content')
  }
  
  // Engagement
  if (video.likes && video.views && (video.likes / video.views) > 0.04) {
    reasons.push('Strong engagement ratio')
  }
  
  // Small channel quality
  if ((video.subscriberCount || 0) < 50000) {
    reasons.push('Independent creator perspective')
  }
  
  if (reasons.length === 0) {
    reasons.push('High quality score relative to exposure')
  }
  
  return reasons.slice(0, 3)
}

/**
 * Generate "why buried" reasons
 */
function generateWhyBuried(video: any, visibilityScore: number): string[] {
  const reasons: string[] = []
  const subs = video.subscriberCount || 0
  
  if (subs < 10000) {
    reasons.push('Very small channel size limits algorithmic reach')
  } else if (subs < 50000) {
    reasons.push('Small channel size reduces recommendation priority')
  } else if (subs < 100000) {
    reasons.push('Mid-sized channel competes with larger creators')
  }
  
  // Low velocity
  const ageHours = video.publishedAt 
    ? (Date.now() - new Date(video.publishedAt).getTime()) / (1000 * 60 * 60)
    : 168
  const viewsPerHour = (video.views || 0) / Math.max(1, ageHours)
  
  if (viewsPerHour < 100) {
    reasons.push('Lower view velocity than trending content')
  }
  
  // No clickbait
  const title = video.title || ''
  if (!/[!?]{2,}/.test(title) && !/\b(shocking|insane|crazy)\b/i.test(title)) {
    reasons.push('Non-clickbait title may reduce CTR')
  }
  
  if (reasons.length === 0) {
    reasons.push('Limited algorithmic amplification')
  }
  
  return reasons.slice(0, 2)
}

/**
 * Mock video discovery (in production, would use YouTube API or database)
 */
function discoverVideos(topics: Topic[], excludedChannels: string[], filters: any): any[] {
  // In a real implementation, this would:
  // 1. Search YouTube API for videos matching topics
  // 2. Filter by subscriber count
  // 3. Score for quality
  // 4. Return top results
  
  // For now, return mock data based on topics
  const mockVideos = [
    {
      videoId: 'mock1',
      title: `Understanding ${topics[0]?.name || 'Technology'} - A Deep Dive`,
      channelTitle: 'Independent Educator',
      thumbnail: 'https://i.ytimg.com/vi/mock1/mqdefault.jpg',
      views: 45000,
      likes: 2800,
      subscriberCount: 28000,
      publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      duration: 1200
    },
    {
      videoId: 'mock2',
      title: `${topics[0]?.name || 'Topic'} Explained Simply`,
      channelTitle: 'Small Creator Studio',
      thumbnail: 'https://i.ytimg.com/vi/mock2/mqdefault.jpg',
      views: 12000,
      likes: 950,
      subscriberCount: 8500,
      publishedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      duration: 900
    },
    {
      videoId: 'mock3',
      title: `Complete Guide to ${topics[1]?.name || topics[0]?.name || 'Learning'}`,
      channelTitle: 'Rising Expert',
      thumbnail: 'https://i.ytimg.com/vi/mock3/mqdefault.jpg',
      views: 78000,
      likes: 5200,
      subscriberCount: 42000,
      publishedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
      duration: 1800
    }
  ]
  
  // Filter by excluded channels
  return mockVideos.filter(v => !excludedChannels.includes(v.channelTitle))
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
    const { topicMap = [], excludedChannels = [], filters = {} }: DiscoverRequest = await req.json()
    
    if (!topicMap || topicMap.length === 0) {
      return new Response(JSON.stringify({
        videos: [],
        message: 'No topics provided'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Discover candidate videos
    const candidates = discoverVideos(topicMap, excludedChannels, filters)
    
    // Score and rank videos
    const scoredVideos: SilencedVideo[] = candidates.map(video => {
      const qualityScore = calculateQualityScore(video, topicMap)
      const visibilityScore = calculateVisibilityScore(video)
      const exposureGap = qualityScore - visibilityScore
      
      // Silenced score: high quality + low visibility = more silenced
      const silencedScore = Math.round(
        qualityScore * 0.5 + 
        Math.max(0, exposureGap + 50) * 0.5
      )
      
      return {
        videoId: video.videoId,
        title: video.title,
        channel: video.channelTitle,
        thumbnail: video.thumbnail,
        qualityScore,
        silencedScore,
        exposureGap,
        whyGood: generateWhyGood(video, qualityScore, topicMap),
        whyBuried: generateWhyBuried(video, visibilityScore),
        views: video.views,
        publishedAt: video.publishedAt,
        duration: video.duration
      }
    })
    
    // Sort by silenced score (most silenced first)
    scoredVideos.sort((a, b) => b.silencedScore - a.silencedScore)
    
    return new Response(JSON.stringify({
      videos: scoredVideos.slice(0, 12),
      _schemaVersion: SCHEMA_VERSION,
      _functionVersion: FUNCTION_VERSION
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('[discover-silenced] Error:', error)
    
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
