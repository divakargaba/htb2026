// Silenced by the Algorithm - Edge Function v2
// Analyzes current video + finds silenced alternatives
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// API Keys - Use environment variables in production
const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

// ============== TYPES ==============

interface VideoData {
  videoId: string
  title: string
  description: string
  channelTitle: string
  channelId: string
  publishedAt: string
  viewCount: number
  likeCount: number
  subscriberCount: number
  duration: string
  thumbnail: string
  tags?: string[]
}

interface VideoAnalysis {
  bias_score: number
  bias_type: 'algorithm_favored' | 'quality_content' | 'neutral'
  bias_reasons: string[]
  is_sustainability: boolean
  sustainability_score: number
  esg_category: string | null
  greenwashing_risk: 'low' | 'medium' | 'high' | null
  greenwashing_flags: string[]
  creator_type: 'micro' | 'small' | 'medium' | 'large'
  is_educational: boolean
  sensational_score: number
  topic: string
  summary: string
}

interface AlternativeVideo {
  video_id: string
  title: string
  channel: string
  thumbnail: string
  view_count: number
  subscriber_count: number
  silence_score: number
  why_silenced: string
  is_educational: boolean
}

// ============== YOUTUBE API ==============

async function getVideoById(videoId: string): Promise<VideoData | null> {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos')
  url.searchParams.set('part', 'snippet,statistics,contentDetails')
  url.searchParams.set('id', videoId)
  url.searchParams.set('key', YOUTUBE_API_KEY)
  
  try {
    const response = await fetch(url.toString())
    const data = await response.json()
    
    if (!data.items || data.items.length === 0) return null
    
    const item = data.items[0]
    const channelSubs = await getChannelSubscribers(item.snippet.channelId)
    
    return {
      videoId: item.id,
      title: item.snippet.title,
      description: item.snippet.description || '',
      channelTitle: item.snippet.channelTitle,
      channelId: item.snippet.channelId,
      publishedAt: item.snippet.publishedAt,
      viewCount: parseInt(item.statistics?.viewCount || '0'),
      likeCount: parseInt(item.statistics?.likeCount || '0'),
      subscriberCount: channelSubs,
      duration: item.contentDetails?.duration || 'PT0S',
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      tags: item.snippet.tags || []
    }
  } catch (error) {
    console.error('Error fetching video:', error)
    return null
  }
}

async function getChannelSubscribers(channelId: string): Promise<number> {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels')
  url.searchParams.set('part', 'statistics')
  url.searchParams.set('id', channelId)
  url.searchParams.set('key', YOUTUBE_API_KEY)
  
  try {
    const response = await fetch(url.toString())
    const data = await response.json()
    return parseInt(data.items?.[0]?.statistics?.subscriberCount || '0')
  } catch {
    return 0
  }
}

async function searchAlternatives(topic: string, excludeChannelId: string): Promise<VideoData[]> {
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', topic)
  url.searchParams.set('type', 'video')
  url.searchParams.set('maxResults', '15')
  url.searchParams.set('order', 'relevance')
  url.searchParams.set('publishedAfter', twoYearsAgo.toISOString())
  url.searchParams.set('relevanceLanguage', 'en')
  url.searchParams.set('key', YOUTUBE_API_KEY)
  
  try {
    const response = await fetch(url.toString())
    const data = await response.json()
    
    if (!data.items) return []
    
    const videoIds = data.items
      .filter((item: any) => item.snippet.channelId !== excludeChannelId)
      .map((item: any) => item.id.videoId)
      .slice(0, 10)
    
    if (videoIds.length === 0) return []
    
    const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
    detailsUrl.searchParams.set('part', 'snippet,statistics,contentDetails')
    detailsUrl.searchParams.set('id', videoIds.join(','))
    detailsUrl.searchParams.set('key', YOUTUBE_API_KEY)
    
    const detailsResponse = await fetch(detailsUrl.toString())
    const detailsData = await detailsResponse.json()
    
    if (!detailsData.items) return []
    
    const channelIds = [...new Set(detailsData.items.map((i: any) => i.snippet.channelId))]
    const channelSubs = await getMultipleChannelSubscribers(channelIds as string[])
    
    return detailsData.items.map((item: any) => ({
      videoId: item.id,
      title: item.snippet.title,
      description: item.snippet.description || '',
      channelTitle: item.snippet.channelTitle,
      channelId: item.snippet.channelId,
      publishedAt: item.snippet.publishedAt,
      viewCount: parseInt(item.statistics?.viewCount || '0'),
      likeCount: parseInt(item.statistics?.likeCount || '0'),
      subscriberCount: channelSubs.get(item.snippet.channelId) || 0,
      duration: item.contentDetails?.duration || 'PT0S',
      thumbnail: item.snippet.thumbnails?.medium?.url || '',
      tags: item.snippet.tags || []
    }))
  } catch (error) {
    console.error('Error searching alternatives:', error)
    return []
  }
}

async function getMultipleChannelSubscribers(channelIds: string[]): Promise<Map<string, number>> {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels')
  url.searchParams.set('part', 'statistics')
  url.searchParams.set('id', channelIds.join(','))
  url.searchParams.set('key', YOUTUBE_API_KEY)
  
  const subs = new Map<string, number>()
  try {
    const response = await fetch(url.toString())
    const data = await response.json()
    data.items?.forEach((item: any) => {
      subs.set(item.id, parseInt(item.statistics?.subscriberCount || '0'))
    })
  } catch {}
  return subs
}

// ============== GEMINI ANALYSIS ==============

const ANALYSIS_PROMPT = `Analyze this YouTube video for algorithmic bias and sustainability relevance.

Video:
- Title: {{TITLE}}
- Channel: {{CHANNEL}} ({{SUBSCRIBERS}} subscribers)
- Description: {{DESCRIPTION}}
- Views: {{VIEWS}}
- Likes: {{LIKES}}
- Duration: {{DURATION}}
- Tags: {{TAGS}}

Analyze and respond with ONLY this JSON (no markdown):
{
  "topic": "<2-4 word topic for finding alternatives>",
  "is_sustainability": <true if about climate/environment/ESG/sustainability>,
  "sustainability_score": <0.0-1.0 if sustainability related, else 0>,
  "esg_category": "<environmental|social|governance|null>",
  "greenwashing_risk": "<low|medium|high|null>",
  "greenwashing_flags": ["<flag if any>"],
  "is_educational": <true|false>,
  "sensational_score": <0.0-1.0>,
  "credibility_signals": ["<signal>"],
  "creator_assessment": "<why this creator might be favored or not>",
  "content_quality": "<brief assessment>"
}

Greenwashing flags to check: vague claims, no data/sources, corporate PR speak, offsetting focus, future promises without action, cherry-picked stats`

async function analyzeWithGemini(video: VideoData): Promise<any> {
  const prompt = ANALYSIS_PROMPT
    .replace('{{TITLE}}', video.title)
    .replace('{{CHANNEL}}', video.channelTitle)
    .replace('{{SUBSCRIBERS}}', video.subscriberCount.toLocaleString())
    .replace('{{DESCRIPTION}}', video.description.substring(0, 500))
    .replace('{{VIEWS}}', video.viewCount.toLocaleString())
    .replace('{{LIKES}}', video.likeCount.toLocaleString())
    .replace('{{DURATION}}', video.duration)
    .replace('{{TAGS}}', (video.tags || []).slice(0, 10).join(', '))
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
      })
    })
    
    const data = await response.json()
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(text)
  } catch (error) {
    console.error('Gemini error:', error)
    return null
  }
}

// ============== SCORING ==============

function getCreatorType(subs: number): 'micro' | 'small' | 'medium' | 'large' {
  if (subs < 10000) return 'micro'
  if (subs < 100000) return 'small'
  if (subs < 1000000) return 'medium'
  return 'large'
}

function calculateBiasScore(video: VideoData, analysis: any): { score: number, type: 'algorithm_favored' | 'quality_content' | 'neutral', reasons: string[] } {
  const reasons: string[] = []
  let biasPoints = 50
  
  const creatorType = getCreatorType(video.subscriberCount)
  
  if (creatorType === 'large') {
    biasPoints += 20
    reasons.push('Large creator (1M+ subs) - algorithm typically favors')
  } else if (creatorType === 'medium') {
    biasPoints += 10
    reasons.push('Medium creator - some algorithmic advantage')
  } else if (creatorType === 'micro') {
    biasPoints -= 15
    reasons.push('Micro creator - often suppressed by algorithm')
  } else if (creatorType === 'small') {
    biasPoints -= 10
    reasons.push('Small creator - limited algorithmic reach')
  }
  
  if (analysis?.sensational_score > 0.6) {
    biasPoints += 15
    reasons.push('Sensationalized title/content - engagement bait')
  } else if (analysis?.sensational_score < 0.3) {
    biasPoints -= 10
    reasons.push('Non-sensational - may get less algorithmic push')
  }
  
  if (analysis?.is_educational) {
    biasPoints -= 10
    reasons.push('Educational content - often under-promoted')
  }
  
  const ageDays = Math.max(1, Math.floor((Date.now() - new Date(video.publishedAt).getTime()) / 86400000))
  const viewsPerDay = video.viewCount / ageDays
  if (viewsPerDay > 50000) {
    biasPoints += 15
    reasons.push('Viral velocity - heavily algorithm-boosted')
  } else if (viewsPerDay < 100 && creatorType !== 'micro') {
    biasPoints -= 10
    reasons.push('Low visibility despite channel size')
  }
  
  const score = Math.max(0, Math.min(100, biasPoints))
  const type = score > 60 ? 'algorithm_favored' : score < 40 ? 'quality_content' : 'neutral'
  
  return { score, type, reasons }
}

function calculateSilenceScore(video: VideoData, analysis: any): number {
  let score = 0
  
  const creatorType = getCreatorType(video.subscriberCount)
  if (creatorType === 'micro') score += 0.3
  else if (creatorType === 'small') score += 0.2
  
  if (analysis?.is_educational) score += 0.25
  if (analysis?.sensational_score < 0.3) score += 0.15
  
  const ageDays = Math.max(1, Math.floor((Date.now() - new Date(video.publishedAt).getTime()) / 86400000))
  const viewsPerDay = video.viewCount / ageDays
  if (viewsPerDay < 500) score += 0.2
  
  const likeRatio = video.viewCount > 0 ? video.likeCount / video.viewCount : 0
  if (likeRatio > 0.04) score += 0.1
  
  return Math.min(1, score)
}

// ============== MAIN HANDLER ==============

serve(async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  
  try {
    const { video_id } = await req.json()
    
    if (!video_id) {
      return new Response(JSON.stringify({ error: 'video_id required' }), { status: 400, headers })
    }
    
    console.log(`Analyzing video: ${video_id}`)
    
    const video = await getVideoById(video_id)
    if (!video) {
      return new Response(JSON.stringify({ error: 'Video not found' }), { status: 404, headers })
    }
    
    const geminiAnalysis = await analyzeWithGemini(video)
    const bias = calculateBiasScore(video, geminiAnalysis)
    
    const currentVideoAnalysis: VideoAnalysis = {
      bias_score: bias.score,
      bias_type: bias.type,
      bias_reasons: bias.reasons,
      is_sustainability: geminiAnalysis?.is_sustainability || false,
      sustainability_score: geminiAnalysis?.sustainability_score || 0,
      esg_category: geminiAnalysis?.esg_category || null,
      greenwashing_risk: geminiAnalysis?.greenwashing_risk || null,
      greenwashing_flags: geminiAnalysis?.greenwashing_flags || [],
      creator_type: getCreatorType(video.subscriberCount),
      is_educational: geminiAnalysis?.is_educational || false,
      sensational_score: geminiAnalysis?.sensational_score || 0.5,
      topic: geminiAnalysis?.topic || video.title.split(' ').slice(0, 4).join(' '),
      summary: geminiAnalysis?.content_quality || 'Analysis complete'
    }
    
    const topic = geminiAnalysis?.topic || video.title
    const alternativeVideos = await searchAlternatives(topic, video.channelId)
    
    const silencedAlternatives: AlternativeVideo[] = []
    
    for (const alt of alternativeVideos.slice(0, 8)) {
      const altAnalysis = await analyzeWithGemini(alt)
      const silenceScore = calculateSilenceScore(alt, altAnalysis)
      
      if (silenceScore > 0.3) {
        const creatorType = getCreatorType(alt.subscriberCount)
        const reasons: string[] = []
        if (creatorType === 'micro' || creatorType === 'small') reasons.push(`${creatorType} creator`)
        if (altAnalysis?.is_educational) reasons.push('educational')
        
        silencedAlternatives.push({
          video_id: alt.videoId,
          title: alt.title,
          channel: alt.channelTitle,
          thumbnail: alt.thumbnail,
          view_count: alt.viewCount,
          subscriber_count: alt.subscriberCount,
          silence_score: Math.round(silenceScore * 100) / 100,
          why_silenced: reasons.length > 0 ? reasons.join(', ') : 'Quality content with low visibility',
          is_educational: altAnalysis?.is_educational || false
        })
      }
      
      await new Promise(r => setTimeout(r, 100))
    }
    
    silencedAlternatives.sort((a, b) => b.silence_score - a.silence_score)
    
    return new Response(JSON.stringify({
      current_video: {
        video_id: video.videoId,
        title: video.title,
        channel: video.channelTitle,
        thumbnail: video.thumbnail,
        view_count: video.viewCount,
        subscriber_count: video.subscriberCount
      },
      analysis: currentVideoAnalysis,
      silenced_alternatives: silencedAlternatives.slice(0, 5)
    }), { headers })
    
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers })
  }
})
