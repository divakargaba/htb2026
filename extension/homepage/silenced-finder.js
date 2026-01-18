/**
 * SilencedFinder - Find silenced counterparts for noise videos
 * 
 * Process for each of top 10 noise videos (in parallel):
 * 1. Build query from title keywords + 1 bigram
 * 2. search.list q=query, maxResults=25, order=relevance
 * 3. Enrich candidates (batch videos.list + channels.list)
 * 4. Hard filter: subs [1k-100k], views [5k-300k], duration >= 120s
 * 5. Compute QualityScore for each candidate
 * 6. Pick top 1 as silencedCounterpart
 */

(function() {
  'use strict';

  // Hard filter constraints
  const CONSTRAINTS = {
    subsMin: 1000,
    subsMax: 100000,
    viewsMin: 5000,
    viewsMax: 300000,
    durationMin: 120 // 2 minutes
  };

  // Broadening steps when no candidates found
  const BROADEN_STEPS = [
    { viewsMin: 2000, viewsMax: 500000 },
    { subsMin: 500, subsMax: 200000 },
    { viewsMin: 1000, viewsMax: 1000000 }
  ];

  // Blacklisted channel patterns (spam, low quality)
  const BLACKLIST_PATTERNS = [
    /compilation/i,
    /clips/i,
    /highlights/i,
    /best of/i,
    /top 10/i
  ];

  /**
   * Extract keywords from title for search query
   */
  function extractQueryKeywords(title) {
    if (!title) return '';

    // Stop words to exclude
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'be', 'are',
      'was', 'were', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
      'i', 'me', 'my', 'you', 'your', 'he', 'she', 'we', 'they', 'them'
    ]);

    // Clean and tokenize
    const cleaned = title
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(' ').filter(w => 
      w.length > 2 && !stopWords.has(w)
    );

    if (words.length === 0) return title.slice(0, 30);

    // Get top 4 keywords
    const keywords = words.slice(0, 4);

    // Try to add a bigram for better relevance
    if (words.length >= 2) {
      const bigram = `${words[0]} ${words[1]}`;
      if (!keywords.includes(bigram)) {
        keywords.push(bigram);
      }
    }

    return keywords.slice(0, 4).join(' ');
  }

  /**
   * Search for candidate videos
   */
  async function searchCandidates(query, apiKey, maxResults = 25) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('order', 'relevance');
    url.searchParams.set('key', apiKey);

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        console.error('[SilencedFinder] Search API error:', response.status);
        return [];
      }

      const data = await response.json();
      return (data.items || []).map(item => ({
        videoId: item.id?.videoId,
        title: item.snippet?.title || '',
        channelId: item.snippet?.channelId || '',
        channelName: item.snippet?.channelTitle || '',
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url || '',
        publishedAt: item.snippet?.publishedAt || ''
      })).filter(v => v.videoId);

    } catch (err) {
      console.error('[SilencedFinder] Search error:', err);
      return [];
    }
  }

  /**
   * Enrich candidates with video and channel data
   */
  async function enrichCandidates(candidates, apiKey) {
    if (candidates.length === 0) return [];

    const videoIds = candidates.map(c => c.videoId);
    const channelIds = [...new Set(candidates.map(c => c.channelId).filter(Boolean))];

    // Parallel API calls
    const [videosData, channelsData] = await Promise.all([
      fetchVideosData(videoIds, apiKey),
      fetchChannelsData(channelIds, apiKey)
    ]);

    return candidates.map(candidate => ({
      ...candidate,
      stats: videosData[candidate.videoId] || null,
      channel: channelsData[candidate.channelId] || null
    }));
  }

  /**
   * Fetch video stats
   */
  async function fetchVideosData(videoIds, apiKey) {
    if (videoIds.length === 0) return {};

    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,statistics,contentDetails');
    url.searchParams.set('id', videoIds.join(','));
    url.searchParams.set('key', apiKey);

    try {
      const response = await fetch(url.toString());
      if (!response.ok) return {};

      const data = await response.json();
      const result = {};

      for (const item of (data.items || [])) {
        result[item.id] = {
          views: parseInt(item.statistics?.viewCount) || 0,
          likes: item.statistics?.likeCount ? parseInt(item.statistics.likeCount) : null,
          comments: item.statistics?.commentCount ? parseInt(item.statistics.commentCount) : null,
          publishedAt: item.snippet?.publishedAt || '',
          durationSec: parseISO8601Duration(item.contentDetails?.duration),
          description: item.snippet?.description || '',
          tags: item.snippet?.tags || []
        };
      }

      return result;
    } catch (err) {
      return {};
    }
  }

  /**
   * Fetch channel stats
   */
  async function fetchChannelsData(channelIds, apiKey) {
    if (channelIds.length === 0) return {};

    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', channelIds.join(','));
    url.searchParams.set('key', apiKey);

    try {
      const response = await fetch(url.toString());
      if (!response.ok) return {};

      const data = await response.json();
      const result = {};

      for (const item of (data.items || [])) {
        result[item.id] = {
          subs: parseInt(item.statistics?.subscriberCount) || 0,
          totalViews: parseInt(item.statistics?.viewCount) || 0,
          videoCount: parseInt(item.statistics?.videoCount) || 0
        };
      }

      return result;
    } catch (err) {
      return {};
    }
  }

  /**
   * Parse ISO 8601 duration
   */
  function parseISO8601Duration(duration) {
    if (!duration) return 0;
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    return (parseInt(match[1]) || 0) * 3600 + 
           (parseInt(match[2]) || 0) * 60 + 
           (parseInt(match[3]) || 0);
  }

  /**
   * Apply hard filters to candidates
   */
  function filterCandidates(candidates, constraints, excludeChannelIds = []) {
    return candidates.filter(c => {
      // Must have stats and channel data
      if (!c.stats || !c.channel) return false;

      // Exclude specific channels
      if (excludeChannelIds.includes(c.channelId)) return false;

      // Subs range
      if (c.channel.subs < constraints.subsMin || c.channel.subs > constraints.subsMax) return false;

      // Views range
      if (c.stats.views < constraints.viewsMin || c.stats.views > constraints.viewsMax) return false;

      // Duration minimum
      if (c.stats.durationSec < constraints.durationMin) return false;

      // Blacklist patterns
      for (const pattern of BLACKLIST_PATTERNS) {
        if (pattern.test(c.title) || pattern.test(c.channelName)) return false;
      }

      // No shorts
      if (c.title.toLowerCase().includes('#shorts')) return false;

      return true;
    });
  }

  /**
   * Compute quality score for a candidate
   */
  function computeQualityScore(candidate) {
    if (!candidate.stats || !candidate.channel) return 0;

    const views = candidate.stats.views;
    const likes = candidate.stats.likes;
    const comments = candidate.stats.comments;
    const subs = candidate.channel.subs;
    const durationSec = candidate.stats.durationSec;

    // Like rate (if available)
    const likeRate = likes !== null && views > 0 ? likes / views : 0.03;
    const likeScore = Math.min(1, likeRate / 0.05) * 30;

    // Comment rate
    const commentRate = comments !== null && views > 0 ? comments / views : 0.001;
    const commentScore = Math.min(1, commentRate / 0.005) * 15;

    // Views per sub (viral potential)
    const viewsPerSub = subs > 0 ? views / subs : 0;
    const viralScore = Math.min(1, viewsPerSub / 2) * 20;

    // Duration bonus (6-20 min is ideal)
    const durationMin = durationSec / 60;
    let durationScore = 0;
    if (durationMin >= 6 && durationMin <= 20) {
      durationScore = 15;
    } else if (durationMin >= 2) {
      durationScore = Math.max(0, 15 - Math.abs(durationMin - 13) / 2);
    }

    // Small channel bonus (underexposure)
    const smallChannelBonus = subs < 50000 ? 10 : (subs < 100000 ? 5 : 0);

    // Age penalty (very old videos are less relevant)
    const publishDate = new Date(candidate.stats.publishedAt);
    const ageMonths = (Date.now() - publishDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    const agePenalty = ageMonths > 24 ? -10 : 0;

    const total = Math.max(0, Math.min(100,
      likeScore + commentScore + viralScore + durationScore + smallChannelBonus + agePenalty
    ));

    return Math.round(total);
  }

  /**
   * Find silenced counterpart for a single noise video
   */
  async function findSilencedForVideo(noiseVideo, apiKey, excludeChannelIds) {
    const query = extractQueryKeywords(noiseVideo.title);
    if (!query) {
      return { noiseVideoId: noiseVideo.videoId, silencedVideo: null, error: 'No query' };
    }

    console.log(`[SilencedFinder] Searching for: "${query}"`);

    // Search for candidates
    const searchResults = await searchCandidates(query, apiKey);
    if (searchResults.length === 0) {
      return { noiseVideoId: noiseVideo.videoId, silencedVideo: null, error: 'No search results' };
    }

    // Enrich candidates
    const enriched = await enrichCandidates(searchResults, apiKey);

    // Try filtering with initial constraints
    let filtered = filterCandidates(enriched, CONSTRAINTS, excludeChannelIds);

    // Broaden if needed
    let broadenStep = 0;
    while (filtered.length < 3 && broadenStep < BROADEN_STEPS.length) {
      const relaxed = { ...CONSTRAINTS, ...BROADEN_STEPS[broadenStep] };
      filtered = filterCandidates(enriched, relaxed, excludeChannelIds);
      broadenStep++;
    }

    if (filtered.length === 0) {
      return { noiseVideoId: noiseVideo.videoId, silencedVideo: null, error: 'All filtered out' };
    }

    // Score candidates and pick best
    const scored = filtered.map(c => ({
      ...c,
      qualityScore: computeQualityScore(c)
    })).sort((a, b) => b.qualityScore - a.qualityScore);

    const best = scored[0];

    return {
      noiseVideoId: noiseVideo.videoId,
      silencedVideo: best,
      whySilenced: {
        subs: best.channel?.subs,
        views: best.stats?.views,
        likeRate: best.stats?.likes && best.stats?.views 
          ? Math.round((best.stats.likes / best.stats.views) * 10000) / 100 
          : null,
        durationMin: Math.round(best.stats?.durationSec / 60)
      },
      qualityScore: best.qualityScore,
      query,
      candidateCount: filtered.length
    };
  }

  /**
   * Find silenced counterparts for top 10 noise videos (in parallel)
   */
  async function findSilencedVideos(scoredVideos, apiKey) {
    if (!scoredVideos || scoredVideos.length === 0) {
      console.warn('[SilencedFinder] No videos to process');
      return [];
    }

    if (!apiKey) {
      console.error('[SilencedFinder] No API key');
      return [];
    }

    console.log(`[SilencedFinder] Finding silenced for ${Math.min(10, scoredVideos.length)} videos...`);
    const startTime = Date.now();

    // Get top 10 by bias score
    const top10 = scoredVideos
      .slice()
      .sort((a, b) => b.biasScore - a.biasScore)
      .slice(0, 10);

    // Collect channel IDs to exclude (don't recommend same channels as in feed)
    const excludeChannelIds = scoredVideos.map(v => v.channelId).filter(Boolean);

    // Process in parallel
    const results = await Promise.all(
      top10.map(video => findSilencedForVideo(video, apiKey, excludeChannelIds))
    );

    console.log(`[SilencedFinder] Complete in ${Date.now() - startTime}ms`);

    // Filter out failures
    return results.filter(r => r.silencedVideo !== null);
  }

  // Expose module
  window.SilencedFinder = {
    find: findSilencedVideos,
    findForVideo: findSilencedForVideo,
    extractQueryKeywords,
    computeQualityScore
  };

  console.log('[SilencedFinder] Module loaded');
})();
