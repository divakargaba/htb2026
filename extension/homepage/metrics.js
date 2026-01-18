/**
 * MetricUtils - Compute derived metrics and global percentiles
 * 
 * Functions:
 * - parseISO8601Duration(str) - "PT12M34S" to seconds
 * - parseViewCountText(str) - "1.2M views" to number (fallback)
 * - ageHours(publishedAt) - hours since publish
 * - computeDerivedMetrics(video) - returns derived metrics
 * - computePercentiles(videos, field) - returns { p75, p95 }
 * - computeGlobalStats(videos) - returns all percentiles
 */

(function() {
  'use strict';

  /**
   * Parse ISO 8601 duration to seconds
   * e.g., "PT12M34S" -> 754, "PT1H2M3S" -> 3723
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
   * Parse view count text to number (fallback when API fails)
   * e.g., "1.2M views" -> 1200000, "456K views" -> 456000
   */
  function parseViewCountText(text) {
    if (!text) return 0;
    
    // Remove "views" and trim
    const cleaned = text.replace(/views?/gi, '').trim();
    
    // Handle suffixes
    const match = cleaned.match(/([\d.,]+)\s*([KMB])?/i);
    if (!match) return 0;
    
    let num = parseFloat(match[1].replace(/,/g, ''));
    const suffix = (match[2] || '').toUpperCase();
    
    switch (suffix) {
      case 'K': num *= 1000; break;
      case 'M': num *= 1000000; break;
      case 'B': num *= 1000000000; break;
    }
    
    return Math.round(num);
  }

  /**
   * Calculate hours since publish date
   */
  function ageHours(publishedAt) {
    if (!publishedAt) return 0;
    
    try {
      const publishDate = new Date(publishedAt);
      const now = new Date();
      const diffMs = now - publishDate;
      return Math.max(0, diffMs / (1000 * 60 * 60));
    } catch {
      return 0;
    }
  }

  /**
   * Compute views per hour (velocity)
   */
  function viewsPerHour(views, publishedAt) {
    const hours = ageHours(publishedAt);
    if (hours <= 0) return 0;
    return views / hours;
  }

  /**
   * Compute like rate (likes / views)
   */
  function likeRate(likes, views) {
    if (!views || views === 0) return 0;
    if (likes === null || likes === undefined) return null; // Hidden
    return likes / views;
  }

  /**
   * Compute comment rate (comments / views)
   */
  function commentRate(comments, views) {
    if (!views || views === 0) return 0;
    if (comments === null || comments === undefined) return null; // Hidden
    return comments / views;
  }

  /**
   * Compute views per subscriber ratio
   */
  function viewsPerSub(views, subs) {
    if (!subs || subs === 0) return 0;
    return views / subs;
  }

  /**
   * Compute all derived metrics for a single enriched video
   */
  function computeDerivedMetrics(video) {
    const views = video.stats?.views || 0;
    const likes = video.stats?.likes;
    const comments = video.stats?.comments;
    const publishedAt = video.stats?.publishedAt;
    const subs = video.channel?.subs || 0;
    const durationSec = video.stats?.durationSec || 0;

    return {
      ageHours: ageHours(publishedAt),
      viewsPerHour: viewsPerHour(views, publishedAt),
      likeRate: likeRate(likes, views),
      commentRate: commentRate(comments, views),
      viewsPerSub: viewsPerSub(views, subs),
      durationSec,
      views,
      likes,
      comments,
      subs
    };
  }

  /**
   * Compute percentile values for a numeric array
   * Returns { p25, p50, p75, p95, min, max, mean }
   */
  function computePercentiles(values) {
    if (!values || values.length === 0) {
      return { p25: 0, p50: 0, p75: 0, p95: 0, min: 0, max: 0, mean: 0 };
    }

    // Filter out null/undefined and sort
    const sorted = values
      .filter(v => v !== null && v !== undefined && !isNaN(v))
      .sort((a, b) => a - b);

    if (sorted.length === 0) {
      return { p25: 0, p50: 0, p75: 0, p95: 0, min: 0, max: 0, mean: 0 };
    }

    const getPercentile = (arr, p) => {
      const idx = Math.floor((p / 100) * (arr.length - 1));
      return arr[idx];
    };

    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      p25: getPercentile(sorted, 25),
      p50: getPercentile(sorted, 50),
      p75: getPercentile(sorted, 75),
      p95: getPercentile(sorted, 95),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length
    };
  }

  /**
   * Compute global stats (percentiles) for all key metrics across videos
   */
  function computeGlobalStats(enrichedVideos) {
    if (!enrichedVideos || enrichedVideos.length === 0) {
      return null;
    }

    // Compute derived metrics for all videos
    const allMetrics = enrichedVideos.map(v => computeDerivedMetrics(v));

    return {
      viewsPerHour: computePercentiles(allMetrics.map(m => m.viewsPerHour)),
      subs: computePercentiles(allMetrics.map(m => m.subs)),
      likeRate: computePercentiles(allMetrics.map(m => m.likeRate).filter(r => r !== null)),
      commentRate: computePercentiles(allMetrics.map(m => m.commentRate).filter(r => r !== null)),
      viewsPerSub: computePercentiles(allMetrics.map(m => m.viewsPerSub)),
      views: computePercentiles(allMetrics.map(m => m.views)),
      ageHours: computePercentiles(allMetrics.map(m => m.ageHours)),
      durationSec: computePercentiles(allMetrics.map(m => m.durationSec))
    };
  }

  /**
   * Normalize a value to 0..1 based on percentiles
   * Values at p95+ get 1.0, values at 0 get 0.0
   */
  function normalizeByPercentile(value, percentiles) {
    if (!percentiles || percentiles.p95 === 0) return 0;
    return Math.min(1, Math.max(0, value / percentiles.p95));
  }

  /**
   * Normalize a value using min-max scaling
   */
  function normalizeMinMax(value, min, max) {
    if (max === min) return 0;
    return Math.min(1, Math.max(0, (value - min) / (max - min)));
  }

  // Expose module
  window.MetricUtils = {
    parseISO8601Duration,
    parseViewCountText,
    ageHours,
    viewsPerHour,
    likeRate,
    commentRate,
    viewsPerSub,
    computeDerivedMetrics,
    computePercentiles,
    computeGlobalStats,
    normalizeByPercentile,
    normalizeMinMax
  };

  console.log('[MetricUtils] Module loaded');
})();
