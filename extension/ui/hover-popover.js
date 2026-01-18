/**
 * Hover Popover Component
 * 
 * Shows detailed bias breakdown when hovering over a video card's overlay.
 * Includes score breakdown, metrics, charts, and Gemini-generated explanations.
 */

;(function() {
'use strict';

// ============================================
// CONSTANTS
// ============================================

const POPOVER_ID = 'bias-popover'
const HOVER_DELAY = 300 // ms before showing popover
const HIDE_DELAY = 200 // ms before hiding popover

// ============================================
// STATE
// ============================================

let popoverElement = null
let currentVideoId = null
let showTimeout = null
let hideTimeout = null
let isHovering = false

// ============================================
// POPOVER CREATION
// ============================================

/**
 * Create the popover element
 */
function createPopoverElement() {
  const popover = document.createElement('div')
  popover.id = POPOVER_ID
  popover.className = 'bias-popover'
  
  popover.innerHTML = `
    <div class="popover-arrow"></div>
    <div class="popover-content">
      <div class="popover-header">
        <div class="popover-score-container">
          <span class="popover-score">--</span>
          <span class="popover-score-label">Bias Score</span>
        </div>
        <div class="popover-confidence">
          <span class="confidence-label">Confidence</span>
          <div class="confidence-bar">
            <div class="confidence-fill"></div>
          </div>
          <span class="confidence-value">--</span>
        </div>
      </div>
      
      <div class="popover-section popover-breakdown">
        <div class="section-title">Score Breakdown</div>
        <div class="breakdown-chart">
          <div class="breakdown-item" data-factor="aas">
            <span class="item-label">Algorithmic Advantage</span>
            <div class="item-bar-container">
              <div class="item-bar" style="--value: 0"></div>
            </div>
            <span class="item-value">0</span>
          </div>
          <div class="breakdown-item" data-factor="ms">
            <span class="item-label">Manipulation</span>
            <div class="item-bar-container">
              <div class="item-bar" style="--value: 0"></div>
            </div>
            <span class="item-value">0</span>
          </div>
          <div class="breakdown-item" data-factor="cis">
            <span class="item-label">Commercial Influence</span>
            <div class="item-bar-container">
              <div class="item-bar" style="--value: 0"></div>
            </div>
            <span class="item-value">0</span>
          </div>
        </div>
      </div>
      
      <div class="popover-section popover-contributions">
        <div class="section-title">Top Contributors</div>
        <div class="contributions-list"></div>
      </div>
      
      <div class="popover-section popover-metrics">
        <div class="section-title">Video Metrics</div>
        <div class="metrics-grid"></div>
      </div>
      
      <div class="popover-section popover-explanations">
        <div class="section-title">
          <span>Why This Score?</span>
          <span class="ai-badge">AI</span>
        </div>
        <div class="explanations-list"></div>
      </div>
      
      <div class="popover-footer">
        <span class="popover-hint">Click for full analysis</span>
      </div>
    </div>
  `
  
  // Add hover handlers to keep popover open when hovering over it
  popover.addEventListener('mouseenter', handlePopoverEnter)
  popover.addEventListener('mouseleave', handlePopoverLeave)
  
  return popover
}

/**
 * Get popover styles
 */
function getPopoverStyles() {
  return `
    .bias-popover {
      position: fixed;
      z-index: 9999;
      width: 320px;
      background: #1a1a1a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      font-family: "YouTube Sans", "Roboto", sans-serif;
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px);
      transition: all 0.2s ease;
      pointer-events: none;
    }
    
    .bias-popover.visible {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
      pointer-events: auto;
    }
    
    .popover-arrow {
      position: absolute;
      top: -6px;
      left: 20px;
      width: 12px;
      height: 12px;
      background: #1a1a1a;
      border-left: 1px solid rgba(255, 255, 255, 0.1);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      transform: rotate(45deg);
    }
    
    .popover-content {
      padding: 16px;
    }
    
    /* Header */
    .popover-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .popover-score-container {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }
    
    .popover-score {
      font-size: 36px;
      font-weight: 700;
      color: #f97316;
      line-height: 1;
    }
    
    .popover-score-label {
      font-size: 11px;
      color: #888;
      margin-top: 4px;
    }
    
    .popover-confidence {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }
    
    .confidence-label {
      font-size: 10px;
      color: #666;
    }
    
    .confidence-bar {
      width: 60px;
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      overflow: hidden;
    }
    
    .confidence-fill {
      height: 100%;
      background: #10b981;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    
    .confidence-value {
      font-size: 11px;
      color: #888;
    }
    
    /* Sections */
    .popover-section {
      margin-bottom: 14px;
    }
    
    .popover-section:last-of-type {
      margin-bottom: 0;
    }
    
    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    
    .ai-badge {
      font-size: 9px;
      padding: 1px 4px;
      background: linear-gradient(135deg, #8b5cf6, #06b6d4);
      border-radius: 3px;
      color: #fff;
    }
    
    /* Breakdown Chart */
    .breakdown-chart {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .breakdown-item {
      display: grid;
      grid-template-columns: 120px 1fr 30px;
      align-items: center;
      gap: 8px;
    }
    
    .item-label {
      font-size: 11px;
      color: #aaa;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .item-bar-container {
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    
    .item-bar {
      height: 100%;
      width: calc(var(--value) * 1%);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    
    .breakdown-item[data-factor="aas"] .item-bar {
      background: #f97316;
    }
    
    .breakdown-item[data-factor="ms"] .item-bar {
      background: #ef4444;
    }
    
    .breakdown-item[data-factor="cis"] .item-bar {
      background: #06b6d4;
    }
    
    .item-value {
      font-size: 11px;
      font-weight: 600;
      color: #fff;
      text-align: right;
    }
    
    /* Contributions */
    .contributions-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .contribution-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      border-left: 3px solid var(--contrib-color, #6b7280);
    }
    
    .contrib-label {
      flex: 1;
      font-size: 11px;
      color: #ccc;
    }
    
    .contrib-value {
      font-size: 11px;
      font-weight: 600;
      color: var(--contrib-color, #6b7280);
    }
    
    /* Metrics Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    
    .metric-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
    }
    
    .metric-value {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }
    
    .metric-label {
      font-size: 9px;
      color: #666;
      margin-top: 2px;
    }
    
    /* Explanations */
    .explanations-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .explanation-item {
      padding: 8px 10px;
      background: rgba(139, 92, 246, 0.1);
      border-radius: 6px;
      border-left: 2px solid #8b5cf6;
    }
    
    .explanation-factor {
      font-size: 10px;
      font-weight: 600;
      color: #8b5cf6;
      margin-bottom: 4px;
    }
    
    .explanation-text {
      font-size: 11px;
      color: #ccc;
      line-height: 1.4;
    }
    
    /* Footer */
    .popover-footer {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      text-align: center;
    }
    
    .popover-hint {
      font-size: 10px;
      color: #666;
    }
    
    /* Loading state */
    .bias-popover.loading .popover-content::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(26, 26, 26, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    /* Responsive */
    @media (max-width: 400px) {
      .bias-popover {
        width: 280px;
      }
      
      .breakdown-item {
        grid-template-columns: 90px 1fr 25px;
      }
    }
  `
}

// ============================================
// POPOVER POSITIONING
// ============================================

/**
 * Position the popover relative to the trigger element
 */
function positionPopover(triggerRect) {
  if (!popoverElement) return
  
  const popoverRect = popoverElement.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const padding = 10
  
  // Default position: below the trigger
  let top = triggerRect.bottom + 8
  let left = triggerRect.left
  
  // Check if popover would go off the right edge
  if (left + popoverRect.width > viewportWidth - padding) {
    left = viewportWidth - popoverRect.width - padding
  }
  
  // Check if popover would go off the left edge
  if (left < padding) {
    left = padding
  }
  
  // Check if popover would go off the bottom
  if (top + popoverRect.height > viewportHeight - padding) {
    // Position above the trigger instead
    top = triggerRect.top - popoverRect.height - 8
    
    // Move arrow to bottom
    const arrow = popoverElement.querySelector('.popover-arrow')
    if (arrow) {
      arrow.style.top = 'auto'
      arrow.style.bottom = '-6px'
      arrow.style.transform = 'rotate(225deg)'
    }
  } else {
    // Reset arrow to top
    const arrow = popoverElement.querySelector('.popover-arrow')
    if (arrow) {
      arrow.style.top = '-6px'
      arrow.style.bottom = 'auto'
      arrow.style.transform = 'rotate(45deg)'
    }
  }
  
  // Position arrow horizontally
  const arrowLeft = Math.max(20, Math.min(triggerRect.left - left + triggerRect.width / 2, popoverRect.width - 20))
  const arrow = popoverElement.querySelector('.popover-arrow')
  if (arrow) {
    arrow.style.left = `${arrowLeft}px`
  }
  
  popoverElement.style.top = `${top}px`
  popoverElement.style.left = `${left}px`
}

// ============================================
// POPOVER CONTENT
// ============================================

/**
 * Update popover content with score data
 */
function updatePopoverContent(scoreData) {
  if (!popoverElement || !scoreData) return
  
  // Update main score
  const scoreEl = popoverElement.querySelector('.popover-score')
  if (scoreEl) {
    scoreEl.textContent = scoreData.biasScore || '--'
    
    // Color based on score
    let color = '#10b981'
    if (scoreData.biasScore >= 70) color = '#ef4444'
    else if (scoreData.biasScore >= 50) color = '#f97316'
    else if (scoreData.biasScore >= 30) color = '#f59e0b'
    
    scoreEl.style.color = color
  }
  
  // Update confidence
  const confidenceValue = popoverElement.querySelector('.confidence-value')
  const confidenceFill = popoverElement.querySelector('.confidence-fill')
  if (confidenceValue && confidenceFill) {
    const confidence = scoreData.confidence || 0
    confidenceValue.textContent = `${Math.round(confidence * 100)}%`
    confidenceFill.style.width = `${confidence * 100}%`
  }
  
  // Update breakdown bars
  if (scoreData.scores) {
    updateBreakdownBar('aas', scoreData.scores.aas)
    updateBreakdownBar('ms', scoreData.scores.ms)
    updateBreakdownBar('cis', scoreData.scores.cis)
  }
  
  // Update contributions
  updateContributions(scoreData.contributions || scoreData.tags || [])
  
  // Update metrics
  updateMetrics(scoreData.metrics || {})
  
  // Update explanations
  updateExplanations(scoreData.explanations || [])
}

/**
 * Update a breakdown bar
 */
function updateBreakdownBar(factor, value) {
  const item = popoverElement.querySelector(`.breakdown-item[data-factor="${factor}"]`)
  if (!item) return
  
  const bar = item.querySelector('.item-bar')
  const valueEl = item.querySelector('.item-value')
  
  if (bar) bar.style.setProperty('--value', value || 0)
  if (valueEl) valueEl.textContent = value || 0
}

/**
 * Update contributions list
 */
function updateContributions(contributions) {
  const container = popoverElement.querySelector('.contributions-list')
  if (!container) return
  
  container.innerHTML = ''
  
  const displayContribs = contributions.slice(0, 5)
  
  for (const contrib of displayContribs) {
    const item = document.createElement('div')
    item.className = 'contribution-item'
    item.style.setProperty('--contrib-color', contrib.color || '#6b7280')
    
    item.innerHTML = `
      <span class="contrib-label">${contrib.text || contrib.label || contrib.factor}</span>
      <span class="contrib-value">+${contrib.value || 0}</span>
    `
    
    container.appendChild(item)
  }
  
  if (displayContribs.length === 0) {
    container.innerHTML = '<div class="no-data">No significant contributors</div>'
  }
}

/**
 * Update metrics grid
 */
function updateMetrics(metrics) {
  const container = popoverElement.querySelector('.metrics-grid')
  if (!container) return
  
  container.innerHTML = ''
  
  const metricItems = [
    { key: 'views', label: 'Views', format: formatNumber },
    { key: 'subs', label: 'Subs', format: formatNumber },
    { key: 'age', label: 'Age', format: v => v || '--' },
    { key: 'velocity', label: 'Velocity', format: v => v || '--' },
    { key: 'thumbAbuse', label: 'Thumb', format: v => v || '--' },
    { key: 'titleBait', label: 'Title', format: v => v || '--' }
  ]
  
  for (const { key, label, format } of metricItems) {
    const value = metrics[key]
    
    const item = document.createElement('div')
    item.className = 'metric-item'
    item.innerHTML = `
      <span class="metric-value">${format(value)}</span>
      <span class="metric-label">${label}</span>
    `
    
    container.appendChild(item)
  }
}

/**
 * Update explanations list
 */
function updateExplanations(explanations) {
  const container = popoverElement.querySelector('.explanations-list')
  if (!container) return
  
  container.innerHTML = ''
  
  const displayExplanations = explanations.slice(0, 3)
  
  for (const exp of displayExplanations) {
    const item = document.createElement('div')
    item.className = 'explanation-item'
    
    item.innerHTML = `
      <div class="explanation-factor">${exp.factor || 'Analysis'}</div>
      <div class="explanation-text">${exp.text || exp}</div>
    `
    
    container.appendChild(item)
  }
  
  if (displayExplanations.length === 0) {
    container.innerHTML = '<div class="no-data">Hover longer for AI analysis</div>'
  }
}

/**
 * Format large numbers
 */
function formatNumber(num) {
  if (num === undefined || num === null) return '--'
  
  if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B'
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  
  return num.toString()
}

// ============================================
// EVENT HANDLING
// ============================================

/**
 * Show popover for a video
 */
function show(videoId, scoreData, triggerRect) {
  // Clear any pending hide
  clearTimeout(hideTimeout)
  
  // If already showing for this video, just update position
  if (currentVideoId === videoId && popoverElement?.classList.contains('visible')) {
    positionPopover(triggerRect)
    return
  }
  
  currentVideoId = videoId
  
  // Delay showing
  showTimeout = setTimeout(() => {
    if (!popoverElement) {
      popoverElement = createPopoverElement()
      document.body.appendChild(popoverElement)
    }
    
    updatePopoverContent(scoreData)
    positionPopover(triggerRect)
    
    // Show with animation
    requestAnimationFrame(() => {
      popoverElement.classList.add('visible')
    })
  }, HOVER_DELAY)
}

/**
 * Hide the popover
 */
function hide() {
  clearTimeout(showTimeout)
  
  if (!popoverElement) return
  
  hideTimeout = setTimeout(() => {
    if (!isHovering) {
      popoverElement.classList.remove('visible')
      currentVideoId = null
    }
  }, HIDE_DELAY)
}

/**
 * Handle mouse entering popover
 */
function handlePopoverEnter() {
  isHovering = true
  clearTimeout(hideTimeout)
}

/**
 * Handle mouse leaving popover
 */
function handlePopoverLeave() {
  isHovering = false
  hide()
}

/**
 * Handle hover events from card overlay
 */
function handleOverlayHover(event) {
  if (event.type === 'enter') {
    show(event.videoId, event.scoreData, event.position)
  } else if (event.type === 'leave') {
    hide()
  }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Initialize popover system
 */
function init() {
  injectStyles()
  
  // Register with card overlay
  if (window.BiasCardOverlay) {
    window.BiasCardOverlay.onHover(handleOverlayHover)
  }
}

/**
 * Inject popover styles
 */
function injectStyles() {
  const styleId = 'bias-popover-styles'
  
  if (document.getElementById(styleId)) {
    return
  }
  
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = getPopoverStyles()
  document.head.appendChild(style)
}

/**
 * Remove popover
 */
function remove() {
  if (popoverElement) {
    popoverElement.remove()
    popoverElement = null
  }
  currentVideoId = null
}

/**
 * Force update content
 */
function update(scoreData) {
  updatePopoverContent(scoreData)
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.BiasPopover = {
    init,
    show,
    hide,
    update,
    remove,
    handleOverlayHover,
    POPOVER_ID
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    init,
    show,
    hide,
    update,
    remove,
    handleOverlayHover,
    POPOVER_ID
  }
}

})(); // End IIFE
