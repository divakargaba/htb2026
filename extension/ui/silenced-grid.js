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
        <span class="stat-item">
          <span class="stat-value" id="silenced-avg-gap">--</span>
          <span class="stat-label">reach gap</span>
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
 * Create a video card element
 */
function createVideoCard(video) {
  const card = document.createElement('div')
  card.className = 'silenced-card'
  card.dataset.videoId = video.videoId
  
  // Calculate gap display
  const gap = video.exposureGap || (video.qualityScore - video.visibilityScore)
  const gapSign = gap >= 0 ? '+' : ''
  
  // Generate summary line based on quality and gap
  const summaryLine = gap >= 10
    ? 'Strong engagement despite limited distribution'
    : gap >= 5
      ? 'Good engagement, lower visibility'
      : 'Solid content with reach gap'

  // Get first reason as short bullet
  const whyLimited = (video.whyBuried || [])[0] || 'Lower platform-favored signals'
  const whyGoodList = (video.whyGood || []).slice(0, 2)

  card.innerHTML = `
    <a href="https://www.youtube.com/watch?v=${video.videoId}" class="card-link" target="_blank">
      <div class="card-thumbnail">
        <img src="${video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`}" alt="" loading="lazy">
        <span class="card-duration">${formatDuration(video.duration)}</span>
      </div>
      <div class="card-details">
        <div class="card-title">${escapeHtml(video.title)}</div>
        <div class="card-channel">${escapeHtml(video.channel || video.channelName)}</div>
        <div class="card-meta">
          ${formatViews(video.views)} views · ${formatAge(video.publishedAt)}
        </div>
      </div>
    </a>
    <div class="card-summary">
      <div class="summary-badges">
        <span class="badge-strength">Strength ${video.qualityScore || '--'}</span>
        <span class="badge-gap ${gap >= 0 ? 'positive' : ''}">+${gap || 0} reach gap</span>
      </div>
      <div class="summary-line">${summaryLine}</div>
    </div>
    <div class="card-expand-toggle collapsed" data-expand>
      <span class="expand-label">Why it surfaced</span>
      <span class="expand-chevron">▸</span>
    </div>
    <div class="card-details-expanded" style="display: none;">
      <div class="detail-section">
        <div class="detail-title">Why limited</div>
        <div class="detail-bullet">• ${escapeHtml(whyLimited)}</div>
      </div>
      ${whyGoodList.length > 0 ? `
        <div class="detail-section">
          <div class="detail-title">Why it matters</div>
          ${whyGoodList.map(r => `<div class="detail-bullet">• ${escapeHtml(r)}</div>`).join('')}
        </div>
      ` : ''}
    </div>
  `

  // Add expand/collapse handler
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
    
    /* Video Grid */
    .silenced-videos {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }
    
    /* Video Card */
    .silenced-card {
      background: #141414;
      border: none;
      border-radius: 8px;
      overflow: hidden;
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
    }

    .badge-strength,
    .badge-gap {
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 3px;
    }

    .badge-strength {
      background: rgba(34, 197, 94, 0.1);
      color: #22c55e;
    }

    .badge-gap {
      background: #1a1a1a;
      color: #666;
    }

    .badge-gap.positive {
      color: #22c55e;
    }

    .summary-line {
      font-size: 13px;
      color: #999;
      line-height: 1.4;
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
  if (!gridElement) {
    injectGrid()
  }
  
  if (gridElement) {
    gridElement.classList.add('visible')
    isVisible = true
  }
  
  // Hide YouTube's native video items (not our injected elements)
  hideNativeVideos()
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
 * Hide the silenced grid and show YouTube's feed
 */
function hide() {
  if (gridElement) {
    gridElement.classList.remove('visible')
    isVisible = false
  }
  
  // Restore YouTube's native video items
  showNativeVideos()
}

/**
 * Update the grid with silenced videos
 */
function updateVideos(videos) {
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
    // Show empty state
    if (emptyEl) emptyEl.style.display = 'flex'
    return
  }
  
  // Hide empty state
  if (emptyEl) emptyEl.style.display = 'none'
  
  // Add video cards
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
  const avgGapEl = gridElement.querySelector('#silenced-avg-gap')
  
  if (totalEl) {
    totalEl.textContent = silencedVideos.length
  }
  
  if (avgQualityEl) {
    const avgQuality = Math.round(
      silencedVideos.reduce((sum, v) => sum + (v.qualityScore || 0), 0) / silencedVideos.length
    )
    avgQualityEl.textContent = avgQuality
  }
  
  if (avgGapEl) {
    const avgGap = Math.round(
      silencedVideos.reduce((sum, v) => sum + (v.exposureGap || 0), 0) / silencedVideos.length
    )
    avgGapEl.textContent = `+${avgGap}`
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
