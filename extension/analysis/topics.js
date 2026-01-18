/**
 * Topic Clustering Module
 * 
 * Analyzes video titles and transcripts to:
 * - Extract topic keywords
 * - Cluster videos by topic similarity
 * - Build user interest profile from feed
 * - Detect topic dominance and diversity
 */

;(function() {
'use strict';

// ============================================
// TOPIC CATEGORIES
// ============================================

const TOPIC_CATEGORIES = {
  technology: {
    keywords: ['tech', 'technology', 'software', 'hardware', 'computer', 'laptop', 'phone', 
               'smartphone', 'app', 'application', 'programming', 'coding', 'developer',
               'ai', 'artificial intelligence', 'machine learning', 'algorithm', 'data',
               'cloud', 'server', 'network', 'internet', 'web', 'website', 'digital'],
    weight: 1.0
  },
  gaming: {
    keywords: ['game', 'gaming', 'gamer', 'playstation', 'xbox', 'nintendo', 'pc gaming',
               'esports', 'streamer', 'twitch', 'gameplay', 'walkthrough', 'speedrun',
               'fortnite', 'minecraft', 'valorant', 'league', 'cod', 'gta'],
    weight: 1.0
  },
  entertainment: {
    keywords: ['movie', 'film', 'tv', 'show', 'series', 'netflix', 'disney', 'marvel',
               'dc', 'anime', 'cartoon', 'celebrity', 'actor', 'actress', 'hollywood',
               'trailer', 'review', 'reaction', 'breakdown', 'explained'],
    weight: 1.0
  },
  music: {
    keywords: ['music', 'song', 'album', 'artist', 'singer', 'band', 'concert', 'live',
               'official', 'video', 'lyrics', 'cover', 'remix', 'playlist', 'spotify',
               'hip hop', 'rap', 'pop', 'rock', 'edm', 'jazz', 'classical'],
    weight: 1.0
  },
  education: {
    keywords: ['learn', 'tutorial', 'course', 'lesson', 'education', 'school', 'university',
               'college', 'study', 'exam', 'test', 'science', 'math', 'history', 'english',
               'physics', 'chemistry', 'biology', 'explained', 'how to', 'guide'],
    weight: 1.2 // Slightly higher weight for educational content
  },
  news: {
    keywords: ['news', 'breaking', 'update', 'report', 'politics', 'election', 'government',
               'president', 'congress', 'senate', 'world', 'international', 'local',
               'economy', 'market', 'stock', 'business', 'finance'],
    weight: 1.0
  },
  lifestyle: {
    keywords: ['lifestyle', 'vlog', 'daily', 'routine', 'life', 'day in', 'morning',
               'night', 'home', 'house', 'apartment', 'room', 'tour', 'haul', 'shopping',
               'fashion', 'style', 'outfit', 'makeup', 'beauty', 'skincare'],
    weight: 1.0
  },
  fitness: {
    keywords: ['fitness', 'workout', 'exercise', 'gym', 'training', 'muscle', 'weight',
               'cardio', 'yoga', 'pilates', 'running', 'diet', 'nutrition', 'health',
               'healthy', 'protein', 'supplement', 'transformation'],
    weight: 1.0
  },
  food: {
    keywords: ['food', 'cooking', 'recipe', 'kitchen', 'chef', 'restaurant', 'eat',
               'eating', 'mukbang', 'taste', 'review', 'meal', 'dinner', 'lunch',
               'breakfast', 'dessert', 'baking', 'cake', 'pizza'],
    weight: 1.0
  },
  travel: {
    keywords: ['travel', 'trip', 'vacation', 'holiday', 'tour', 'visit', 'explore',
               'adventure', 'destination', 'hotel', 'flight', 'airport', 'country',
               'city', 'beach', 'mountain', 'nature', 'landscape'],
    weight: 1.0
  },
  finance: {
    keywords: ['money', 'finance', 'invest', 'investing', 'stock', 'crypto', 'bitcoin',
               'trading', 'wealth', 'rich', 'millionaire', 'passive income', 'side hustle',
               'budget', 'save', 'saving', 'debt', 'credit', 'loan'],
    weight: 1.0
  },
  diy: {
    keywords: ['diy', 'craft', 'handmade', 'build', 'make', 'create', 'project',
               'woodworking', 'renovation', 'repair', 'fix', 'restore', 'upcycle',
               'hack', 'trick', 'tip', 'idea'],
    weight: 1.0
  },
  automotive: {
    keywords: ['car', 'vehicle', 'auto', 'automotive', 'drive', 'driving', 'road',
               'engine', 'motor', 'motorcycle', 'bike', 'truck', 'suv', 'electric',
               'tesla', 'bmw', 'mercedes', 'toyota', 'honda'],
    weight: 1.0
  },
  sports: {
    keywords: ['sport', 'sports', 'football', 'basketball', 'soccer', 'baseball',
               'tennis', 'golf', 'hockey', 'mma', 'ufc', 'boxing', 'wrestling',
               'nba', 'nfl', 'mlb', 'fifa', 'olympics', 'athlete'],
    weight: 1.0
  },
  science: {
    keywords: ['science', 'scientific', 'research', 'discovery', 'experiment',
               'space', 'nasa', 'astronomy', 'physics', 'quantum', 'biology',
               'chemistry', 'nature', 'animal', 'wildlife', 'environment', 'climate'],
    weight: 1.2
  }
}

// ============================================
// KEYWORD EXTRACTION
// ============================================

/**
 * Extract keywords from text
 */
function extractKeywords(text, maxKeywords = 20) {
  if (!text) return []
  
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
    'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all',
    'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
    'now', 'here', 'there', 'then', 'new', 'video', 'watch', 'like', 'subscribe'
  ])
  
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w) && !/^\d+$/.test(w))
  
  // Count frequency
  const freq = {}
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1
  }
  
  // Sort by frequency
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word, count]) => ({ word, count }))
}

/**
 * Extract n-grams (2-3 word phrases)
 */
function extractNGrams(text, n = 2) {
  if (!text) return []
  
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
  
  const ngrams = []
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '))
  }
  
  // Count frequency
  const freq = {}
  for (const ngram of ngrams) {
    freq[ngram] = (freq[ngram] || 0) + 1
  }
  
  return Object.entries(freq)
    .filter(([_, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }))
}

// ============================================
// TOPIC DETECTION
// ============================================

/**
 * Detect topics from text
 */
function detectTopics(text) {
  if (!text) return []
  
  const textLower = text.toLowerCase()
  const detectedTopics = []
  
  for (const [topicName, topicData] of Object.entries(TOPIC_CATEGORIES)) {
    let matchCount = 0
    const matchedKeywords = []
    
    for (const keyword of topicData.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi')
      const matches = textLower.match(regex)
      if (matches) {
        matchCount += matches.length
        matchedKeywords.push(keyword)
      }
    }
    
    if (matchCount > 0) {
      detectedTopics.push({
        name: topicName,
        matchCount,
        matchedKeywords: [...new Set(matchedKeywords)],
        weight: topicData.weight,
        score: matchCount * topicData.weight
      })
    }
  }
  
  // Sort by score
  return detectedTopics.sort((a, b) => b.score - a.score)
}

/**
 * Get primary topic for a video
 */
function getPrimaryTopic(title, transcript = null) {
  const combinedText = title + ' ' + (transcript || '')
  const topics = detectTopics(combinedText)
  
  return topics.length > 0 ? topics[0] : { name: 'general', score: 0 }
}

// ============================================
// FEED ANALYSIS
// ============================================

/**
 * Build topic profile from feed videos
 */
function buildTopicProfile(videos) {
  if (!videos || videos.length === 0) {
    return {
      topics: [],
      channelLoop: [],
      styleProfile: {}
    }
  }
  
  const topicScores = {}
  const channelCounts = {}
  const allKeywords = []
  let totalDuration = 0
  let totalManipulation = 0
  let videoCount = 0
  
  for (const video of videos) {
    // Detect topics from title
    const topics = detectTopics(video.title || '')
    
    for (const topic of topics) {
      if (!topicScores[topic.name]) {
        topicScores[topic.name] = {
          name: topic.name,
          totalScore: 0,
          videoCount: 0,
          keywords: new Set()
        }
      }
      topicScores[topic.name].totalScore += topic.score
      topicScores[topic.name].videoCount++
      topic.matchedKeywords.forEach(kw => topicScores[topic.name].keywords.add(kw))
    }
    
    // Track channels
    const channel = video.channelName || video.channel || 'Unknown'
    channelCounts[channel] = (channelCounts[channel] || 0) + 1
    
    // Extract keywords from title
    const keywords = extractKeywords(video.title || '', 5)
    allKeywords.push(...keywords.map(k => k.word))
    
    // Track style metrics
    if (video.duration) totalDuration += video.duration
    if (video.manipulationScore !== undefined) {
      totalManipulation += video.manipulationScore
      videoCount++
    }
  }
  
  // Calculate topic weights
  const totalTopicScore = Object.values(topicScores).reduce((sum, t) => sum + t.totalScore, 0) || 1
  
  const topics = Object.values(topicScores)
    .map(t => ({
      name: t.name,
      weight: t.totalScore / totalTopicScore,
      videoCount: t.videoCount,
      keywords: [...t.keywords].slice(0, 10)
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
  
  // Get channel loop (repeated channels)
  const channelLoop = Object.entries(channelCounts)
    .filter(([_, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => name)
  
  // Style profile
  const styleProfile = {
    avgDuration: videos.length > 0 ? Math.round(totalDuration / videos.length) : 0,
    avgManipulation: videoCount > 0 ? Math.round(totalManipulation / videoCount) : 0
  }
  
  // Get unique keywords across feed
  const keywordFreq = {}
  for (const kw of allKeywords) {
    keywordFreq[kw] = (keywordFreq[kw] || 0) + 1
  }
  
  const topKeywords = Object.entries(keywordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }))
  
  return {
    topics,
    channelLoop,
    styleProfile,
    topKeywords,
    totalVideos: videos.length
  }
}

// ============================================
// DIVERSITY ANALYSIS
// ============================================

/**
 * Calculate topic diversity score
 */
function calculateTopicDiversity(topicProfile) {
  if (!topicProfile || !topicProfile.topics || topicProfile.topics.length === 0) {
    return { diversityScore: 0, analysis: {} }
  }
  
  const topics = topicProfile.topics
  
  // Shannon entropy for diversity
  let entropy = 0
  for (const topic of topics) {
    if (topic.weight > 0) {
      entropy -= topic.weight * Math.log2(topic.weight)
    }
  }
  
  // Normalize to 0-100 scale
  const maxEntropy = Math.log2(topics.length) || 1
  const normalizedEntropy = (entropy / maxEntropy) * 100
  
  // Check for dominance
  const topTopicWeight = topics[0]?.weight || 0
  const isDominant = topTopicWeight > 0.4
  
  // Check for variety
  const topicCount = topics.length
  const hasVariety = topicCount >= 4
  
  // Channel concentration
  const channelLoop = topicProfile.channelLoop || []
  const channelConcentration = channelLoop.length
  
  return {
    diversityScore: Math.round(normalizedEntropy),
    topicCount,
    dominantTopic: topics[0]?.name || 'none',
    dominantWeight: Math.round(topTopicWeight * 100),
    isDominant,
    hasVariety,
    channelConcentration,
    analysis: {
      entropy,
      maxEntropy,
      normalizedEntropy
    }
  }
}

/**
 * Generate diversity recommendations
 */
function generateDiversityRecommendations(topicProfile, diversityAnalysis) {
  const recommendations = []
  
  if (diversityAnalysis.isDominant) {
    recommendations.push({
      type: 'topic_dominance',
      message: `Your feed is ${diversityAnalysis.dominantWeight}% ${diversityAnalysis.dominantTopic}. Consider exploring other topics.`,
      severity: 'medium'
    })
  }
  
  if (!diversityAnalysis.hasVariety) {
    recommendations.push({
      type: 'low_variety',
      message: `Only ${diversityAnalysis.topicCount} topics detected. Your feed might be in a filter bubble.`,
      severity: 'high'
    })
  }
  
  if (diversityAnalysis.channelConcentration > 5) {
    recommendations.push({
      type: 'channel_loop',
      message: `${diversityAnalysis.channelConcentration} channels appear multiple times. You might be missing new creators.`,
      severity: 'low'
    })
  }
  
  if (diversityAnalysis.diversityScore < 40) {
    recommendations.push({
      type: 'low_diversity',
      message: 'Your feed diversity is low. The algorithm may be narrowing your content exposure.',
      severity: 'high'
    })
  }
  
  return recommendations
}

// ============================================
// CLUSTERING
// ============================================

/**
 * Simple clustering based on topic similarity
 */
function clusterVideos(videos) {
  if (!videos || videos.length === 0) {
    return []
  }
  
  const clusters = {}
  
  for (const video of videos) {
    const primaryTopic = getPrimaryTopic(video.title || '')
    const topicName = primaryTopic.name
    
    if (!clusters[topicName]) {
      clusters[topicName] = {
        name: topicName,
        videos: [],
        totalScore: 0
      }
    }
    
    clusters[topicName].videos.push(video)
    clusters[topicName].totalScore += primaryTopic.score
  }
  
  return Object.values(clusters)
    .map(cluster => ({
      ...cluster,
      avgScore: cluster.totalScore / cluster.videos.length,
      percentage: Math.round((cluster.videos.length / videos.length) * 100)
    }))
    .sort((a, b) => b.videos.length - a.videos.length)
}

/**
 * Find similar videos based on topic overlap
 */
function findSimilarVideos(targetVideo, videoPool, maxResults = 5) {
  const targetTopics = detectTopics(targetVideo.title || '')
  const targetTopicNames = new Set(targetTopics.map(t => t.name))
  
  const scored = videoPool
    .filter(v => v.videoId !== targetVideo.videoId)
    .map(video => {
      const videoTopics = detectTopics(video.title || '')
      const videoTopicNames = new Set(videoTopics.map(t => t.name))
      
      // Calculate overlap
      const overlap = [...targetTopicNames].filter(t => videoTopicNames.has(t)).length
      const similarity = overlap / Math.max(targetTopicNames.size, videoTopicNames.size, 1)
      
      return {
        ...video,
        similarity,
        sharedTopics: overlap
      }
    })
    .filter(v => v.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
  
  return scored.slice(0, maxResults)
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.TopicAnalyzer = {
    extractKeywords,
    extractNGrams,
    detectTopics,
    getPrimaryTopic,
    buildTopicProfile,
    calculateTopicDiversity,
    generateDiversityRecommendations,
    clusterVideos,
    findSimilarVideos,
    TOPIC_CATEGORIES
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractKeywords,
    extractNGrams,
    detectTopics,
    getPrimaryTopic,
    buildTopicProfile,
    calculateTopicDiversity,
    generateDiversityRecommendations,
    clusterVideos,
    findSimilarVideos,
    TOPIC_CATEGORIES
  }
}

})(); // End IIFE
