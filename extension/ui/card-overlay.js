/**
 * Card Overlay Component
 * 
 * Adds bias score pills and micro-tags to each video card in the feed.
 * Non-invasive overlay that appears under the video title.
 */

;(function() {
'use strict';

// ============================================
// CONSTANTS
// ============================================

const OVERLAY_CLASS = 'bias-overlay'
const PROCESSED_ATTR = 'data-bias-processed'

// Tag color mapping
const CARD_TAG_COLORS = {
  ctrProxy: '#f97316',
  retentionProxy: '#ef4444',
  personalizationFit: '#3b82f6',
  engagementStrength: '#8b5cf6',
  authority: '#06b6d4',
  recencyTrend: '#f59e0b',
  thumbnailAbuse: '#dc2626',
  titleBait: '#ea580c',
  sponsorDetection: '#65a30d',
  corporateSignals: '#0891b2',
  default: '#6b7280'
}

// ============================================
// STATE
// ============================================

let overlaysEnabled = false
let videoScores = new Map() // videoId -> score data
let onHoverCallbacks = []

// ============================================
// OVERLAY CREATION
// ============================================

/**
 * Create overlay element for a video card
 */
function createOverlayElement(videoId, scoreData) {
  const overlay = document.createElement('div')
  overlay.className = OVERLAY_CLASS
  overlay.dataset.videoId = videoId
  
  // Main row with pill and tags
  const mainRow = document.createElement('div')
  mainRow.className = 'bias-overlay-main'
  mainRow.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;'
  
  // Bias score pill
  const scorePill = createScorePill(scoreData.biasScore, scoreData.confidence)
  
  // Tags container
  const tagsContainer = createTagsContainer(scoreData.tags || [])
  
  mainRow.appendChild(scorePill)
  mainRow.appendChild(tagsContainer)
  overlay.appendChild(mainRow)
  
  // Add breakdown chart if available (collapsible)
  if (scoreData.breakdown) {
    const breakdownToggle = document.createElement('div')
    breakdownToggle.className = 'breakdown-toggle'
    breakdownToggle.innerHTML = '<span class="toggle-icon">📊</span><span class="toggle-text">Details</span>'
    breakdownToggle.style.cssText = 'display: flex; align-items: center; gap: 4px; font-size: 10px; color: #888; cursor: pointer; margin-top: 4px;'
    
    const chart = createBreakdownChart(scoreData.breakdown)
    if (chart) {
      chart.style.display = 'none'
      
      breakdownToggle.addEventListener('click', (e) => {
        e.stopPropagation()
        const isHidden = chart.style.display === 'none'
        chart.style.display = isHidden ? 'flex' : 'none'
        breakdownToggle.querySelector('.toggle-text').textContent = isHidden ? 'Hide' : 'Details'
      })
      
      overlay.appendChild(breakdownToggle)
      overlay.appendChild(chart)
    }
  }
  
  // Add hover handler for popover
  overlay.addEventListener('mouseenter', (e) => handleOverlayHover(e, videoId, scoreData))
  overlay.addEventListener('mouseleave', handleOverlayLeave)
  
  return overlay
}

/**
 * Create the bias score pill
 */
function createScorePill(score, confidence = 1) {
  const pill = document.createElement('div')
  pill.className = 'bias-score-pill'
  
  // Color based on score
  let color = '#10b981' // Green for low bias
  if (score >= 70) {
    color = '#ef4444' // Red for high bias
  } else if (score >= 50) {
    color = '#f97316' // Orange for medium bias
  } else if (score >= 30) {
    color = '#f59e0b' // Yellow for low-medium
  }
  
  pill.style.setProperty('--pill-color', color)
  
  // Confidence indicator
  const confidenceClass = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low'
  pill.classList.add(`confidence-${confidenceClass}`)
  
  pill.innerHTML = `
    <span class="pill-label">Bias</span>
    <span class="pill-score">${score}</span>
  `
  
  pill.title = `Bias Score: ${score}/100 (Confidence: ${Math.round(confidence * 100)}%)`
  
  return pill
}

/**
 * Create tags container with micro-tags showing breakdown categories
 */
function createTagsContainer(tags) {
  const container = document.createElement('div')
  container.className = 'bias-tags'
  
  // Show max 4 tags
  const displayTags = tags.slice(0, 4)
  
  for (const tag of displayTags) {
    const tagEl = document.createElement('span')
    tagEl.className = 'bias-tag'
    
    // Use tag color or determine based on value (0-100 scale now)
    let color = tag.color || CARD_TAG_COLORS.default
    if (tag.value !== undefined && !tag.color) {
      if (tag.value >= 70) {
        color = '#ef4444' // Red for high
      } else if (tag.value >= 50) {
        color = '#f97316' // Orange for medium-high
      } else if (tag.value >= 30) {
        color = '#f59e0b' // Yellow for medium
      } else {
        color = '#22c55e' // Green for low
      }
    }
    
    tagEl.style.setProperty('--tag-color', color)
    tagEl.textContent = tag.text || tag.label || 'Unknown'
    tagEl.title = tag.description || tag.text || ''
    container.appendChild(tagEl)
  }
  
  return container
}

/**
 * Create breakdown bar chart for 6 bias categories
 */
function createBreakdownChart(breakdown) {
  if (!breakdown) return null
  
  const container = document.createElement('div')
  container.className = 'bias-breakdown-chart'
  
  const categories = [
    { key: 'EA', label: 'Exposure', icon: '📊', desc: 'Algorithmic advantage from channel size' },
    { key: 'CM', label: 'Click Magnet', icon: '🎯', desc: 'Title/thumbnail click optimization' },
    { key: 'RP', label: 'Retention', icon: '⏱️', desc: 'Watch time prediction signals' },
    { key: 'EN', label: 'Engagement', icon: '💬', desc: 'Like/comment ratios' },
    { key: 'TR', label: 'Topic', icon: '🏷️', desc: 'Topic clustering in feed' },
    { key: 'CI', label: 'Commercial', icon: '💰', desc: 'Sponsor/affiliate signals' }
  ]
  
  for (const cat of categories) {
    const value = breakdown[cat.key] || 0
    const row = document.createElement('div')
    row.className = 'breakdown-row'
    row.title = `${cat.label}: ${value}/100 - ${cat.desc}`
    
    // Determine bar color
    let barColor = '#22c55e'
    if (value >= 70) barColor = '#ef4444'
    else if (value >= 50) barColor = '#f97316'
    else if (value >= 30) barColor = '#f59e0b'
    
    row.innerHTML = `
      <span class="breakdown-icon">${cat.icon}</span>
      <span class="breakdown-label">${cat.key}</span>
      <div class="breakdown-bar-bg">
        <div class="breakdown-bar-fill" style="width: ${value}%; background: ${barColor};"></div>
      </div>
      <span class="breakdown-value">${value}</span>
    `
    
    container.appendChild(row)
  }
  
  return container
}

/**
 * Get overlay styles
 */
function getOverlayStyles() {
  return `
    .bias-overlay {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      padding: 4px 0;
      opacity: 0;
      transform: translateY(-4px);
      transition: all 0.2s ease;
      position: relative;
      z-index: 100;
    }
    
    .bias-overlay.visible {
      opacity: 1;
      transform: translateY(0);
    }
    
    .bias-score-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 12px;
      background: var(--pill-color, #6b7280);
      color: #fff;
      font-family: "YouTube Sans", "Roboto", sans-serif;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    
    .bias-score-pill:hover {
      transform: scale(1.05);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
    
    .bias-score-pill .pill-label {
      opacity: 0.9;
      font-weight: 500;
    }
    
    .bias-score-pill .pill-score {
      font-weight: 700;
    }
    
    /* Confidence indicators */
    .bias-score-pill.confidence-low {
      opacity: 0.7;
    }
    
    .bias-score-pill.confidence-low::after {
      content: '?';
      margin-left: 2px;
      font-size: 9px;
      opacity: 0.7;
    }
    
    .bias-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    
    .bias-tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      border-left: 2px solid var(--tag-color, #6b7280);
      color: #ccc;
      font-family: "YouTube Sans", "Roboto", sans-serif;
      font-size: 10px;
      font-weight: 500;
      cursor: default;
      transition: all 0.15s ease;
    }
    
    .bias-tag:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }
    
    /* Breakdown Chart Styles */
    .bias-breakdown-chart {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 6px;
      margin-top: 8px;
    }
    
    .breakdown-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
    }
    
    .breakdown-icon {
      width: 14px;
      text-align: center;
      font-size: 11px;
    }
    
    .breakdown-label {
      width: 24px;
      color: #888;
      font-weight: 600;
      font-family: monospace;
    }
    
    .breakdown-bar-bg {
      flex: 1;
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    
    .breakdown-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    
    .breakdown-value {
      width: 24px;
      text-align: right;
      color: #aaa;
      font-weight: 600;
      font-family: monospace;
    }
    
    /* Hide overlays when Bias Lens is off */
    .bias-lens-disabled .bias-overlay {
      display: none !important;
    }
    
    /* Responsive */
    @media (max-width: 700px) {
      .bias-overlay {
        gap: 4px;
      }
      
      .bias-score-pill {
        padding: 2px 6px;
        font-size: 10px;
      }
      
      .bias-tag {
        font-size: 9px;
        padding: 1px 4px;
      }
    }
    
    /* Animation for new overlays */
    @keyframes overlayFadeIn {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .bias-overlay.animating {
      animation: overlayFadeIn 0.3s ease forwards;
    }
  `
}

// ============================================
// OVERLAY INJECTION
// ============================================

/**
 * Find video cards in the feed
 */
function findVideoCards() {
  // Different selectors for different YouTube layouts
  const selectors = [
    'ytd-rich-item-renderer',           // Home page grid
    'ytd-video-renderer',               // Search results
    'ytd-compact-video-renderer',       // Sidebar suggestions
    'ytd-grid-video-renderer'           // Channel page grid
  ]
  
  const cards = []
  
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector)
    cards.push(...elements)
  }
  
  return cards
}

/**
 * Extract video ID from a card element
 */
function extractVideoId(card) {
  // Try different methods to get video ID
  
  // Method 1: From ANY anchor link - try all URL patterns
  const allLinks = card.querySelectorAll('a[href]')
  for (const link of allLinks) {
    const href = link.href || ''
    
    // Standard watch URL: /watch?v=ID
    const watchMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
    if (watchMatch) {
      return watchMatch[1]
    }
    
    // Shorts URL: /shorts/ID
    const shortsMatch = href.match(/\/shorts\/([a-zA-Z0-9_-]{11})/)
    if (shortsMatch) {
      return shortsMatch[1]
    }
    
    // Short URL: youtu.be/ID
    const shortMatch = href.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
    if (shortMatch) {
      return shortMatch[1]
    }
  }
  
  // Method 2: From video-id attribute
  const videoIdAttr = card.querySelector('[video-id]')
  if (videoIdAttr) {
    return videoIdAttr.getAttribute('video-id')
  }
  
  // Method 3: From data attribute
  if (card.dataset.videoId) {
    return card.dataset.videoId
  }
  
  return null
}

/**
 * Extract video data from a card element
 */
function extractVideoData(card) {
  const videoId = extractVideoId(card)
  if (!videoId) return null
  
  // Get title
  const titleEl = card.querySelector('#video-title, .title, [id="video-title"]')
  const title = titleEl?.textContent?.trim() || ''
  
  // Get channel name
  const channelEl = card.querySelector('#channel-name a, .ytd-channel-name a, #text.ytd-channel-name')
  const channelName = channelEl?.textContent?.trim() || ''
  
  // Get thumbnail URL
  const thumbnailEl = card.querySelector('img#img, img.yt-core-image')
  const thumbnailUrl = thumbnailEl?.src || ''
  
  // Get view count (approximate)
  const metaEl = card.querySelector('#metadata-line span, .ytd-video-meta-block span')
  const metaText = metaEl?.textContent || ''
  const viewMatch = metaText.match(/([\d.,]+[KMB]?)\s*views?/i)
  const views = viewMatch ? parseViewCount(viewMatch[1]) : 0
  
  return {
    videoId,
    title,
    channelName,
    thumbnailUrl,
    views,
    element: card
  }
}

/**
 * Parse view count string to number
 */
function parseViewCount(str) {
  if (!str) return 0
  
  const num = parseFloat(str.replace(/,/g, ''))
  
  if (str.includes('K')) return num * 1000
  if (str.includes('M')) return num * 1000000
  if (str.includes('B')) return num * 1000000000
  
  return num
}

/**
 * Find the injection point within a card (after title)
 */
function findCardInjectionPoint(card) {
  // Try different selectors for the metadata area
  const selectors = [
    '#meta',                            // Rich item renderer
    '#metadata',                        // Video renderer
    '.metadata',                        // Generic
    '#details',                         // Details container
    '#dismissible #details',            // Compact renderer
    'ytd-video-meta-block',             // Shorts
    '#video-title-link',                // Title link container
    'a#video-title',                    // Title anchor
    '.ytd-rich-grid-media #meta',       // Rich grid media
    '#dismissible'                      // Dismissible container (fallback)
  ]
  
  for (const selector of selectors) {
    const element = card.querySelector(selector)
    if (element) return element
  }
  
  // Ultimate fallback - return the card itself
  return card
}

/**
 * Add overlay to a single video card
 */
function addOverlayToCard(card, scoreData) {
  // Check if already processed
  if (card.hasAttribute(PROCESSED_ATTR)) {
    // Update existing overlay if score changed
    const existingOverlay = card.querySelector(`.${OVERLAY_CLASS}`)
    if (existingOverlay && scoreData) {
      updateOverlay(existingOverlay, scoreData)
    }
    return
  }
  
  // Extract video data
  const videoData = extractVideoData(card)
  if (!videoData) {
    return
  }
  
  // Mark as processed
  card.setAttribute(PROCESSED_ATTR, 'true')
  
  // If no score data provided, use cached or request
  if (!scoreData) {
    scoreData = videoScores.get(videoData.videoId)
  }
  
  if (!scoreData) {
    // NO MOCK DATA - only show overlays for videos with real computed scores
    // If no score data, don't inject overlay at all
    // The card will get processed when real scores arrive via setScores()
    card.removeAttribute(PROCESSED_ATTR) // Allow re-processing when scores arrive
    return
  }
  
  // Find injection point
  const injectionPoint = findCardInjectionPoint(card)
  if (!injectionPoint) return
  
  // Create and inject overlay
  const overlay = createOverlayElement(videoData.videoId, scoreData)
  injectionPoint.appendChild(overlay)
  
  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add('visible', 'animating')
    setTimeout(() => overlay.classList.remove('animating'), 300)
  })
}

/**
 * Update an existing overlay with new score data
 */
function updateOverlay(overlay, scoreData) {
  const videoId = overlay.dataset.videoId
  
  // Update score pill
  const scorePill = overlay.querySelector('.bias-score-pill')
  if (scorePill) {
    const scoreEl = scorePill.querySelector('.pill-score')
    if (scoreEl) scoreEl.textContent = scoreData.biasScore
    
    // Update color
    let color = '#10b981'
    if (scoreData.biasScore >= 70) color = '#ef4444'
    else if (scoreData.biasScore >= 50) color = '#f97316'
    else if (scoreData.biasScore >= 30) color = '#f59e0b'
    
    scorePill.style.setProperty('--pill-color', color)
  }
  
  // Update tags
  const tagsContainer = overlay.querySelector('.bias-tags')
  if (tagsContainer && scoreData.tags) {
    tagsContainer.innerHTML = ''
    const displayTags = scoreData.tags.slice(0, 4)
    
    for (const tag of displayTags) {
      const tagEl = document.createElement('span')
      tagEl.className = 'bias-tag'
      tagEl.style.setProperty('--tag-color', tag.color || CARD_TAG_COLORS.default)
      tagEl.textContent = tag.text
      tagsContainer.appendChild(tagEl)
    }
  }
}

/**
 * Request score calculation for a video
 */
function requestScore(videoData) {
  // Send message to background script
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({
      action: 'analyzeVideo',
      videoData
    }, response => {
      if (response && response.success) {
        // Store score
        videoScores.set(videoData.videoId, response.data)
        
        // Update overlay
        const card = videoData.element
        if (card) {
          const overlay = card.querySelector(`.${OVERLAY_CLASS}`)
          if (overlay) {
            updateOverlay(overlay, response.data)
          } else {
            addOverlayToCard(card, response.data)
          }
        }
      }
    })
  }
}

// ============================================
// HOVER HANDLING
// ============================================

/**
 * Handle overlay hover (trigger popover)
 */
function handleOverlayHover(event, videoId, scoreData) {
  // Notify callbacks (for popover component)
  for (const callback of onHoverCallbacks) {
    try {
      callback({
        type: 'enter',
        videoId,
        scoreData,
        element: event.currentTarget,
        position: event.currentTarget.getBoundingClientRect()
      })
    } catch (error) {
      console.error('[BiasLens] Hover callback error:', error)
    }
  }
}

/**
 * Handle overlay leave
 */
function handleOverlayLeave(event) {
  for (const callback of onHoverCallbacks) {
    try {
      callback({
        type: 'leave',
        element: event.currentTarget
      })
    } catch (error) {
      console.error('[BiasLens] Hover callback error:', error)
    }
  }
}

/**
 * Register hover callback
 */
function onHover(callback) {
  if (typeof callback === 'function') {
    onHoverCallbacks.push(callback)
  }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Process all video cards in the feed
 */
// Debounce timer for processAllCards
let processCardsTimeout = null

function processAllCards() {
  // Debounce to prevent excessive calls
  if (processCardsTimeout) {
    clearTimeout(processCardsTimeout)
  }
  
  processCardsTimeout = setTimeout(() => {
    _doProcessAllCards()
  }, 100)
}

function _doProcessAllCards() {
  if (!overlaysEnabled) return
  
  const cards = findVideoCards()
  
  // Only process first 20 visible cards to avoid slowness
  const visibleCards = cards.slice(0, 20)
  
  // #region agent log H3
  const foundIds = visibleCards.slice(0,5).map(c => extractVideoId(c)).filter(Boolean);
  fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'card-overlay.js:_doProcessAllCards',message:'Processing cards',data:{totalCards:cards.length,visibleCards:visibleCards.length,first5Ids:foundIds,scoresMapSize:videoScores.size},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  
  for (const card of visibleCards) {
    addOverlayToCard(card)
  }
}

/**
 * Enable overlays
 */
function enable() {
  overlaysEnabled = true
  injectStyles()
  document.body.classList.remove('bias-lens-disabled')
  processAllCards()
}

/**
 * Disable overlays
 */
function disable() {
  overlaysEnabled = false
  document.body.classList.add('bias-lens-disabled')
}

/**
 * Remove all overlays
 */
function removeAll() {
  const overlays = document.querySelectorAll(`.${OVERLAY_CLASS}`)
  overlays.forEach(overlay => overlay.remove())
  
  // Remove processed markers
  const processed = document.querySelectorAll(`[${PROCESSED_ATTR}]`)
  processed.forEach(el => el.removeAttribute(PROCESSED_ATTR))
}

/**
 * Set score for a video
 */
function setScore(videoId, scoreData) {
  videoScores.set(videoId, scoreData)
}

/**
 * Set scores for multiple videos
 */
function setScores(scores) {
  for (const [videoId, scoreData] of Object.entries(scores)) {
    videoScores.set(videoId, scoreData)
  }
  
  // Update existing overlays
  if (overlaysEnabled) {
    processAllCards()
  }
}

/**
 * Get score for a video
 */
function getScore(videoId) {
  return videoScores.get(videoId)
}

/**
 * Inject overlay styles
 */
function injectStyles() {
  const styleId = 'bias-overlay-styles'
  
  if (document.getElementById(styleId)) {
    return
  }
  
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = getOverlayStyles()
  document.head.appendChild(style)
}

/**
 * Initialize card overlay system
 */
function init() {
  injectStyles()
  
  // Set up mutation observer for new cards
  const observer = new MutationObserver((mutations) => {
    if (!overlaysEnabled) return
    
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // Debounce processing
        clearTimeout(init.processTimeout)
        init.processTimeout = setTimeout(processAllCards, 100)
      }
    }
  })
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  })
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.BiasCardOverlay = {
    init,
    enable,
    disable,
    processAllCards,
    removeAll,
    setScore,
    setScores,
    getScore,
    onHover,
    OVERLAY_CLASS,
    TAG_COLORS: CARD_TAG_COLORS
  }
}

// Export for Node.js (testing)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    init,
    enable,
    disable,
    processAllCards,
    removeAll,
    setScore,
    setScores,
    getScore,
    onHover,
    OVERLAY_CLASS,
    TAG_COLORS: CARD_TAG_COLORS
  }
}

})(); // End IIFE
