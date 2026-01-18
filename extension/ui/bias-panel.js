/**
 * Feed Bias Panel Component
 * 
 * A collapsible panel in the top-right showing overall feed analysis:
 * - Average bias score
 * - Topic dominance chart
 * - Channel concentration
 * - Manipulation/commercial prevalence
 */

;(function() {
'use strict';

// ============================================
// CONSTANTS
// ============================================

const PANEL_ID = 'bias-panel'

// ============================================
// STATE
// ============================================

let panelElement = null
let isExpanded = false
let feedAnalysis = null

// ============================================
// PANEL CREATION
// ============================================

/**
 * Create the panel element
 */
function createPanelElement() {
  const panel = document.createElement('div')
  panel.id = PANEL_ID
  panel.className = 'bias-panel collapsed'
  
  panel.innerHTML = `
    <div class="panel-header" role="button" tabindex="0">
      <div class="panel-title-row">
        <span class="panel-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
        </span>
        <span class="panel-title">Feed Analysis</span>
        <span class="panel-toggle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </div>
    </div>
    
    <div class="panel-summary">
      <div class="summary-stat" data-stat="avgBias">
        <span class="stat-value">--</span>
        <span class="stat-label">Avg Bias</span>
      </div>
      <div class="summary-stat" data-stat="highBias">
        <span class="stat-value">--</span>
        <span class="stat-label">High Bias</span>
      </div>
      <div class="summary-stat" data-stat="channels">
        <span class="stat-value">--</span>
        <span class="stat-label">Channels</span>
      </div>
    </div>
    
    <div class="panel-details">
      <div class="detail-section topic-section">
        <div class="section-header">
          <span class="section-title">Topic Dominance</span>
          <span class="section-badge diversity-badge">--</span>
        </div>
        <div class="topic-bars"></div>
      </div>
      
      <div class="detail-section channel-section">
        <div class="section-header">
          <span class="section-title">Channel Concentration</span>
        </div>
        <div class="channel-chart">
          <div class="channel-donut">
            <svg viewBox="0 0 36 36" class="donut-svg">
              <circle class="donut-ring" cx="18" cy="18" r="15.9"/>
              <circle class="donut-segment" cx="18" cy="18" r="15.9" stroke-dasharray="0 100"/>
            </svg>
            <div class="donut-center">
              <span class="donut-value">--</span>
              <span class="donut-label">Top 5</span>
            </div>
          </div>
          <div class="channel-list"></div>
        </div>
      </div>
      
      <div class="detail-section manipulation-section">
        <div class="section-header">
          <span class="section-title">Content Quality</span>
        </div>
        <div class="quality-bars">
          <div class="quality-item" data-quality="manipulation">
            <span class="quality-label">Manipulation</span>
            <div class="quality-bar-container">
              <div class="quality-bar"></div>
            </div>
            <span class="quality-value">--</span>
          </div>
          <div class="quality-item" data-quality="commercial">
            <span class="quality-label">Commercial</span>
            <div class="quality-bar-container">
              <div class="quality-bar"></div>
            </div>
            <span class="quality-value">--</span>
          </div>
        </div>
      </div>
      
      <div class="detail-section recommendations-section">
        <div class="section-header">
          <span class="section-title">Recommendations</span>
        </div>
        <div class="recommendations-list"></div>
      </div>
      
      <div class="panel-footer">
        <button class="refresh-btn" title="Refresh analysis">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6"/>
            <path d="M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
          Refresh
        </button>
        <span class="last-updated">Updated just now</span>
      </div>
    </div>
  `
  
  // Add event listeners
  const header = panel.querySelector('.panel-header')
  header.addEventListener('click', toggleExpanded)
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleExpanded()
    }
  })
  
  const refreshBtn = panel.querySelector('.refresh-btn')
  refreshBtn.addEventListener('click', handleRefresh)
  
  return panel
}

/**
 * Get panel styles
 */
function getPanelStyles() {
  return `
    .bias-panel {
      position: fixed;
      top: 70px;
      right: 20px;
      width: 280px;
      background: #1a1a1a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      font-family: "YouTube Sans", "Roboto", sans-serif;
      z-index: 9998;
      overflow: hidden;
      transition: all 0.3s ease;
      display: none;
    }
    
    .bias-panel.visible {
      display: block;
    }
    
    .bias-panel.collapsed {
      width: 200px;
    }
    
    .bias-panel.expanded {
      width: 320px;
    }
    
    /* Header */
    .panel-header {
      padding: 12px 14px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s ease;
    }
    
    .panel-header:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    
    .panel-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .panel-icon {
      display: flex;
      align-items: center;
      color: #10b981;
    }
    
    .panel-title {
      flex: 1;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
    }
    
    .panel-toggle {
      display: flex;
      align-items: center;
      color: #666;
      transition: transform 0.3s ease;
    }
    
    .bias-panel.expanded .panel-toggle {
      transform: rotate(180deg);
    }
    
    /* Summary Stats */
    .panel-summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      padding: 0 14px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .summary-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 4px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 8px;
    }
    
    .stat-value {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
    }
    
    .summary-stat[data-stat="avgBias"] .stat-value {
      color: #f97316;
    }
    
    .summary-stat[data-stat="highBias"] .stat-value {
      color: #ef4444;
    }
    
    .stat-label {
      font-size: 9px;
      color: #666;
      margin-top: 2px;
    }
    
    /* Details */
    .panel-details {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }
    
    .bias-panel.expanded .panel-details {
      max-height: 500px;
    }
    
    .detail-section {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    
    .detail-section:last-of-type {
      border-bottom: none;
    }
    
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    
    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .section-badge {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    
    .diversity-badge {
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
    }
    
    .diversity-badge.low {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }
    
    /* Topic Bars */
    .topic-bars {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .topic-bar-item {
      display: grid;
      grid-template-columns: 80px 1fr 30px;
      align-items: center;
      gap: 8px;
    }
    
    .topic-name {
      font-size: 11px;
      color: #aaa;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .topic-bar-container {
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    
    .topic-bar {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    
    .topic-pct {
      font-size: 10px;
      color: #888;
      text-align: right;
    }
    
    /* Channel Chart */
    .channel-chart {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    
    .channel-donut {
      position: relative;
      width: 70px;
      height: 70px;
      flex-shrink: 0;
    }
    
    .donut-svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }
    
    .donut-ring {
      fill: none;
      stroke: rgba(255, 255, 255, 0.1);
      stroke-width: 3;
    }
    
    .donut-segment {
      fill: none;
      stroke: #f97316;
      stroke-width: 3;
      stroke-linecap: round;
      transition: stroke-dasharray 0.5s ease;
    }
    
    .donut-center {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }
    
    .donut-value {
      display: block;
      font-size: 14px;
      font-weight: 700;
      color: #fff;
    }
    
    .donut-label {
      display: block;
      font-size: 8px;
      color: #666;
    }
    
    .channel-list {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .channel-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
    }
    
    .channel-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f97316;
    }
    
    .channel-name {
      flex: 1;
      color: #aaa;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .channel-count {
      color: #666;
    }
    
    /* Quality Bars */
    .quality-bars {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .quality-item {
      display: grid;
      grid-template-columns: 80px 1fr 30px;
      align-items: center;
      gap: 8px;
    }
    
    .quality-label {
      font-size: 11px;
      color: #aaa;
    }
    
    .quality-bar-container {
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    
    .quality-bar {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    
    .quality-item[data-quality="manipulation"] .quality-bar {
      background: #ef4444;
    }
    
    .quality-item[data-quality="commercial"] .quality-bar {
      background: #06b6d4;
    }
    
    .quality-value {
      font-size: 10px;
      color: #888;
      text-align: right;
    }
    
    /* Recommendations */
    .recommendations-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .recommendation-item {
      padding: 8px 10px;
      background: rgba(249, 115, 22, 0.1);
      border-radius: 6px;
      border-left: 2px solid #f97316;
    }
    
    .recommendation-item.high {
      background: rgba(239, 68, 68, 0.1);
      border-left-color: #ef4444;
    }
    
    .recommendation-text {
      font-size: 11px;
      color: #ccc;
      line-height: 1.4;
    }
    
    /* Footer */
    .panel-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .refresh-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border: none;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      color: #aaa;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    
    .refresh-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    
    .last-updated {
      font-size: 10px;
      color: #666;
    }
    
    /* Responsive */
    @media (max-width: 600px) {
      .bias-panel {
        right: 10px;
        width: 180px;
      }
      
      .bias-panel.expanded {
        width: 280px;
      }
    }
  `
}

// ============================================
// PANEL INJECTION
// ============================================

/**
 * Inject the panel into the page
 */
function injectPanel() {
  if (document.getElementById(PANEL_ID)) {
    panelElement = document.getElementById(PANEL_ID)
    return panelElement
  }
  
  injectStyles()
  
  panelElement = createPanelElement()
  document.body.appendChild(panelElement)
  
  console.log('[BiasLens] Panel injected successfully')
  
  return panelElement
}

/**
 * Inject panel styles
 */
function injectStyles() {
  const styleId = 'bias-panel-styles'
  
  if (document.getElementById(styleId)) {
    return
  }
  
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = getPanelStyles()
  document.head.appendChild(style)
}

// ============================================
// STATE MANAGEMENT
// ============================================

/**
 * Show the panel
 */
function show() {
  if (panelElement) {
    panelElement.classList.add('visible')
  }
}

/**
 * Hide the panel
 */
function hide() {
  if (panelElement) {
    panelElement.classList.remove('visible')
  }
}

/**
 * Toggle expanded state
 */
function toggleExpanded() {
  isExpanded = !isExpanded
  
  if (panelElement) {
    if (isExpanded) {
      panelElement.classList.add('expanded')
      panelElement.classList.remove('collapsed')
    } else {
      panelElement.classList.remove('expanded')
      panelElement.classList.add('collapsed')
    }
  }
}

/**
 * Update panel with feed analysis data
 */
function updateAnalysis(analysis) {
  if (!panelElement || !analysis) return
  
  feedAnalysis = analysis
  
  // Handle both old and new data formats
  const avgBias = analysis.avgBias || analysis.averageBiasScore || 0
  const totalVideos = analysis.totalVideos || 20
  
  // Calculate high bias percentage from biasLevels
  let highBiasPercent = 0
  if (analysis.distribution?.high !== undefined) {
    highBiasPercent = analysis.distribution.high
  } else if (analysis.biasLevels) {
    highBiasPercent = Math.round(((analysis.biasLevels.high || 0) / totalVideos) * 100)
  }
  
  // Get channel count
  const channelCount = analysis.channelConcentration?.topChannels?.length || 
                       analysis.topChannels?.length || 0
  
  // Update summary stats
  updateSummaryStat('avgBias', avgBias)
  updateSummaryStat('highBias', `${highBiasPercent}%`)
  updateSummaryStat('channels', channelCount)
  
  // Update topic bars - handle both formats
  const topicData = analysis.topicDominance || []
  updateTopicBars(topicData)
  
  // Update channel concentration - handle new topChannels format
  const channelData = analysis.channelConcentration || {}
  if (!channelData.topChannels && analysis.topChannels) {
    channelData.topChannels = analysis.topChannels.map(c => ({
      name: c.name,
      videos: c.count
    }))
  }
  updateChannelChart(channelData)
  
  // Update quality bars - derive from biasLevels if available
  const manipulationPct = analysis.manipulationPrevalence || 
    Math.round((analysis.biasLevels?.high || 0) / totalVideos * 100)
  const commercialPct = analysis.commercialPrevalence || 0
  
  updateQualityBar('manipulation', manipulationPct)
  updateQualityBar('commercial', commercialPct)
  
  // Update recommendations
  updateRecommendations(analysis.recommendations || [])
  
  // Update timestamp
  const lastUpdated = panelElement.querySelector('.last-updated')
  if (lastUpdated) {
    lastUpdated.textContent = 'Updated just now'
  }
}

/**
 * Update a summary stat
 */
function updateSummaryStat(stat, value) {
  const statEl = panelElement.querySelector(`.summary-stat[data-stat="${stat}"] .stat-value`)
  if (statEl) {
    statEl.textContent = value
  }
}

/**
 * Update topic bars
 */
function updateTopicBars(topics) {
  const container = panelElement.querySelector('.topic-bars')
  if (!container) return
  
  container.innerHTML = ''
  
  const displayTopics = topics.slice(0, 5)
  
  for (const topic of displayTopics) {
    const item = document.createElement('div')
    item.className = 'topic-bar-item'
    
    const pct = Math.round((topic.weight || 0) * 100)
    
    item.innerHTML = `
      <span class="topic-name">${topic.name}</span>
      <div class="topic-bar-container">
        <div class="topic-bar" style="width: ${pct}%"></div>
      </div>
      <span class="topic-pct">${pct}%</span>
    `
    
    container.appendChild(item)
  }
  
  // Update diversity badge
  const diversityBadge = panelElement.querySelector('.diversity-badge')
  if (diversityBadge) {
    const topWeight = displayTopics[0]?.weight || 0
    if (topWeight > 0.4) {
      diversityBadge.textContent = 'Low'
      diversityBadge.classList.add('low')
    } else {
      diversityBadge.textContent = 'Good'
      diversityBadge.classList.remove('low')
    }
  }
}

/**
 * Update channel concentration chart
 */
function updateChannelChart(concentration) {
  // Update donut
  const donutValue = panelElement.querySelector('.donut-value')
  const donutSegment = panelElement.querySelector('.donut-segment')
  
  const top5Share = concentration.top5Share || 0
  
  if (donutValue) {
    donutValue.textContent = `${top5Share}%`
  }
  
  if (donutSegment) {
    donutSegment.style.strokeDasharray = `${top5Share} ${100 - top5Share}`
  }
  
  // Update channel list
  const channelList = panelElement.querySelector('.channel-list')
  if (!channelList) return
  
  channelList.innerHTML = ''
  
  const channels = concentration.topChannels || []
  const colors = ['#f97316', '#ef4444', '#8b5cf6', '#3b82f6', '#06b6d4']
  
  for (let i = 0; i < Math.min(channels.length, 5); i++) {
    const channel = channels[i]
    const item = document.createElement('div')
    item.className = 'channel-item'
    
    item.innerHTML = `
      <span class="channel-dot" style="background: ${colors[i]}"></span>
      <span class="channel-name">${channel.name}</span>
      <span class="channel-count">${channel.count}</span>
    `
    
    channelList.appendChild(item)
  }
}

/**
 * Update quality bar
 */
function updateQualityBar(quality, value) {
  const item = panelElement.querySelector(`.quality-item[data-quality="${quality}"]`)
  if (!item) return
  
  const bar = item.querySelector('.quality-bar')
  const valueEl = item.querySelector('.quality-value')
  
  if (bar) bar.style.width = `${value}%`
  if (valueEl) valueEl.textContent = `${value}%`
}

/**
 * Update recommendations
 */
function updateRecommendations(recommendations) {
  const container = panelElement.querySelector('.recommendations-list')
  if (!container) return
  
  container.innerHTML = ''
  
  if (recommendations.length === 0) {
    container.innerHTML = '<div class="no-recommendations">Feed looks balanced!</div>'
    return
  }
  
  for (const rec of recommendations.slice(0, 3)) {
    const item = document.createElement('div')
    item.className = `recommendation-item ${rec.severity || ''}`
    
    item.innerHTML = `
      <div class="recommendation-text">${rec.message}</div>
    `
    
    container.appendChild(item)
  }
}

// ============================================
// EVENT HANDLING
// ============================================

/**
 * Handle refresh button click
 */
function handleRefresh() {
  // Dispatch custom event for main controller to handle
  const event = new CustomEvent('biasLensRefresh', { detail: { type: 'panel' } })
  document.dispatchEvent(event)
  
  // Update timestamp
  const lastUpdated = panelElement.querySelector('.last-updated')
  if (lastUpdated) {
    lastUpdated.textContent = 'Refreshing...'
  }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Initialize panel
 */
function init() {
  injectPanel()
}

/**
 * Remove panel
 */
function remove() {
  if (panelElement) {
    panelElement.remove()
    panelElement = null
  }
}

/**
 * Get current analysis
 */
function getAnalysis() {
  return feedAnalysis
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.BiasPanel = {
    init,
    show,
    hide,
    remove,
    updateAnalysis,
    getAnalysis,
    toggleExpanded,
    PANEL_ID
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    init,
    show,
    hide,
    remove,
    updateAnalysis,
    getAnalysis,
    toggleExpanded,
    PANEL_ID
  }
}

})(); // End IIFE
