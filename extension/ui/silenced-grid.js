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
        <span class="silenced-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
        </span>
        <h2 class="silenced-title">Silenced Voices</h2>
        <span class="silenced-subtitle">High-quality videos the algorithm doesn't prioritize</span>
      </div>
      <div class="silenced-stats">
        <span class="stat-item">
          <span class="stat-value" id="silenced-total">0</span>
          <span class="stat-label">Found</span>
        </span>
        <span class="stat-item">
          <span class="stat-value" id="silenced-avg-quality">--</span>
          <span class="stat-label">Avg Quality</span>
        </span>
        <span class="stat-item">
          <span class="stat-value" id="silenced-avg-gap">--</span>
          <span class="stat-label">Avg Gap</span>
        </span>
      </div>
    </div>
    <div class="silenced-content">
      <div class="silenced-loading">
        <div class="loading-spinner"></div>
        <span>Discovering silenced voices...</span>
      </div>
      <div class="silenced-videos"></div>
      <div class="silenced-empty" style="display: none;">
        <span class="empty-icon">🔇</span>
        <span class="empty-text">No silenced videos found for your current topics</span>
      </div>
      <div class="silenced-ai-offline" style="display: none;">
        <span class="offline-icon">⚠️</span>
        <span class="offline-title">AI Quality Scoring Offline</span>
        <span class="offline-text">Cannot verify video quality without AI analysis. Results would be unreliable.</span>
        <span class="offline-hint">The backend server may be down. Try again later or check the console for details.</span>
      </div>
      <div class="silenced-insufficient" style="display: none;">
        <span class="insufficient-icon">📊</span>
        <span class="insufficient-title">Not Enough Signal</span>
        <span class="insufficient-text">Scroll to load more videos on your homepage so we can understand your interests.</span>
      </div>
    </div>
  `
  
  return grid
}

/**
 * Create a video card element
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
  
  // Quality score
  const qualityScore = video.qualityScore || 0
  
  // Why silenced data
  const whySilenced = video.whySilenced || {}
  
  // Generate "why good" and "why buried" from data
  const whyGood = []
  const whyBuried = []
  
  // Generate reasons from metrics
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
  
  // Why buried
  if (subs < 100000) {
    whyBuried.push(`Only ${formatViews(subs)} subscribers`)
  }
  if (views < 100000 && qualityScore > 50) {
    whyBuried.push('High quality, low reach')
  } else {
    whyBuried.push('Lower algorithmic advantage')
  }
  
  card.dataset.videoId = videoId
  
  card.innerHTML = `
    <a href="https://www.youtube.com/watch?v=${videoId}" class="card-link" target="_blank">
      <div class="card-thumbnail">
        <img src="${thumbnail}" alt="" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${videoId}/mqdefault.jpg'">
        <span class="card-duration">${formatDuration(durationSec)}</span>
      </div>
      <div class="card-details">
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-channel">${escapeHtml(channelName)}</div>
        <div class="card-meta">
          ${formatViews(views)} views · ${formatAge(publishedAt)} · ${formatViews(subs)} subs
        </div>
      </div>
    </a>
    <div class="silenced-scores">
      <span class="quality-pill" title="Quality Score: How good the content is based on engagement and metrics">
        Quality ${qualityScore}
      </span>
      <span class="subs-pill" title="Subscriber count: Under 100K = silenced threshold">
        ${formatViews(subs)} subs
      </span>
    </div>
    <div class="silenced-tags">
      ${whyGood.slice(0, 3).map(reason => 
        `<span class="silenced-tag positive">${escapeHtml(reason)}</span>`
      ).join('')}
    </div>
    <div class="silenced-reason">
      <span class="reason-label">Why buried:</span>
      <span class="reason-text">${escapeHtml(whyBuried[0] || 'Lower algorithmic advantage signals')}</span>
    </div>
  `
  
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
    
    .silenced-icon {
      color: #10b981;
      margin-bottom: 4px;
    }
    
    .silenced-title {
      font-size: 20px;
      font-weight: 600;
      color: #fff;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .silenced-subtitle {
      font-size: 13px;
      color: #888;
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
      background: rgba(16, 185, 129, 0.1);
      border-radius: 8px;
    }
    
    .stat-item .stat-value {
      font-size: 18px;
      font-weight: 700;
      color: #10b981;
    }
    
    .stat-item .stat-label {
      font-size: 10px;
      color: #888;
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
      gap: 12px;
      padding: 60px 0;
      color: #666;
    }
    
    .empty-icon {
      font-size: 48px;
    }
    
    .empty-text {
      font-size: 14px;
    }
    
    /* AI Offline State */
    .silenced-ai-offline {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 60px 20px;
      color: #f59e0b;
      background: rgba(245, 158, 11, 0.05);
      border: 1px dashed rgba(245, 158, 11, 0.3);
      border-radius: 12px;
      margin: 20px 0;
    }
    
    .offline-icon {
      font-size: 48px;
    }
    
    .offline-title {
      font-size: 18px;
      font-weight: 600;
      color: #f59e0b;
    }
    
    .offline-text {
      font-size: 14px;
      color: #888;
      text-align: center;
      max-width: 400px;
    }
    
    .offline-hint {
      font-size: 12px;
      color: #666;
      text-align: center;
    }
    
    /* Insufficient Data State */
    .silenced-insufficient {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 60px 20px;
      color: #3b82f6;
      background: rgba(59, 130, 246, 0.05);
      border: 1px dashed rgba(59, 130, 246, 0.3);
      border-radius: 12px;
      margin: 20px 0;
    }
    
    .insufficient-icon {
      font-size: 48px;
    }
    
    .insufficient-title {
      font-size: 18px;
      font-weight: 600;
      color: #3b82f6;
    }
    
    .insufficient-text {
      font-size: 14px;
      color: #888;
      text-align: center;
      max-width: 400px;
    }
    
    /* Video Grid */
    .silenced-videos {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }
    
    /* Video Card */
    .silenced-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.2s ease;
    }
    
    .silenced-card:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(16, 185, 129, 0.3);
      transform: translateY(-2px);
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
    
    .quality-pill,
    .silenced-pill,
    .gap-pill {
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    
    .quality-pill {
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
    }
    
    .silenced-pill {
      background: rgba(139, 92, 246, 0.2);
      color: #8b5cf6;
    }
    
    .subs-pill {
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
    }
    
    .gap-pill {
      background: rgba(255, 255, 255, 0.1);
      color: #888;
    }
    
    .gap-pill.positive {
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
    }
    
    .gap-pill.negative {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }
    
    /* Tags */
    .silenced-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 8px 12px 0;
    }
    
    .silenced-tag {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
    }
    
    .silenced-tag.positive {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
    }
    
    /* Reason */
    .silenced-reason {
      padding: 8px 12px 12px;
      font-size: 11px;
    }
    
    .reason-label {
      color: #666;
      margin-right: 4px;
    }
    
    .reason-text {
      color: #f97316;
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
