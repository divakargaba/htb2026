// supabase/functions/recommend/index.ts
// Silenced by the Algorithm - Edge Function (Redesigned)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// API Keys (Use Supabase secrets)
const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

// ============== TYPES ==============

interface YouTubeSearchResult {
  videoId: string
  title: string
  channelId: string
  channelTitle: string
  description: string
  thumbnail: string
  publishedAt: string
}

interface YouTubeVideo {
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
}

interface GeminiClassification {
  sustainability_relevance: number
  topic_category: string
  is_educational: boolean
  sensational_score: number
  credibility_signals: string[]
  creator_type: string
  amplification_assessment: string
  explanation: string
}

interface ScoredVideo extends YouTubeVideo {
  gemini: GeminiClassification
  silence_score: number
  noise_score: number
  tags: string[]
  why: string
}

interface AuditMetrics {
  creator_concentration: number
  small_creator_suppression: number
  educational_ratio: number
  sensational_ratio: number
  topic_diversity: number
}

interface Audit {
  summary: string[]
  metrics: AuditMetrics
  recommendations: string[]
}

// ============== YOUTUBE API FUNCTIONS ==============

// NO MORE FORCED SUSTAINABILITY KEYWORDS - use exact query
async function searchYouTubeVideos(query: string, maxResults: number = 20): Promise<YouTubeSearchResult[]> {
  const allResults: YouTubeSearchResult[] = []
  const seenIds = new Set<string>()
  
  // Calculate date for "recent" content (last 2 years)
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const publishedAfter = twoYearsAgo.toISOString()
  
  // Search with exact query only - no forced keywords
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', query)
  url.searchParams.set('type', 'video')
  url.searchParams.set('maxResults', String(maxResults))
  url.searchParams.set('order', 'relevance')
  url.searchParams.set('publishedAfter', publishedAfter)
  url.searchParams.set('relevanceLanguage', 'en')
  url.searchParams.set('safeSearch', 'moderate')
  url.searchParams.set('key', YOUTUBE_API_KEY)
  
  try {
    const response = await fetch(url.toString())
    const data = await response.json()
    
    if (data.error) {
      console.error('YouTube API error:', data.error)
      return []
    }
    
    if (data.items) {
      for (const item of data.items) {
        if (item.id?.videoId && !seenIds.has(item.id.videoId)) {
          seenIds.add(item.id.videoId)
          allResults.push({
            videoId: item.id.videoId,
            title: item.snippet?.title || 'Untitled',
            channelId: item.snippet?.channelId || '',
            channelTitle: item.snippet?.channelTitle || 'Unknown',
            description: item.snippet?.description || '',
            thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
            publishedAt: item.snippet?.publishedAt || new Date().toISOString()
          })
        }
      }
    }
  } catch (error) {
    console.error('YouTube search error:', error)
  }
  
  return allResults
}

async function getVideoDetails(videoIds: string[]): Promise<Map<string, { viewCount: number, likeCount: number, duration: string }>> {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos')
  url.searchParams.set('part', 'statistics,contentDetails')
  url.searchParams.set('id', videoIds.join(','))
  url.searchParams.set('key', YOUTUBE_API_KEY)
  
  const details = new Map()
  
  try {
    const response = await fetch(url.toString())
    const data = await response.json()
    
    if (data.items) {
      for (const item of data.items) {
        details.set(item.id, {
          viewCount: parseInt(item.statistics?.viewCount || '0'),
          likeCount: parseInt(item.statistics?.likeCount || '0'),
          duration: item.contentDetails?.duration || 'PT0S'
        })
      }
    }
  } catch (error) {
    console.error('YouTube video details error:', error)
  }
  
  return details
}

async function getChannelDetails(channelIds: string[]): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(channelIds)].filter(id => id)
  if (uniqueIds.length === 0) return new Map()
  
  const url = new URL('https://www.googleapis.com/youtube/v3/channels')
  url.searchParams.set('part', 'statistics')
  url.searchParams.set('id', uniqueIds.join(','))
  url.searchParams.set('key', YOUTUBE_API_KEY)
  
  const subscribers = new Map()
  
  try {
    const response = await fetch(url.toString())
    const data = await response.json()
    
    if (data.items) {
      for (const item of data.items) {
        subscribers.set(item.id, parseInt(item.statistics?.subscriberCount || '0'))
      }
    }
  } catch (error) {
    console.error('YouTube channel details error:', error)
  }
  
  return subscribers
}

async function fetchYouTubeCandidates(query: string): Promise<YouTubeVideo[]> {
  console.log('Searching YouTube for:', query)
  const searchResults = await searchYouTubeVideos(query, 20)
  console.log('Found', searchResults.length, 'search results')
  
  if (searchResults.length === 0) {
    return []
  }
  
  const videoIds = searchResults.map(v => v.videoId)
  const videoDetails = await getVideoDetails(videoIds)
  
  const channelIds = searchResults.map(v => v.channelId).filter(id => id)
  const channelSubs = await getChannelDetails(channelIds)
  
  return searchResults.map(sr => ({
    videoId: sr.videoId,
    title: sr.title,
    description: sr.description,
    channelTitle: sr.channelTitle,
    channelId: sr.channelId,
    publishedAt: sr.publishedAt,
    thumbnail: sr.thumbnail,
    viewCount: videoDetails.get(sr.videoId)?.viewCount || 0,
    likeCount: videoDetails.get(sr.videoId)?.likeCount || 0,
    duration: videoDetails.get(sr.videoId)?.duration || 'PT0S',
    subscriberCount: channelSubs.get(sr.channelId) || 0
  }))
}

// ============== GEMINI CLASSIFICATION ==============

const GEMINI_PROMPT = `You are analyzing YouTube video metadata to detect potential algorithmic bias patterns.

ANALYZE THIS VIDEO:
- Title: {{TITLE}}
- Channel: {{CHANNEL}}
- Description: {{DESCRIPTION}}
- Views: {{VIEWS}}
- Likes: {{LIKES}}
- Subscribers: {{SUBSCRIBERS}}
- Duration: {{DURATION}}

RESPOND WITH ONLY THIS JSON (no markdown):
{"sustainability_relevance": <0.0-1.0>, "topic_category": "<category>", "is_educational": <true|false>, "sensational_score": <0.0-1.0>, "credibility_signals": ["<signal>"], "creator_type": "<micro|small|medium|large>", "amplification_assessment": "<under_amplified|appropriately_visible|over_amplified>", "explanation": "<one sentence>"}

CRITERIA:
- sustainability_relevance: How related to sustainability/environment (0=none, 1=direct)
- topic_category: climate, energy, transit, waste, water, biodiversity, policy, esg, food, housing, tech, news, entertainment, education, other
- is_educational: Does it teach/inform vs entertain?
- sensational_score: ALL CAPS, clickbait phrases, fear-mongering = high
- creator_type: micro (<10K subs), small (10K-100K), medium (100K-1M), large (1M+)`

async function classifyVideoWithGemini(video: YouTubeVideo): Promise<GeminiClassification> {
  const prompt = GEMINI_PROMPT
    .replace('{{TITLE}}', video.title.substring(0, 200))
    .replace('{{CHANNEL}}', video.channelTitle.substring(0, 100))
    .replace('{{DESCRIPTION}}', video.description.substring(0, 300))
    .replace('{{VIEWS}}', video.viewCount.toLocaleString())
    .replace('{{LIKES}}', video.likeCount.toLocaleString())
    .replace('{{SUBSCRIBERS}}', video.subscriberCount.toLocaleString())
    .replace('{{DURATION}}', video.duration)
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 300
        }
      })
    })
    
    const data = await response.json()
    
    if (data.error) {
      throw new Error(data.error.message)
    }
    
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    const parsed = JSON.parse(text)
    return {
      sustainability_relevance: parsed.sustainability_relevance || 0.5,
      topic_category: parsed.topic_category || 'other',
      is_educational: parsed.is_educational || false,
      sensational_score: parsed.sensational_score || 0.5,
      credibility_signals: parsed.credibility_signals || [],
      creator_type: parsed.creator_type || getCreatorType(video.subscriberCount),
      amplification_assessment: parsed.amplification_assessment || 'appropriately_visible',
      explanation: parsed.explanation || 'Analysis complete'
    }
  } catch (error) {
    console.error('Gemini error:', video.videoId, error)
    return getDefaultClassification(video)
  }
}

function getCreatorType(subs: number): string {
  if (subs < 10000) return 'micro'
  if (subs < 100000) return 'small'
  if (subs < 1000000) return 'medium'
  return 'large'
}

function getDefaultClassification(video: YouTubeVideo): GeminiClassification {
  return {
    sustainability_relevance: 0.5,
    topic_category: 'other',
    is_educational: false,
    sensational_score: 0.5,
    credibility_signals: [],
    creator_type: getCreatorType(video.subscriberCount),
    amplification_assessment: 'appropriately_visible',
    explanation: 'Default classification'
  }
}

async function classifyAllVideos(videos: YouTubeVideo[]): Promise<GeminiClassification[]> {
  console.log('Classifying', videos.length, 'videos')
  const classifications: GeminiClassification[] = []
  
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i]
    const classification = await classifyVideoWithGemini(video)
    classifications.push(classification)
    if (i < videos.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  
  return classifications
}

// ============== SCORING ==============

function getAgeDays(publishedAt: string): number {
  try {
    const published = new Date(publishedAt)
    const now = new Date()
    return Math.max(1, Math.floor((now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24)))
  } catch {
    return 30
  }
}

function getDurationMinutes(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  return parseInt(match[1] || '0') * 60 + parseInt(match[2] || '0') + parseInt(match[3] || '0') / 60
}

function computeSilenceScore(video: YouTubeVideo, gemini: GeminiClassification): number {
  const likeRatio = video.viewCount > 0 ? video.likeCount / video.viewCount : 0
  const educationalBonus = gemini.is_educational ? 0.3 : 0
  const credibilityScore = (gemini.credibility_signals || []).filter(s => 
    ['expert_creator', 'institutional', 'data_driven', 'original_research', 'balanced'].includes(s)
  ).length * 0.1
  const negativeSignals = (gemini.credibility_signals || []).filter(s =>
    ['clickbait_title', 'reaction_content', 'promotional', 'unverified_claims'].includes(s)
  ).length * 0.15
  const longFormBonus = getDurationMinutes(video.duration) >= 10 ? 0.1 : 0
  
  const quality = Math.min(1, Math.max(0, 
    (likeRatio * 5) + educationalBonus + credibilityScore + longFormBonus - negativeSignals
  ))
  
  const ageDays = getAgeDays(video.publishedAt)
  const viewsPerDay = video.viewCount / ageDays
  const normalizedVisibility = Math.min(1, viewsPerDay / 100000)
  
  const creatorBonus = gemini.creator_type === 'micro' ? 0.3 
    : gemini.creator_type === 'small' ? 0.15 
    : 0
  
  const silenceScore = (quality * (1 + creatorBonus)) / (normalizedVisibility + 0.1)
  return Math.min(1, silenceScore / 5)
}

function computeNoiseScore(video: YouTubeVideo, gemini: GeminiClassification): number {
  const ageDays = getAgeDays(video.publishedAt)
  const viewsPerDay = video.viewCount / ageDays
  const normalizedVisibility = Math.min(1, viewsPerDay / 100000)
  
  const sensational = gemini.sensational_score
  const antiEducational = gemini.is_educational ? 0.2 : 0.8
  const creatorPenalty = gemini.creator_type === 'large' ? 0.3 : gemini.creator_type === 'medium' ? 0.15 : 0
  
  const noiseScore = normalizedVisibility * (sensational + antiEducational + creatorPenalty)
  return Math.min(1, noiseScore / 2)
}

function generateTags(video: YouTubeVideo, gemini: GeminiClassification): string[] {
  const tags: string[] = []
  
  if (gemini.creator_type === 'micro') tags.push('micro')
  else if (gemini.creator_type === 'small') tags.push('small')
  else if (gemini.creator_type === 'large') tags.push('large')
  
  if (gemini.is_educational) tags.push('educational')
  if (gemini.sensational_score > 0.6) tags.push('clickbait')
  if (getDurationMinutes(video.duration) >= 10) tags.push('long-form')
  
  tags.push(gemini.topic_category)
  
  return tags.slice(0, 4)
}

function generateWhy(video: YouTubeVideo, gemini: GeminiClassification, silenceScore: number, noiseScore: number): string {
  const ageDays = getAgeDays(video.publishedAt)
  const viewsPerDay = Math.round(video.viewCount / ageDays)
  
  if (silenceScore > noiseScore) {
    const reasons: string[] = []
    if (gemini.creator_type === 'micro' || gemini.creator_type === 'small') {
      reasons.push(`${gemini.creator_type} creator`)
    }
    if (gemini.is_educational) reasons.push('educational')
    if (viewsPerDay < 1000) reasons.push(`${viewsPerDay} views/day`)
    return reasons.length > 0 ? `Quality content: ${reasons.join(', ')}` : 'May be under-promoted'
  } else {
    const reasons: string[] = []
    if (gemini.sensational_score > 0.5) reasons.push('clickbait')
    if (gemini.creator_type === 'large') reasons.push('large creator')
    if (!gemini.is_educational) reasons.push('entertainment')
    return reasons.length > 0 ? `High visibility: ${reasons.join(', ')}` : 'May be over-promoted'
  }
}

function scoreAllVideos(videos: YouTubeVideo[], classifications: GeminiClassification[]): ScoredVideo[] {
  return videos.map((video, i) => {
    const gemini = classifications[i] || getDefaultClassification(video)
    const silence_score = computeSilenceScore(video, gemini)
    const noise_score = computeNoiseScore(video, gemini)
    
    return {
      ...video,
      gemini,
      silence_score,
      noise_score,
      tags: generateTags(video, gemini),
      why: generateWhy(video, gemini, silence_score, noise_score)
    }
  })
}

// ============== AUDIT ==============

function generateAudit(scoredVideos: ScoredVideo[]): Audit {
  const total = scoredVideos.length
  if (total === 0) {
    return {
      summary: ['No videos found for analysis'],
      metrics: { creator_concentration: 0, small_creator_suppression: 0, educational_ratio: 0, sensational_ratio: 0, topic_diversity: 0 },
      recommendations: ['Try a different search query']
    }
  }
  
  const largeCreatorCount = scoredVideos.filter(v => v.gemini.creator_type === 'large').length
  const creatorConcentration = largeCreatorCount / total
  
  const smallCreators = scoredVideos.filter(v => v.gemini.creator_type === 'micro' || v.gemini.creator_type === 'small').length
  const smallCreatorRatio = smallCreators / total
  const topByViews = [...scoredVideos].sort((a, b) => b.viewCount - a.viewCount).slice(0, Math.min(10, total))
  const smallInTop = topByViews.filter(v => v.gemini.creator_type === 'micro' || v.gemini.creator_type === 'small').length
  const smallCreatorSuppression = smallCreatorRatio > 0 ? Math.max(0, 1 - (smallInTop / topByViews.length) / smallCreatorRatio) : 0
  
  const educationalCount = scoredVideos.filter(v => v.gemini.is_educational).length
  const educationalRatio = educationalCount / total
  
  const sensationalCount = scoredVideos.filter(v => v.gemini.sensational_score > 0.5).length
  const sensationalRatio = sensationalCount / total
  
  const uniqueTopics = new Set(scoredVideos.map(v => v.gemini.topic_category))
  const topicDiversity = uniqueTopics.size / 15
  
  const summary: string[] = []
  if (creatorConcentration > 0.3) {
    summary.push(`${Math.round(creatorConcentration * 100)}% of results from channels with 1M+ subscribers`)
  }
  if (smallCreatorSuppression > 0.3) {
    summary.push(`Small creators underrepresented by ${Math.round(smallCreatorSuppression * 100)}%`)
  }
  if (educationalRatio < 0.4) {
    summary.push(`Only ${Math.round(educationalRatio * 100)}% of content is educational`)
  }
  if (sensationalRatio > 0.3) {
    summary.push(`${Math.round(sensationalRatio * 100)}% of results appear sensationalized`)
  }
  if (summary.length === 0) {
    summary.push('Results show relatively balanced representation')
  }
  
  const recommendations: string[] = [
    'Check the Silenced tab for quality content that may be overlooked',
    'Consider following smaller creators for diverse perspectives'
  ]
  
  return {
    summary,
    metrics: {
      creator_concentration: Math.round(creatorConcentration * 100) / 100,
      small_creator_suppression: Math.round(smallCreatorSuppression * 100) / 100,
      educational_ratio: Math.round(educationalRatio * 100) / 100,
      sensational_ratio: Math.round(sensationalRatio * 100) / 100,
      topic_diversity: Math.round(topicDiversity * 100) / 100
    },
    recommendations
  }
}

// ============== MAIN HANDLER ==============

serve(async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers })
  }
  
  try {
    const { query, page_type } = await req.json()
    
    if (!query) {
      return new Response(JSON.stringify({ error: 'Query is required' }), { status: 400, headers })
    }
    
    console.log(`Query: "${query}" | Type: ${page_type}`)
    
    const candidates = await fetchYouTubeCandidates(query)
    
    if (candidates.length === 0) {
      return new Response(JSON.stringify({
        query_used: query,
        silence_lens: [],
        noise_lens: [],
        audit: { summary: ['No videos found'], metrics: { creator_concentration: 0, small_creator_suppression: 0, educational_ratio: 0, sensational_ratio: 0, topic_diversity: 0 }, recommendations: ['Try a different search term'] }
      }), { headers })
    }
    
    const classifications = await classifyAllVideos(candidates)
    const scoredVideos = scoreAllVideos(candidates, classifications)
    
    const silenceLens = [...scoredVideos]
      .sort((a, b) => b.silence_score - a.silence_score)
      .slice(0, 10)
      .map(v => ({
        video_id: v.videoId,
        title: v.title,
        channel: v.channelTitle,
        thumbnail: v.thumbnail,
        view_count: v.viewCount,
        subscriber_count: v.subscriberCount,
        silence_score: Math.round(v.silence_score * 100) / 100,
        tags: v.tags,
        why: v.why
      }))
    
    const noiseLens = [...scoredVideos]
      .sort((a, b) => b.noise_score - a.noise_score)
      .slice(0, 10)
      .map(v => ({
        video_id: v.videoId,
        title: v.title,
        channel: v.channelTitle,
        thumbnail: v.thumbnail,
        view_count: v.viewCount,
        subscriber_count: v.subscriberCount,
        noise_score: Math.round(v.noise_score * 100) / 100,
        tags: v.tags,
        why: v.why
      }))
    
    const audit = generateAudit(scoredVideos)
    
    return new Response(JSON.stringify({
      query_used: query,
      silence_lens: silenceLens,
      noise_lens: noiseLens,
      audit
    }), { headers })
    
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers })
  }
})
