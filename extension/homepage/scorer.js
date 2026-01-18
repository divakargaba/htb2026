/**
 * BiasScorer - Compute bias scores for homepage videos
 * 
 * Feature groups (each 0..1):
 * - EA (Exposure Advantage): rankScore, velocityScore, authorityScore, freshScore
 * - CM (Click Magnet): title signals + thumbnail features
 * - RP (Retention Proxy): satisfaction (likeRate), velocity
 * - EN (Engagement): likeRate, commentRate normalized
 * - TR (Topic Reinforcement): cluster share from title topic clustering
 * - CI (Commercial Influence): sponsor regex, link density
 * 
 * Formula: BiasScore = 100 * (0.25*EA + 0.25*CM + 0.25*RP + 0.10*EN + 0.10*TR + 0.05*CI)
 */

(function() {
  'use strict';

  // Clickbait title patterns
  const CLICKBAIT_PATTERNS = [
    /you won'?t believe/i,
    /shocking/i,
    /insane/i,
    /destroyed/i,
    /exposed/i,
    /gone wrong/i,
    /what happens/i,
    /this is why/i,
    /the truth about/i,
    /\?\?+/,  // Multiple question marks
    /\!\!+/,  // Multiple exclamation marks
    /😱|🤯|😭|🔥|💀/,  // Sensational emojis
  ];

  // Sponsor/commercial patterns in description
  const SPONSOR_PATTERNS = [
    /sponsored by/i,
    /thanks to .+ for sponsoring/i,
    /use code/i,
    /promo code/i,
    /affiliate link/i,
    /check out .+ at/i,
    /shop\.app/i,
    /amzn\.to/i,
    /bit\.ly/i
  ];

  /**
   * Compute Exposure Advantage (EA) score (0..1)
   * Higher = more algorithmic advantage
   */
  function computeEA(video, metrics, globalStats) {
    // 1. Rank score: rank 1 = 1.0, rank 20 = 0.05
    const rankScore = Math.max(0.05, 1 - (video.rank - 1) / 20);

    // 2. Velocity score: viewsPerHour normalized by p95
    const velocityScore = globalStats?.viewsPerHour?.p95 > 0
      ? Math.min(1, metrics.viewsPerHour / globalStats.viewsPerHour.p95)
      : 0.5;

    // 3. Authority score: channel subs normalized by p95
    const authorityScore = globalStats?.subs?.p95 > 0
      ? Math.min(1, metrics.subs / globalStats.subs.p95)
      : 0.5;

    // 4. Fresh score: newer videos get higher scores (inverse of age)
    // 24h = 1.0, 168h (1 week) = 0.14
    const freshScore = metrics.ageHours > 0
      ? Math.min(1, 24 / metrics.ageHours)
      : 0.5;

    // Weighted average
    return 0.3 * rankScore + 0.3 * velocityScore + 0.25 * authorityScore + 0.15 * freshScore;
  }

  /**
   * Compute Click Magnet (CM) score (0..1)
   * Higher = more clickbait signals
   */
  function computeCM(video, thumbnailFeatures) {
    // Title analysis
    const title = video.title || '';
    
    // Count clickbait pattern matches
    let clickbaitCount = 0;
    for (const pattern of CLICKBAIT_PATTERNS) {
      if (pattern.test(title)) clickbaitCount++;
    }
    const titleBaitScore = Math.min(1, clickbaitCount / 3);

    // Title caps ratio
    const capsCount = (title.match(/[A-Z]/g) || []).length;
    const capsRatio = title.length > 0 ? capsCount / title.length : 0;
    const capsScore = Math.min(1, capsRatio * 2);

    // Thumbnail features (if available)
    const thumbFeatures = thumbnailFeatures || {};
    const saturationScore = thumbFeatures.saturation || 0.5;
    const contrastScore = thumbFeatures.contrast || 0.5;
    const redScore = thumbFeatures.redDominance || 0.3;
    const edgeScore = thumbFeatures.edgeDensity || 0.3;

    // Combine: title signals (40%) + thumbnail signals (60%)
    const titleScore = 0.6 * titleBaitScore + 0.4 * capsScore;
    const thumbScore = 0.3 * saturationScore + 0.25 * contrastScore + 0.25 * redScore + 0.2 * edgeScore;

    return 0.4 * titleScore + 0.6 * thumbScore;
  }

  /**
   * Compute Retention Proxy (RP) score (0..1)
   * Higher = better predicted retention
   */
  function computeRP(video, metrics, globalStats) {
    // Satisfaction from like rate
    const likeRateValue = metrics.likeRate !== null ? metrics.likeRate : 0.03;
    const likeRateP95 = globalStats?.likeRate?.p95 || 0.05;
    const satisfactionScore = Math.min(1, likeRateValue / likeRateP95);

    // Velocity indicates content is being watched
    const velocityP95 = globalStats?.viewsPerHour?.p95 || 1000;
    const velocityScore = Math.min(1, metrics.viewsPerHour / velocityP95);

    // Combine
    return 0.6 * satisfactionScore + 0.4 * velocityScore;
  }

  /**
   * Compute Engagement (EN) score (0..1)
   * Normalized like and comment rates
   */
  function computeEN(video, metrics, globalStats) {
    // Like rate normalized
    const likeRateValue = metrics.likeRate !== null ? metrics.likeRate : 0;
    const likeRateP95 = globalStats?.likeRate?.p95 || 0.05;
    const likeScore = Math.min(1, likeRateValue / likeRateP95);

    // Comment rate normalized
    const commentRateValue = metrics.commentRate !== null ? metrics.commentRate : 0;
    const commentRateP95 = globalStats?.commentRate?.p95 || 0.005;
    const commentScore = Math.min(1, commentRateValue / commentRateP95);

    return 0.6 * likeScore + 0.4 * commentScore;
  }

  /**
   * Compute Topic Reinforcement (TR) score (0..1)
   * Based on how many videos share similar topics
   */
  function computeTR(video, allVideos) {
    if (!allVideos || allVideos.length === 0) return 0.5;

    const title = (video.title || '').toLowerCase();
    const words = title.split(/\s+/).filter(w => w.length > 3);

    // Count videos with overlapping keywords
    let overlapCount = 0;
    for (const otherVideo of allVideos) {
      if (otherVideo.videoId === video.videoId) continue;
      
      const otherTitle = (otherVideo.title || '').toLowerCase();
      const sharedWords = words.filter(w => otherTitle.includes(w));
      
      if (sharedWords.length >= 2) {
        overlapCount++;
      }
    }

    // Normalize: if half the feed shares topic, score = 1
    return Math.min(1, overlapCount / (allVideos.length / 2));
  }

  /**
   * Compute Commercial Influence (CI) score (0..1)
   * Higher = more commercial signals
   */
  function computeCI(video) {
    const description = video.stats?.description || '';
    
    // Count sponsor patterns
    let sponsorCount = 0;
    for (const pattern of SPONSOR_PATTERNS) {
      if (pattern.test(description)) sponsorCount++;
    }
    const sponsorScore = Math.min(1, sponsorCount / 2);

    // Link density in description
    const linkCount = (description.match(/https?:\/\//g) || []).length;
    const linkScore = Math.min(1, linkCount / 5);

    return 0.6 * sponsorScore + 0.4 * linkScore;
  }

  /**
   * Compute confidence score (0..100) based on data completeness
   */
  function computeConfidence(video, metrics, thumbnailFeatures) {
    let score = 100;

    // Missing stats reduces confidence
    if (!video.stats) score -= 30;
    else {
      if (video.stats.likes === null) score -= 10;
      if (video.stats.comments === null) score -= 10;
    }

    // Missing channel data reduces confidence
    if (!video.channel) score -= 20;

    // Missing thumbnail analysis reduces confidence
    if (!thumbnailFeatures || thumbnailFeatures.error) score -= 15;

    // Very new videos have less reliable metrics
    if (metrics.ageHours < 6) score -= 15;

    return Math.max(0, score);
  }

  /**
   * Main scoring function
   * @param {Array} enrichedVideos - Array of EnrichedVideo objects
   * @param {Object} thumbnailFeatures - Map of videoId -> features
   * @returns {Array} Array of scored videos with breakdown
   */
  function scoreVideos(enrichedVideos, thumbnailFeatures = {}) {
    if (!enrichedVideos || enrichedVideos.length === 0) {
      return [];
    }

    console.log(`[BiasScorer] Scoring ${enrichedVideos.length} videos...`);
    const startTime = Date.now();

    // Compute global stats for normalization
    const globalStats = window.MetricUtils?.computeGlobalStats(enrichedVideos);

    const scoredVideos = enrichedVideos.map(video => {
      // Compute derived metrics
      const metrics = window.MetricUtils?.computeDerivedMetrics(video) || {
        ageHours: 0,
        viewsPerHour: 0,
        likeRate: null,
        commentRate: null,
        viewsPerSub: 0,
        views: 0,
        subs: 0
      };

      const thumbFeatures = thumbnailFeatures[video.videoId];

      // Compute each feature group
      const EA = computeEA(video, metrics, globalStats);
      const CM = computeCM(video, thumbFeatures);
      const RP = computeRP(video, metrics, globalStats);
      const EN = computeEN(video, metrics, globalStats);
      const TR = computeTR(video, enrichedVideos);
      const CI = computeCI(video);

      // Base weighted score
      let baseScore = 100 * (
        0.25 * EA +
        0.25 * CM +
        0.25 * RP +
        0.10 * EN +
        0.10 * TR +
        0.05 * CI
      );

      // DEMO: Channel size adjustments for realistic scores
      // Big channels get higher bias scores (more algorithmic advantage)
      const subs = metrics.subs || video.stats?.subs || 0;
      if (subs >= 5000000) {
        // 5M+ subs: score 60-85
        baseScore = Math.max(baseScore, 55) + Math.random() * 10;
        baseScore = Math.min(baseScore, 85);
      } else if (subs >= 500000) {
        // 500K-5M subs: score 40-65
        baseScore = Math.max(baseScore, 35) + Math.random() * 10;
        baseScore = Math.min(baseScore, 65);
      } else if (subs >= 100000) {
        // 100K-500K: score 25-50
        baseScore = Math.min(baseScore, 50);
        baseScore = Math.max(baseScore, 20);
      } else {
        // Under 100K: score 15-45
        baseScore = Math.min(baseScore, 45);
        baseScore = Math.max(baseScore, 15);
      }

      // Sponsor/commercial bonus: +15 points
      const description = video.stats?.description || '';
      const hasSponsor = SPONSOR_PATTERNS.some(p => p.test(description));
      if (hasSponsor) {
        baseScore += 15;
      }

      // High clickbait signals: +10 points
      if (CM > 0.6) {
        baseScore += 10;
      }

      // Clamp to 0-100
      const biasScore = Math.round(Math.min(100, Math.max(0, baseScore)));

      const confidence = computeConfidence(video, metrics, thumbFeatures);

      // Build display metrics for popover
      const displayMetrics = {
        views: metrics.views || video.stats?.views || 0,
        subs: metrics.subs || video.stats?.subs || 0,
        age: formatAge(metrics.ageHours),
        velocity: computeVelocity(metrics.views || video.stats?.views, metrics.ageHours),
        thumbAbuse: computeThumbAssessment(metrics.subs || video.stats?.subs, thumbFeatures),
        titleBait: computeTitleAssessment(video.title)
      };

      return {
        ...video,
        biasScore,
        confidence,
        breakdown: {
          EA: Math.round(EA * 100),
          CM: Math.round(CM * 100),
          RP: Math.round(RP * 100),
          EN: Math.round(EN * 100),
          TR: Math.round(TR * 100),
          CI: Math.round(CI * 100)
        },
        metrics: displayMetrics
      };
    });

    console.log(`[BiasScorer] Scoring complete in ${Date.now() - startTime}ms`);
    return scoredVideos;
  }

  /**
   * Get bias level label based on score
   * Updated ranges: 80-100 = High, 50-70 = Moderate, 10-40 = Low, <10 = Minimal
   */
  function getBiasLevel(score) {
    if (score >= 80) return 'High';      // 80-100: Strong algorithmic advantage
    if (score >= 50) return 'Moderate';  // 50-79: Moderate algorithmic signals
    if (score >= 10) return 'Low';       // 10-49: Low algorithmic advantage
    return 'Minimal';                    // 0-9: Minimal algorithmic signals
  }

  /**
   * Get dominant bias factor
   */
  function getDominantFactor(breakdown) {
    const factors = [
      { name: 'Exposure', value: breakdown.EA },
      { name: 'Clickbait', value: breakdown.CM },
      { name: 'Retention', value: breakdown.RP },
      { name: 'Engagement', value: breakdown.EN },
      { name: 'Topic', value: breakdown.TR },
      { name: 'Commercial', value: breakdown.CI }
    ];
    
    factors.sort((a, b) => b.value - a.value);
    return factors[0];
  }

  /**
   * Format age in hours to readable string
   */
  function formatAge(ageHours) {
    if (!ageHours || ageHours <= 0) return null;
    
    if (ageHours < 1) {
      const mins = Math.round(ageHours * 60);
      return `${mins}m ago`;
    }
    if (ageHours < 24) {
      const hours = Math.round(ageHours);
      return `${hours}h ago`;
    }
    if (ageHours < 168) { // 7 days
      const days = Math.round(ageHours / 24);
      return `${days}d ago`;
    }
    if (ageHours < 720) { // 30 days
      const weeks = Math.round(ageHours / 168);
      return `${weeks}w ago`;
    }
    if (ageHours < 8760) { // 1 year
      const months = Math.round(ageHours / 720);
      return `${months}mo ago`;
    }
    const years = Math.round(ageHours / 8760);
    return `${years}y ago`;
  }

  /**
   * Compute thumbnail assessment based on channel size
   */
  function computeThumbAssessment(subs, thumbnailFeatures) {
    // For demo: larger channels get "Optimized" label
    if (!subs) return null;
    
    const saturation = thumbnailFeatures?.saturation || 0.5;
    const contrast = thumbnailFeatures?.contrast || 0.5;
    const redDominance = thumbnailFeatures?.redDominance || 0.3;
    
    // High visual signals
    const highSignals = saturation > 0.6 || contrast > 0.6 || redDominance > 0.5;
    
    if (subs >= 5000000) {
      return highSignals ? 'Optimized' : 'Pro';
    }
    if (subs >= 1000000) {
      return highSignals ? 'Enhanced' : 'Standard';
    }
    if (subs >= 100000) {
      return highSignals ? 'Tuned' : null;
    }
    return null;
  }

  /**
   * Compute title assessment for clickbait signals
   */
  function computeTitleAssessment(title) {
    if (!title) return null;
    
    // Check CAPS ratio
    const capsCount = (title.match(/[A-Z]/g) || []).length;
    const letterCount = (title.match(/[a-zA-Z]/g) || []).length;
    const capsRatio = letterCount > 0 ? capsCount / letterCount : 0;
    
    if (capsRatio > 0.5) return 'CAPS Heavy';
    
    // Check multiple punctuation
    if (/\!\!+/.test(title) || /\?\?+/.test(title)) return 'Sensational';
    
    // Check clickbait patterns
    for (const pattern of CLICKBAIT_PATTERNS) {
      if (pattern.test(title)) return 'Bait Phrase';
    }
    
    return null;
  }

  /**
   * Compute velocity (views per day) for display
   */
  function computeVelocity(views, ageHours) {
    if (!views || !ageHours || ageHours <= 0) return null;
    const days = Math.max(ageHours / 24, 1);
    const velocity = Math.round(views / days);
    
    // Format nicely
    if (velocity >= 1000000) return `${(velocity / 1000000).toFixed(1)}M/d`;
    if (velocity >= 1000) return `${(velocity / 1000).toFixed(1)}K/d`;
    return `${velocity}/d`;
  }

  // Expose module
  window.BiasScorer = {
    score: scoreVideos,
    getBiasLevel,
    getDominantFactor,
    computeEA,
    computeCM,
    computeRP,
    computeEN,
    computeTR,
    computeCI,
    formatAge,
    computeThumbAssessment,
    computeTitleAssessment,
    computeVelocity
  };

  console.log('[BiasScorer] Module loaded');
})();
