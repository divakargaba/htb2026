/**
 * DataEnricher - Batch enrich homepage seeds with YouTube Data API
 * 
 * Input: 20 HomepageSeed objects
 * Output: 20 EnrichedVideo objects with stats + channel data
 * 
 * API calls (parallel):
 * 1. videos.list for all 20 IDs
 * 2. channels.list for unique channelIds
 */

(function() {
  'use strict';

  // In-memory cache for this run only (no persistence)
  const videoCache = new Map();
  const channelCache = new Map();

  /**
   * Parse ISO 8601 duration to seconds
   * e.g., "PT12M34S" -> 754
   */
  function parseISO8601Duration(duration) {
    if (!duration) return 0;
    
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;
    
    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Fetch video details for multiple IDs in one API call
   */
  async function fetchVideosData(videoIds, apiKey) {
    if (!videoIds || videoIds.length === 0) return {};

    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,statistics,contentDetails,topicDetails');
    url.searchParams.set('id', videoIds.join(','));
    url.searchParams.set('key', apiKey);

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        console.error('[DataEnricher] Videos API error:', response.status);
        return {};
      }

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
          tags: item.snippet?.tags || [],
          categoryId: item.snippet?.categoryId || '',
          topicCategories: item.topicDetails?.topicCategories || []
        };
      }

      return result;
    } catch (err) {
      console.error('[DataEnricher] Videos fetch error:', err);
      return {};
    }
  }

  /**
   * Fetch channel details for multiple IDs in one API call
   */
  async function fetchChannelsData(channelIds, apiKey) {
    if (!channelIds || channelIds.length === 0) return {};

    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'snippet,statistics');
    url.searchParams.set('id', channelIds.join(','));
    url.searchParams.set('key', apiKey);

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        console.error('[DataEnricher] Channels API error:', response.status);
        return {};
      }

      const data = await response.json();
      const result = {};

      for (const item of (data.items || [])) {
        result[item.id] = {
          subs: parseInt(item.statistics?.subscriberCount) || 0,
          channelCreatedAt: item.snippet?.publishedAt || '',
          totalViews: parseInt(item.statistics?.viewCount) || 0,
          videoCount: parseInt(item.statistics?.videoCount) || 0
        };
      }

      return result;
    } catch (err) {
      console.error('[DataEnricher] Channels fetch error:', err);
      return {};
    }
  }

  /**
   * Enrich seeds with YouTube API data
   * Returns array of EnrichedVideo objects
   */
  async function enrichSeeds(seeds, apiKey) {
    if (!seeds || seeds.length === 0) {
      console.warn('[DataEnricher] No seeds to enrich');
      return [];
    }

    if (!apiKey) {
      console.error('[DataEnricher] No API key provided');
      return seeds.map(seed => ({ ...seed, stats: null, channel: null }));
    }

    console.log(`[DataEnricher] Enriching ${seeds.length} seeds...`);
    const startTime = Date.now();

    // Extract unique IDs
    const videoIds = seeds.map(s => s.videoId).filter(Boolean);
    const channelIds = [...new Set(seeds.map(s => s.channelId).filter(Boolean))];

    // Parallel API calls
    const [videosData, channelsData] = await Promise.all([
      fetchVideosData(videoIds, apiKey),
      fetchChannelsData(channelIds, apiKey)
    ]);

    console.log(`[DataEnricher] API calls completed in ${Date.now() - startTime}ms`);
    console.log(`[DataEnricher] Got ${Object.keys(videosData).length} videos, ${Object.keys(channelsData).length} channels`);

    // Merge data into enriched objects
    const enrichedVideos = seeds.map(seed => {
      const videoData = videosData[seed.videoId] || null;
      const channelData = channelsData[seed.channelId] || null;

      return {
        // Original seed fields
        videoId: seed.videoId,
        title: seed.title,
        channelId: seed.channelId,
        channelName: seed.channelName,
        viewCountText: seed.viewCountText,
        publishedTimeText: seed.publishedTimeText,
        durationText: seed.durationText,
        thumbnailUrl: seed.thumbnailUrl,
        href: seed.href,
        rank: seed.rank,

        // Enriched stats
        stats: videoData ? {
          views: videoData.views,
          likes: videoData.likes,
          comments: videoData.comments,
          publishedAt: videoData.publishedAt,
          durationSec: videoData.durationSec,
          description: videoData.description,
          tags: videoData.tags,
          categoryId: videoData.categoryId,
          topicCategories: videoData.topicCategories
        } : null,

        // Channel data
        channel: channelData ? {
          subs: channelData.subs,
          channelCreatedAt: channelData.channelCreatedAt,
          totalViews: channelData.totalViews,
          videoCount: channelData.videoCount
        } : null
      };
    });

    console.log(`[DataEnricher] Enrichment complete in ${Date.now() - startTime}ms`);
    return enrichedVideos;
  }

  /**
   * Clear in-memory caches (for fresh run)
   */
  function clearCaches() {
    videoCache.clear();
    channelCache.clear();
    console.log('[DataEnricher] Caches cleared');
  }

  // Expose module
  window.DataEnricher = {
    enrich: enrichSeeds,
    clearCaches,
    parseISO8601Duration
  };

  console.log('[DataEnricher] Module loaded');
})();
