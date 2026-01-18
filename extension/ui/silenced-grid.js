/**
 * Silenced Grid Component
 * 
 * Renders an alternative video feed when "Silenced" tab is active.
 * Shows high-quality videos that are under-exposed relative to their quality.
 */

;(function() {
'use strict';

// ============================================
// CONSTANTS
// ============================================

const GRID_ID = 'silenced-feed'
const GRID_CLASS = 'silenced-grid'

// ============================================
// STATE
// ============================================

let gridElement = null
let silencedVideos = []
let isVisible = false
let originalFeedDisplay = null

// ============================================
// GRID CREATION
// ============================================

/**
 * Create the silenced grid container
 */
function createGridElement() {
  const grid = document.createElement('div')
  grid.id = GRID_ID
  grid.className = GRID_CLASS
  
  grid.innerHTML = `
    <div class="silenced-header">
      <div class="silenced-title-row">
        <h2 class="silenced-title">Limited Reach</h2>
        <span class="silenced-subtitle">Content with strong engagement that gets less visibility</span>
      </div>
      <div class="silenced-stats">
        <span class="stat-item">
          <span class="stat-value" id="silenced-total">0</span>
          <span class="stat-label">videos</span>
        </span>
        <span class="stat-item">
          <span class="stat-value" id="silenced-avg-quality">--</span>
          <span class="stat-label">avg strength</span>
        </span>
      </div>
    </div>
    <div class="silenced-content">
      <div class="silenced-loading">
        <div class="loading-spinner"></div>
        <span>Finding underexposed content...</span>
      </div>
      <div class="silenced-videos"></div>
      <div class="silenced-empty" style="display: none;">
        <span class="empty-text">No limited-reach videos found for your current topics.</span>
      </div>
      <div class="silenced-ai-offline" style="display: none;">
        <span class="offline-title">Quality verification unavailable</span>
        <span class="offline-text">Cannot verify content quality. Results would be unreliable.</span>
        <span class="offline-hint">The backend may be down. Try again later.</span>
      </div>
      <div class="silenced-insufficient" style="display: none;">
        <span class="insufficient-title">Not enough data</span>
        <span class="insufficient-text">Scroll to load more videos so we can understand your interests.</span>
      </div>
    </div>
  `
  
  return grid
}

/**
 * Create a video card element - YouTube native style with silenced badges
 * Handles both legacy format and new SilencedFinder format
 */
function createVideoCard(video) {
  const card = document.createElement('div')
  card.className = 'silenced-card'
  
  // Extract data - support both old and new formats
  const videoId = video.videoId || video.silencedVideo?.videoId
  const title = video.title || video.silencedVideo?.title || 'Unknown'
  const channelName = video.channel || video.channelName || video.silencedVideo?.channelName || 'Unknown Channel'
  const thumbnail = video.thumbnail || video.thumbnailUrl || video.silencedVideo?.thumbnailUrl || 
                   (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '')
  
  // Get stats from either format
  const stats = video.stats || video.silencedVideo?.stats || {}
  const channel = video.channel || video.silencedVideo?.channel || {}
  const views = stats.views || video.views || 0
  const durationSec = stats.durationSec || video.duration || 0
  const publishedAt = stats.publishedAt || video.publishedAt || video.silencedVideo?.publishedAt || ''
  const subs = channel.subs || video.subs || 0
  
  // Get noise video comparison data (from new pipeline)
  const noiseVideoTitle = video.noiseVideoTitle || null
  const noiseVideoChannel = video.noiseVideoChannel || null
  const noiseVideoId = video.noiseVideoId || null
  const noiseThumbnail = noiseVideoId ? `https://i.ytimg.com/vi/${noiseVideoId}/mqdefault.jpg` : null
  
  // Get 4-section AI explanation data
  const aiExplanation = video.aiExplanation || null // Legacy single string
  const fullExplanation = video.fullExplanation || null
  const whySilencedAI = video.whySilencedAI || video.aiExplanation?.whySilenced || null
  const whoAffectedAI = video.whoAffectedAI || video.aiExplanation?.whoAffected || null
  const whyMattersAI = video.whyMattersAI || video.aiExplanation?.whyMatters || null
  const counterfactualAI = video.counterfactualAI || video.aiExplanation?.counterfactual || null
  
  // Quality score
  const qualityScore = video.qualityScore || 0
  
  // Calculate gap: difference between quality and expected visibility
  // Higher quality with low subs = bigger positive gap (underexposed)
  const exposureScore = subs > 0 ? Math.min(100, Math.round((subs / 100000) * 100)) : 0
  const gap = qualityScore - exposureScore
  
  // Why silenced data
  const whySilenced = video.whySilenced || {}
  
  // Get "why good" and "why buried" from video data or generate from metrics
  let whyGood = video.whyGood || []
  let whyBuried = video.whyBuried || []
  
  // If not provided, generate reasons from metrics
  if (whyGood.length === 0) {
    if (whySilenced.likeRate && whySilenced.likeRate > 3) {
      whyGood.push(`${whySilenced.likeRate}% like rate`)
    } else if (stats.likes && views > 0) {
      const likeRate = Math.round((stats.likes / views) * 1000) / 10
      if (likeRate > 3) whyGood.push(`${likeRate}% like rate`)
    }
    
    if (subs > 0 && subs < 50000) {
      whyGood.push('Small creator')
    } else if (subs > 0 && subs < 100000) {
      whyGood.push('Growing channel')
    }
    
    if (durationSec > 600) {
      whyGood.push('In-depth content')
    }
  }
  
  // If not provided, generate why buried reasons
  if (whyBuried.length === 0) {
    if (subs > 0 && subs < 100000) {
      whyBuried.push(`Only ${formatViews(subs)} subscribers`)
    }
    if (views > 0 && views < 100000 && qualityScore > 50) {
      whyBuried.push('High quality, low reach')
    } else if (views > 0) {
      whyBuried.push('Lower algorithmic advantage')
    }
  }
  
  card.dataset.videoId = videoId
  
  // Generate summary line based on quality and gap
  const summaryLine = gap >= 10
    ? 'Strong engagement despite limited distribution'
    : gap >= 5
      ? 'Good engagement, lower visibility'
      : 'Good content with visibility gap'

  // Get first reason as short bullet
  const whyLimited = (video.whyBuried || [])[0] || 'Lower platform-favored signals'
  const whyGoodList = (video.whyGood || []).slice(0, 2)

  // Build comprehensive 4-section AI explanation
  const hasAIExplanation = fullExplanation || whySilencedAI || whyMattersAI
  
  const aiSection = hasAIExplanation ? `
    <div class="ai-analysis-container">
      <div class="ai-analysis-header">
        <span class="ai-icon">✨</span>
        <span class="ai-header-text">AI Analysis</span>
        <span class="ai-expand-btn" data-ai-expand>▸</span>
      </div>
      <div class="ai-analysis-content" style="display: none;">
        ${whySilencedAI ? `
          <div class="ai-section">
            <div class="ai-section-title">🔇 Why This Content Is Silenced</div>
            <div class="ai-section-text">${escapeHtml(whySilencedAI)}</div>
          </div>
        ` : ''}
        ${whoAffectedAI ? `
          <div class="ai-section">
            <div class="ai-section-title">👤 Who Is Affected</div>
            <div class="ai-section-text">${escapeHtml(whoAffectedAI)}</div>
          </div>
        ` : ''}
        ${whyMattersAI ? `
          <div class="ai-section">
            <div class="ai-section-title">💡 Why This Content Still Matters</div>
            <div class="ai-section-text">${escapeHtml(whyMattersAI)}</div>
          </div>
        ` : ''}
        ${counterfactualAI ? `
          <div class="ai-section counterfactual">
            <div class="ai-section-title">🔮 If Surfaced Equally</div>
            <div class="ai-section-text">${escapeHtml(counterfactualAI)}</div>
          </div>
        ` : ''}
      </div>
    </div>
  ` : (aiExplanation && typeof aiExplanation === 'string' ? `
    <div class="ai-explanation">
      <span class="ai-icon">✨</span>
      <span class="ai-text">${escapeHtml(aiExplanation)}</span>
    </div>
  ` : '')
  
  // Build comparison section with noise video thumbnail
  const comparisonSection = noiseVideoTitle ? `
    <div class="comparison-section" data-noise-title="${escapeHtml(noiseVideoTitle)}" data-noise-channel="${escapeHtml(noiseVideoChannel || '')}">
      <div class="comparison-label">🔊 Compared to (Noise Video):</div>
      <div class="comparison-content">
        ${noiseThumbnail ? `<img class="noise-thumbnail" src="${noiseThumbnail}" alt="" loading="lazy">` : ''}
        <div class="comparison-info">
          <div class="comparison-title">${escapeHtml(noiseVideoTitle.slice(0, 50))}${noiseVideoTitle.length > 50 ? '...' : ''}</div>
          ${noiseVideoChannel ? `<div class="comparison-channel">by ${escapeHtml(noiseVideoChannel)}</div>` : ''}
        </div>
      </div>
    </div>
  ` : ''

  card.innerHTML = `
    <a href="https://www.youtube.com/watch?v=${videoId}" class="card-link" target="_blank">
      <div class="card-thumbnail">
        <img src="${thumbnail}" alt="" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${videoId}/mqdefault.jpg'">
        <span class="card-duration">${durationSec > 0 ? formatDuration(durationSec) : ''}</span>
        <div class="silenced-badge">
          <span class="badge-icon">🔇</span>
          <span class="badge-text">Limited Reach</span>
        </div>
      </div>
      <div class="card-details">
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-channel">${escapeHtml(channelName)}</div>
        <div class="card-meta">
          ${views > 0 ? formatViews(views) + ' views' : ''}${views > 0 && publishedAt ? ' · ' : ''}${publishedAt ? formatAge(publishedAt) : ''}
        </div>
      </div>
    </a>
    <div class="card-summary">
      <div class="summary-badges">
        ${qualityScore > 0 ? `<span class="badge-strength" title="Quality score based on engagement">Q: ${qualityScore}</span>` : ''}
        ${subs > 0 ? `<span class="subs-pill" title="Channel subscribers">${formatViews(subs)} subs</span>` : ''}
        ${gap > 0 ? `<span class="badge-gap positive" title="Quality vs visibility gap">+${gap} gap</span>` : ''}
      </div>
      ${comparisonSection}
      ${aiSection}
    </div>
    <div class="card-expand-toggle collapsed" data-expand>
      <span class="expand-label">Why it's underexposed</span>
      <span class="expand-chevron">▸</span>
    </div>
    <div class="card-details-expanded" style="display: none;">
      ${whyBuried.length > 0 ? `
        <div class="detail-section">
          <div class="detail-title">Why limited reach</div>
          ${whyBuried.slice(0, 2).map(r => `<div class="detail-bullet">• ${escapeHtml(r)}</div>`).join('')}
        </div>
      ` : ''}
      ${whyGood.length > 0 ? `
        <div class="detail-section">
          <div class="detail-title">Why it deserves visibility</div>
          ${whyGood.slice(0, 3).map(r => `<div class="detail-bullet">• ${escapeHtml(r)}</div>`).join('')}
        </div>
      ` : ''}
    </div>
  `

  // Add expand/collapse handler for "Why underexposed" section
  const toggleEl = card.querySelector('[data-expand]')
  const detailsEl = card.querySelector('.card-details-expanded')
  if (toggleEl && detailsEl) {
    toggleEl.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const isCollapsed = toggleEl.classList.contains('collapsed')
      toggleEl.classList.toggle('collapsed', !isCollapsed)
      toggleEl.querySelector('.expand-chevron').textContent = isCollapsed ? '▾' : '▸'
      detailsEl.style.display = isCollapsed ? 'block' : 'none'
    })
  }

  // Add expand/collapse handler for AI Analysis section
  const aiExpandBtn = card.querySelector('[data-ai-expand]')
  const aiContent = card.querySelector('.ai-analysis-content')
  if (aiExpandBtn && aiContent) {
    aiExpandBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const isHidden = aiContent.style.display === 'none'
      aiContent.style.display = isHidden ? 'block' : 'none'
      aiExpandBtn.textContent = isHidden ? '▾' : '▸'
    })
    
    // Also make the header clickable
    const aiHeader = card.querySelector('.ai-analysis-header')
    if (aiHeader) {
      aiHeader.style.cursor = 'pointer'
      aiHeader.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const isHidden = aiContent.style.display === 'none'
        aiContent.style.display = isHidden ? 'block' : 'none'
        aiExpandBtn.textContent = isHidden ? '▾' : '▸'
      })
    }
  }

  return card
}

/**
 * Get grid styles
 */
function getGridStyles() {
  return `
    .silenced-grid {
      display: none;
      padding: 0 24px;
      max-width: 1284px;
      margin: 0 auto;
    }
    
    .silenced-grid.visible {
      display: block;
    }
    
    /* Header */
    .silenced-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 16px 0;
      margin-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .silenced-title-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .silenced-title {
      font-size: 15px;
      font-weight: 500;
      color: #e8e8e8;
      margin: 0;
    }

    .silenced-subtitle {
      font-size: 13px;
      color: #666;
      margin-top: 2px;
    }
    
    .silenced-stats {
      display: flex;
      gap: 16px;
    }
    
    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 12px;
      background: #1a1a1a;
      border-radius: 6px;
    }

    .stat-item .stat-value {
      font-size: 15px;
      font-weight: 500;
      color: #e8e8e8;
    }

    .stat-item .stat-label {
      font-size: 11px;
      color: #666;
    }
    
    /* Content */
    .silenced-content {
      min-height: 400px;
    }
    
    .silenced-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 60px 0;
      color: #888;
    }
    
    .loading-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(16, 185, 129, 0.2);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .silenced-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 48px 0;
    }

    .empty-text {
      font-size: 13px;
      color: #666;
    }
    
    /* Offline State */
    .silenced-ai-offline {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 48px 20px;
      color: #eab308;
      background: #141414;
      border-radius: 8px;
      margin: 20px 0;
    }

    .offline-title {
      font-size: 15px;
      font-weight: 500;
      color: #e8e8e8;
    }

    .offline-text {
      font-size: 13px;
      color: #666;
      text-align: center;
      max-width: 360px;
    }

    .offline-hint {
      font-size: 11px;
      color: #555;
      text-align: center;
    }

    /* Insufficient Data State */
    .silenced-insufficient {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 48px 20px;
      background: #141414;
      border-radius: 8px;
      margin: 20px 0;
    }

    .insufficient-title {
      font-size: 15px;
      font-weight: 500;
      color: #e8e8e8;
    }

    .insufficient-text {
      font-size: 13px;
      color: #666;
      text-align: center;
      max-width: 360px;
    }
    
    /* Video Grid - YouTube native style */
    .silenced-videos {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
      gap: 16px 16px;
    }
    
    @media (min-width: 1200px) {
      .silenced-videos {
        grid-template-columns: repeat(4, 1fr);
      }
    }
    
    @media (min-width: 1600px) {
      .silenced-videos {
        grid-template-columns: repeat(5, 1fr);
      }
    }
    
    /* Video Card - YouTube native style */
    .silenced-card {
      background: transparent;
      border: none;
      border-radius: 12px;
      overflow: hidden;
      transition: transform 0.1s ease;
      transition: opacity 0.12s ease-out, transform 0.12s ease-out;
    }

    .silenced-card:hover {
      background: #1a1a1a;
      transform: translateY(-1px);
    }
    
    .card-link {
      text-decoration: none;
      color: inherit;
    }
    
    .card-thumbnail {
      position: relative;
      aspect-ratio: 16/9;
      background: #000;
      overflow: hidden;
    }
    
    .card-thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.3s ease;
    }
    
    .silenced-card:hover .card-thumbnail img {
      transform: scale(1.05);
    }
    
    .card-duration {
      position: absolute;
      bottom: 8px;
      right: 8px;
      padding: 2px 6px;
      background: rgba(0, 0, 0, 0.8);
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      color: #fff;
    }
    
    /* Silenced Badge on thumbnail */
    .silenced-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: rgba(16, 185, 129, 0.9);
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      color: #fff;
    }
    
    .silenced-badge .badge-icon {
      font-size: 11px;
    }
    
    .card-details {
      padding: 12px;
    }
    
    .card-title {
      font-size: 14px;
      font-weight: 500;
      color: #fff;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 6px;
    }
    
    .card-channel {
      font-size: 12px;
      color: #aaa;
      margin-bottom: 4px;
    }
    
    .card-meta {
      font-size: 11px;
      color: #888;
    }
    
    /* Scores */
    .silenced-scores {
      display: flex;
      gap: 6px;
      padding: 0 12px;
      flex-wrap: wrap;
    }
    
    /* Card Summary - Always visible */
    .card-summary {
      padding: 10px 12px;
    }

    .summary-badges {
      display: flex;
      gap: 8px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }
    
    .subs-pill {
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 3px;
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
    }

    .badge-strength {
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 3px;
      background: rgba(34, 197, 94, 0.1);
      color: #22c55e;
    }

    .summary-line {
      font-size: 13px;
      color: #999;
      line-height: 1.4;
    }
    
    /* AI Explanation - Legacy single-line */
    .ai-explanation {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 8px 10px;
      background: rgba(139, 92, 246, 0.1);
      border-radius: 6px;
      margin-top: 8px;
    }
    
    .ai-explanation .ai-icon {
      font-size: 12px;
      flex-shrink: 0;
    }
    
    .ai-explanation .ai-text {
      font-size: 12px;
      color: #c4b5fd;
      line-height: 1.4;
    }
    
    /* 4-Section AI Analysis Container */
    .ai-analysis-container {
      margin-top: 10px;
      background: rgba(139, 92, 246, 0.08);
      border-radius: 8px;
      border: 1px solid rgba(139, 92, 246, 0.2);
      overflow: hidden;
    }
    
    .ai-analysis-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: rgba(139, 92, 246, 0.15);
      cursor: pointer;
      transition: background 0.15s ease;
    }
    
    .ai-analysis-header:hover {
      background: rgba(139, 92, 246, 0.2);
    }
    
    .ai-analysis-header .ai-icon {
      font-size: 14px;
    }
    
    .ai-analysis-header .ai-header-text {
      flex: 1;
      font-size: 12px;
      font-weight: 600;
      color: #c4b5fd;
    }
    
    .ai-analysis-header .ai-expand-btn {
      font-size: 12px;
      color: #a78bfa;
      transition: transform 0.15s ease;
    }
    
    .ai-analysis-content {
      padding: 12px;
    }
    
    .ai-section {
      margin-bottom: 14px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(139, 92, 246, 0.1);
    }
    
    .ai-section:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }
    
    .ai-section-title {
      font-size: 11px;
      font-weight: 600;
      color: #a78bfa;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .ai-section-text {
      font-size: 12px;
      color: #d4d4d4;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    
    .ai-section.counterfactual {
      background: rgba(34, 197, 94, 0.08);
      padding: 10px;
      border-radius: 6px;
      border: none;
      margin-top: 4px;
    }
    
    .ai-section.counterfactual .ai-section-title {
      color: #4ade80;
    }
    
    .ai-section.counterfactual .ai-section-text {
      color: #86efac;
      font-style: italic;
    }
    
    /* Comparison Section with Noise Video Thumbnail */
    .comparison-section {
      margin-top: 10px;
      padding: 10px;
      background: rgba(249, 115, 22, 0.08);
      border-radius: 8px;
      border: 1px solid rgba(249, 115, 22, 0.2);
    }
    
    .comparison-section .comparison-label {
      font-size: 10px;
      font-weight: 600;
      color: #fb923c;
      margin-bottom: 8px;
    }
    
    .comparison-section .comparison-content {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .comparison-section .noise-thumbnail {
      width: 80px;
      height: 45px;
      border-radius: 4px;
      object-fit: cover;
      flex-shrink: 0;
    }
    
    .comparison-section .comparison-info {
      flex: 1;
      min-width: 0;
    }
    
    .comparison-section .comparison-title {
      font-size: 12px;
      color: #fdba74;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    
    .comparison-section .comparison-channel {
      font-size: 10px;
      color: #888;
      margin-top: 2px;
    }
    
    /* Legacy comparison hint (deprecated) */
    .comparison-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding: 6px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    
    .comparison-hint .comparison-label {
      font-size: 10px;
      color: #666;
      flex-shrink: 0;
    }
    
    .comparison-hint .comparison-video {
      font-size: 11px;
      color: #888;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    /* Badge Gap */
    .badge-gap {
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 3px;
      background: rgba(249, 115, 22, 0.1);
      color: #f97316;
    }
    
    .badge-gap.positive {
      background: rgba(34, 197, 94, 0.1);
      color: #22c55e;
    }

    /* Expand Toggle */
    .card-expand-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      cursor: pointer;
      transition: background 0.1s ease-out;
    }

    .card-expand-toggle:hover {
      background: #1a1a1a;
    }

    .expand-label {
      font-size: 11px;
      color: #666;
    }

    .expand-chevron {
      font-size: 10px;
      color: #555;
      transition: transform 0.1s ease-out;
    }

    /* Expanded Details - Hidden by default */
    .card-details-expanded {
      padding: 0 12px 12px;
    }

    .detail-section {
      margin-bottom: 10px;
    }

    .detail-section:last-child {
      margin-bottom: 0;
    }

    .detail-title {
      font-size: 11px;
      color: #555;
      margin-bottom: 4px;
    }

    .detail-bullet {
      font-size: 13px;
      color: #999;
      line-height: 1.5;
      padding-left: 2px;
    }
    
    /* Responsive */
    @media (max-width: 700px) {
      .silenced-grid {
        padding: 0 12px;
      }
      
      .silenced-header {
        flex-direction: column;
        gap: 12px;
      }
      
      .silenced-videos {
        grid-template-columns: 1fr;
      }
    }
  `
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds) {
  if (!seconds) return '--:--'
  
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Format view count
 */
function formatViews(views) {
  if (!views) return '0'
  
  if (views >= 1000000000) return (views / 1000000000).toFixed(1) + 'B'
  if (views >= 1000000) return (views / 1000000).toFixed(1) + 'M'
  if (views >= 1000) return (views / 1000).toFixed(1) + 'K'
  
  return views.toString()
}

/**
 * Format age (time since published)
 */
function formatAge(publishedAt) {
  if (!publishedAt) return ''
  
  const now = new Date()
  const published = new Date(publishedAt)
  const diffMs = now - published
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return '1 day ago'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
  
  return `${Math.floor(diffDays / 365)} years ago`
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return ''
  
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ============================================
// GRID INJECTION
// ============================================

/**
 * Find the main feed container
 */
function findFeedContainer() {
  // Find the actual video items container, not the whole grid
  // This allows us to hide just videos while keeping our injected elements
  const selectors = [
    'ytd-rich-grid-renderer #contents',    // The contents area with videos
    '#contents.ytd-rich-grid-renderer',
    'ytd-two-column-browse-results-renderer #primary #contents',
    '#primary ytd-rich-grid-renderer',
    '#contents'
  ]
  
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) return element
  }
  
  console.warn('[BiasLens] Could not find feed container')
  return null
}

/**
 * Inject the grid into the page
 */
function injectGrid() {
  if (document.getElementById(GRID_ID)) {
    gridElement = document.getElementById(GRID_ID)
    return gridElement
  }
  
  injectStyles()
  
  const feedContainer = findFeedContainer()
  if (!feedContainer) {
    console.warn('[BiasLens] Could not find feed container')
    return null
  }
  
  gridElement = createGridElement()
  
  // Insert before the feed
  feedContainer.parentNode.insertBefore(gridElement, feedContainer)
  
  console.log('[BiasLens] Silenced grid injected')
  
  return gridElement
}

/**
 * Inject grid styles
 */
function injectStyles() {
  const styleId = 'silenced-grid-styles'
  
  if (document.getElementById(styleId)) {
    return
  }
  
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = getGridStyles()
  document.head.appendChild(style)
}

// ============================================
// STATE MANAGEMENT
// ============================================

/**
 * Show the silenced grid and hide YouTube's feed
 */
function show() {
  // #region agent log H2
  fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'silenced-grid.js:show',message:'show() called',data:{gridExists:!!gridElement,currentVisibility:isVisible},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2'})}).catch(()=>{});
  // #endregion

  if (!gridElement) {
    injectGrid()
  }
  
  if (gridElement) {
    gridElement.classList.add('visible')
    isVisible = true
    // #region agent log H4
    fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'silenced-grid.js:show:visible',message:'Grid set to visible',data:{hasVisibleClass:gridElement.classList.contains('visible')},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
  }
  
  // DO NOT hide YouTube's native feed - silenced grid shows ON TOP of the feed
  // The original feed should always remain visible
  // hideNativeVideos() - REMOVED
}

/**
 * Hide YouTube's native video items
 */
function hideNativeVideos() {
  // Hide individual video rows/items, not the whole container
  const videoSelectors = [
    'ytd-rich-grid-row',
    'ytd-rich-item-renderer',
    'ytd-rich-section-renderer'
  ]
  
  for (const selector of videoSelectors) {
    const elements = document.querySelectorAll(selector)
    elements.forEach(el => {
      if (!el.dataset.originalDisplay) {
        el.dataset.originalDisplay = el.style.display || ''
      }
      el.style.display = 'none'
    })
  }
}

/**
 * Show YouTube's native video items
 */
function showNativeVideos() {
  const videoSelectors = [
    'ytd-rich-grid-row',
    'ytd-rich-item-renderer',
    'ytd-rich-section-renderer'
  ]
  
  for (const selector of videoSelectors) {
    const elements = document.querySelectorAll(selector)
    elements.forEach(el => {
      el.style.display = el.dataset.originalDisplay || ''
    })
  }
}

/**
 * Hide the silenced grid (YouTube's feed stays visible always)
 */
function hide() {
  if (gridElement) {
    gridElement.classList.remove('visible')
    isVisible = false
  }
  
  // YouTube's feed is always visible, no need to restore
  // showNativeVideos() - REMOVED
}

/**
 * Update the grid with silenced videos
 */
function updateVideos(videos) {
  // #region agent log H3
  fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'silenced-grid.js:updateVideos:entry',message:'updateVideos called',data:{videosCount:videos?.length||0,gridExists:!!gridElement,firstVideoId:videos?.[0]?.videoId||'none'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
  // #endregion

  if (!gridElement) {
    injectGrid()
  }
  
  silencedVideos = videos || []
  
  const videosContainer = gridElement.querySelector('.silenced-videos')
  const loadingEl = gridElement.querySelector('.silenced-loading')
  const emptyEl = gridElement.querySelector('.silenced-empty')
  
  // Hide loading
  if (loadingEl) loadingEl.style.display = 'none'
  
  // Clear existing videos
  if (videosContainer) {
    videosContainer.innerHTML = ''
  }
  
  if (silencedVideos.length === 0) {
    // #region agent log H5
    fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'silenced-grid.js:updateVideos:empty',message:'No videos to show',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    // Show empty state
    if (emptyEl) emptyEl.style.display = 'flex'
    // Reset stats to show 0
    const totalEl = gridElement.querySelector('#silenced-total')
    const avgQualityEl = gridElement.querySelector('#silenced-avg-quality')
    const avgGapEl = gridElement.querySelector('#silenced-avg-gap')
    if (totalEl) totalEl.textContent = '0'
    if (avgQualityEl) avgQualityEl.textContent = '--'
    if (avgGapEl) avgGapEl.textContent = '+0'
    return
  }
  
  // Hide empty state
  if (emptyEl) emptyEl.style.display = 'none'
  
  // Add video cards
  // #region agent log H3
  fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'silenced-grid.js:updateVideos:addCards',message:'Adding video cards',data:{count:silencedVideos.length,containerExists:!!videosContainer},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  for (const video of silencedVideos) {
    const card = createVideoCard(video)
    videosContainer.appendChild(card)
  }
  
  // Update stats
  updateStats()
}

/**
 * Update stats in header
 */
function updateStats() {
  if (!gridElement || silencedVideos.length === 0) return
  
  const totalEl = gridElement.querySelector('#silenced-total')
  const avgQualityEl = gridElement.querySelector('#silenced-avg-quality')
  
  if (totalEl) {
    totalEl.textContent = silencedVideos.length
  }
  
  if (avgQualityEl) {
    const avgQuality = Math.round(
      silencedVideos.reduce((sum, v) => sum + (v.qualityScore || 0), 0) / silencedVideos.length
    )
    avgQualityEl.textContent = avgQuality
  }
}

/**
 * Show loading state
 */
function showLoading() {
  if (!gridElement) {
    injectGrid()
  }
  
  const loadingEl = gridElement.querySelector('.silenced-loading')
  const videosContainer = gridElement.querySelector('.silenced-videos')
  const emptyEl = gridElement.querySelector('.silenced-empty')
  const aiOfflineEl = gridElement.querySelector('.silenced-ai-offline')
  const insufficientEl = gridElement.querySelector('.silenced-insufficient')
  
  if (loadingEl) loadingEl.style.display = 'flex'
  if (videosContainer) videosContainer.innerHTML = ''
  if (emptyEl) emptyEl.style.display = 'none'
  if (aiOfflineEl) aiOfflineEl.style.display = 'none'
  if (insufficientEl) insufficientEl.style.display = 'none'
}

/**
 * Show AI offline state - when Gemini/backend is not available
 */
function showAIOffline(message = '') {
  if (!gridElement) {
    injectGrid()
  }
  
  const loadingEl = gridElement.querySelector('.silenced-loading')
  const videosContainer = gridElement.querySelector('.silenced-videos')
  const emptyEl = gridElement.querySelector('.silenced-empty')
  const aiOfflineEl = gridElement.querySelector('.silenced-ai-offline')
  const insufficientEl = gridElement.querySelector('.silenced-insufficient')
  
  if (loadingEl) loadingEl.style.display = 'none'
  if (videosContainer) videosContainer.innerHTML = ''
  if (emptyEl) emptyEl.style.display = 'none'
  if (aiOfflineEl) {
    aiOfflineEl.style.display = 'flex'
    if (message) {
      const textEl = aiOfflineEl.querySelector('.offline-text')
      if (textEl) textEl.textContent = message
    }
  }
  if (insufficientEl) insufficientEl.style.display = 'none'
  
  console.log('[BiasLens] Showing AI offline state')
}

/**
 * Show insufficient data state - when not enough homepage videos to analyze
 */
function showInsufficientData(message = '') {
  if (!gridElement) {
    injectGrid()
  }
  
  const loadingEl = gridElement.querySelector('.silenced-loading')
  const videosContainer = gridElement.querySelector('.silenced-videos')
  const emptyEl = gridElement.querySelector('.silenced-empty')
  const aiOfflineEl = gridElement.querySelector('.silenced-ai-offline')
  const insufficientEl = gridElement.querySelector('.silenced-insufficient')
  
  if (loadingEl) loadingEl.style.display = 'none'
  if (videosContainer) videosContainer.innerHTML = ''
  if (emptyEl) emptyEl.style.display = 'none'
  if (aiOfflineEl) aiOfflineEl.style.display = 'none'
  if (insufficientEl) {
    insufficientEl.style.display = 'flex'
    if (message) {
      const textEl = insufficientEl.querySelector('.insufficient-text')
      if (textEl) textEl.textContent = message
    }
  }
  
  console.log('[BiasLens] Showing insufficient data state')
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Initialize grid
 */
function init() {
  injectStyles()
}

/**
 * Remove grid
 */
function remove() {
  if (gridElement) {
    gridElement.remove()
    gridElement = null
  }
  
  // Restore native feed
  const nativeFeed = findFeedContainer()
  if (nativeFeed) {
    nativeFeed.style.display = originalFeedDisplay || ''
  }
}

/**
 * Check if grid is visible
 */
function isGridVisible() {
  return isVisible
}

/**
 * Get current videos
 */
function getVideos() {
  return silencedVideos
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.SilencedGrid = {
    init,
    show,
    hide,
    remove,
    updateVideos,
    showLoading,
    showAIOffline,
    showInsufficientData,
    isGridVisible,
    getVideos,
    GRID_ID
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    init,
    show,
    hide,
    remove,
    updateVideos,
    showLoading,
    showAIOffline,
    showInsufficientData,
    isGridVisible,
    getVideos,
    GRID_ID
  }
}

})(); // End IIFE
