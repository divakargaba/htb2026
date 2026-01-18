/**
 * Silenced by the Algorithm - Content Script
 * 
 * MERGED: Homepage Bias Lens + Watch Page Sidebar
 * 
 * - Homepage: Bias Lens toggle, Noise/Silenced tabs, card overlays, feed analysis panel
 * - Watch Page: Sidebar panel with noise analysis, sustainability audit, noise cancellation
 */

// ============================================
// SHARED STATE
// ============================================

const SUPABASE_URL = 'https://ntspwmgvabdpifzzebrv.supabase.co/functions/v1/recommend'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50c3B3bWd2YWJkcGlmenplYnJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MzIyNjIsImV4cCI6MjA4NDIwODI2Mn0.26ndaCrexA3g29FHrJB1uBKJIUW6E5yn-nbvarsBp4o'

// Watch page state
let currentVideoId = null
let panelInjected = false
let isOpen = true
let breakdownOpen = false
let silenceReportOpen = false
let noiseCancellationActive = false
let auditModeActive = false
let discoveryCache = null
let discoveryObserver = null
let processedVideoCards = new Set()
let processedThumbnails = new Set()
let shadowHost = null
let stats = { voicesUnmuted: 0, noiseMuted: 0 }
let channelSubCache = new Map()

// Homepage Bias Lens state
let biasLensEnabled = false
let activeTab = 'noise'
let feedVideoIds = []
let feedAnalysisData = null
let silencedVideosData = null
let isAnalyzing = false
let topicProfile = null

// ============================================
// HELPERS
// ============================================

const getVideoId = () => new URL(window.location.href).searchParams.get('v')
const isWatchPage = () => window.location.pathname === '/watch'
const isHomePage = () => window.location.pathname === '/' || window.location.pathname === ''
const isHomepage = () => {
  const path = window.location.pathname
  return path === '/' || path === '/feed/subscriptions' || path.startsWith('/feed/')
}
const isSearchPage = () => window.location.pathname === '/results'

function fmt(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

function esc(t) {
  if (!t) return ''
  const d = document.createElement('div')
  d.textContent = t
  return d.innerHTML
}

/**
 * Safely send a message to the background script, handling extension context invalidation
 */
function safeSendMessage(message, callback) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        console.warn('[Silenced] Extension context invalidated - runtime not available')
        if (callback) callback(null)
        resolve(null)
        return
      }

      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError
        if (lastError) {
          if (lastError.message && lastError.message.includes('Extension context invalidated')) {
            console.warn('[Silenced] Extension context invalidated - please reload the page')
            if (callback) callback(null)
            resolve(null)
            return
          }
          console.warn('[Silenced] Runtime error:', lastError.message)
        }

        if (callback) callback(response)
        resolve(response)
      })
    } catch (error) {
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[Silenced] Extension context invalidated - please reload the page')
      } else {
        console.error('[Silenced] Error sending message:', error)
      }
      if (callback) callback(null)
      resolve(null)
    }
  })
}

// ============================================
// HOMEPAGE BIAS LENS - State & Initialization
// ============================================

/**
 * Load Bias Lens state from storage
 */
async function loadBiasLensState() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get(['biasLensEnabled', 'activeTab'])
      biasLensEnabled = result.biasLensEnabled || false
      activeTab = result.activeTab || 'noise'
      console.log('[BiasLens] Loaded state:', { biasLensEnabled, activeTab })
    } else {
      console.warn('[BiasLens] Chrome storage not available, using defaults')
      biasLensEnabled = false
      activeTab = 'noise'
    }
  } catch (error) {
    console.warn('[BiasLens] Failed to load state:', error)
    biasLensEnabled = false
    activeTab = 'noise'
  }
}

/**
 * Save Bias Lens state to storage
 */
async function saveBiasLensState() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ biasLensEnabled, activeTab })
    }
  } catch (error) {
    console.warn('[BiasLens] Failed to save state:', error)
  }
}

/**
 * Initialize Homepage Bias Lens
 */
async function initHomepageBiasLens() {
  console.log('[BiasLens] Initializing homepage Bias Lens...')
  
  await loadBiasLensState()
  initializeBiasLensComponents()
  setupBiasLensEventListeners()
  
  console.log('[BiasLens] Homepage Bias Lens initialized')
}

/**
 * Initialize all Bias Lens UI components
 */
function initializeBiasLensComponents() {
  waitForBiasLensComponents(() => {
    if (window.BiasLensToggle) {
      window.BiasLensToggle.init()
      window.BiasLensToggle.onToggle(handleBiasLensToggle)
      if (biasLensEnabled) {
        window.BiasLensToggle.setState(true)
      }
    }
    
    if (window.BiasTabBar) {
      window.BiasTabBar.init()
      window.BiasTabBar.onTabChange(handleBiasLensTabChange)
    }
    
    if (window.BiasCardOverlay) {
      window.BiasCardOverlay.init()
    }
    
    if (window.BiasPopover) {
      window.BiasPopover.init()
    }
    
    if (window.BiasPanel) {
      window.BiasPanel.init()
    }
    
    if (window.SilencedGrid) {
      window.SilencedGrid.init()
    }
    
    if (biasLensEnabled) {
      activateBiasLens()
    }
  })
}

/**
 * Wait for Bias Lens UI components to be loaded
 */
function waitForBiasLensComponents(callback, maxAttempts = 10) {
  let attempts = 0
  
  const check = () => {
    attempts++
    
    const hasToggle = !!window.BiasLensToggle
    const hasTabBar = !!window.BiasTabBar
    const hasOverlay = !!window.BiasCardOverlay
    
    if (hasToggle && hasTabBar && hasOverlay) {
      console.log('[BiasLens] All components loaded!')
      callback()
    } else if (attempts < maxAttempts) {
      setTimeout(check, 50)
    } else {
      console.warn('[BiasLens] Components not loaded. Available:', {
        BiasLensToggle: hasToggle,
        BiasTabBar: hasTabBar,
        BiasCardOverlay: hasOverlay,
        ScoringEngine: !!window.ScoringEngine
      })
      callback()
    }
  }
  
  check()
}

// ============================================
// HOMEPAGE BIAS LENS - Event Handlers
// ============================================

function handleBiasLensToggle(enabled) {
  console.log('[BiasLens] Toggle changed:', enabled)
  biasLensEnabled = enabled
  saveBiasLensState()
  
  if (enabled) {
    activateBiasLens()
  } else {
    deactivateBiasLens()
  }
}

function handleBiasLensTabChange(tab) {
  console.log('[BiasLens] Tab changed:', tab)
  activeTab = tab
  saveBiasLensState()
  
  if (tab === 'noise') {
    showNoiseView()
  } else if (tab === 'silenced') {
    showSilencedView()
  }
}

function setupBiasLensEventListeners() {
  document.addEventListener('biasLensRefresh', handleBiasLensRefresh)
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleBiasLens') {
      if (window.BiasLensToggle) {
        const newState = !window.BiasLensToggle.getState()
        window.BiasLensToggle.setState(newState)
      }
      sendResponse({ success: true })
    }
    return false
  })
}

function handleBiasLensRefresh(event) {
  console.log('[BiasLens] Refresh requested:', event.detail)
  
  if (activeTab === 'noise') {
    analyzeHomepageFeed()
  } else {
    discoverSilencedVideos()
  }
}

// ============================================
// HOMEPAGE BIAS LENS - Activation
// ============================================

function activateBiasLens() {
  console.log('[BiasLens] Activating...')
  
  if (window.BiasTabBar) {
    window.BiasTabBar.show()
    window.BiasTabBar.setActiveTab(activeTab)
  }
  
  if (window.BiasPanel) {
    window.BiasPanel.show()
  }
  
  if (window.BiasCardOverlay) {
    window.BiasCardOverlay.enable()
  }
  
  if (activeTab === 'noise') {
    showNoiseView()
  } else {
    showSilencedView()
  }
  
  analyzeHomepageFeed()
}

function deactivateBiasLens() {
  console.log('[BiasLens] Deactivating...')
  
  if (window.BiasTabBar) {
    window.BiasTabBar.hide()
  }
  
  if (window.BiasPanel) {
    window.BiasPanel.hide()
  }
  
  if (window.BiasCardOverlay) {
    window.BiasCardOverlay.disable()
    window.BiasCardOverlay.removeAll()
  }
  
  if (window.SilencedGrid) {
    window.SilencedGrid.hide()
  }
}

// ============================================
// HOMEPAGE BIAS LENS - View Management
// ============================================

function showNoiseView() {
  console.log('[BiasLens] Showing Noise view')
  
  if (window.SilencedGrid) {
    window.SilencedGrid.hide()
  }
  
  if (window.BiasCardOverlay) {
    window.BiasCardOverlay.enable()
    window.BiasCardOverlay.processAllCards()
  }
  
  if (window.BiasTabBar) {
    window.BiasTabBar.updateHint('Showing YouTube\'s recommendations with bias analysis')
  }
}

function showSilencedView() {
  console.log('[BiasLens] Showing Silenced view')
  
  if (window.BiasCardOverlay) {
    window.BiasCardOverlay.disable()
  }
  
  if (window.SilencedGrid) {
    window.SilencedGrid.show()
    
    if (silencedVideosData) {
      window.SilencedGrid.updateVideos(silencedVideosData)
    } else {
      window.SilencedGrid.showLoading()
      discoverSilencedVideos()
    }
  }
  
  if (window.BiasTabBar) {
    window.BiasTabBar.updateHint('Showing high-quality videos the algorithm doesn\'t prioritize')
  }
}

// ============================================
// HOMEPAGE BIAS LENS - Analysis
// ============================================

async function analyzeHomepageFeed() {
  if (isAnalyzing) {
    console.log('[BiasLens] Analysis already in progress')
    return
  }
  
  isAnalyzing = true
  console.log('[BiasLens] Starting homepage analysis...')
  
  if (window.BiasTabBar) {
    window.BiasTabBar.updateHint('Analyzing feed...')
  }
  
  try {
    feedVideoIds = extractHomepageVideoIds()
    console.log(`[BiasLens] Found ${feedVideoIds.length} videos on page`)
    
    if (feedVideoIds.length === 0) {
      console.warn('[BiasLens] No videos found on page')
      isAnalyzing = false
      return
    }
    
    const videoTitles = extractHomepageVideoTitles()
    if (window.TopicAnalyzer) {
      topicProfile = window.TopicAnalyzer.buildTopicProfile(
        videoTitles.map((title, i) => ({ title, videoId: feedVideoIds[i] }))
      )
    }
    
    const response = await chrome.runtime.sendMessage({
      action: 'analyzeHomepage',
      videoIds: feedVideoIds,
      feedContext: {
        topics: topicProfile?.topics || []
      }
    })
    
    if (response.success) {
      feedAnalysisData = response.data
      updateBiasLensUIWithAnalysis(response.data)
      console.log('[BiasLens] Homepage analysis complete')
    } else {
      console.error('[BiasLens] Analysis failed:', response.error)
    }
    
  } catch (error) {
    console.error('[BiasLens] Analysis error:', error)
  }
  
  isAnalyzing = false
}

function extractHomepageVideoIds() {
  const videoIds = []
  const seen = new Set()
  
  const selectors = [
    'a#thumbnail[href*="watch?v="]',
    'a.ytd-thumbnail[href*="watch?v="]',
    'ytd-rich-item-renderer a[href*="watch?v="]'
  ]
  
  for (const selector of selectors) {
    const links = document.querySelectorAll(selector)
    
    for (const link of links) {
      const href = link.href || ''
      const match = href.match(/[?&]v=([^&]+)/)
      
      if (match && !seen.has(match[1])) {
        seen.add(match[1])
        videoIds.push(match[1])
      }
    }
  }
  
  return videoIds
}

function extractHomepageVideoTitles() {
  const titles = []
  
  const titleElements = document.querySelectorAll('#video-title, .ytd-rich-grid-media #video-title')
  
  for (const el of titleElements) {
    const title = el.textContent?.trim()
    if (title) {
      titles.push(title)
    }
  }
  
  return titles
}

function updateBiasLensUIWithAnalysis(data) {
  if (window.BiasCardOverlay && data.videos) {
    const scores = {}
    for (const video of data.videos) {
      scores[video.videoId] = {
        biasScore: video.biasScore,
        confidence: video.confidence,
        tags: video.tags,
        scores: video.scores,
        contributions: video.contributions,
        metrics: video.metrics
      }
    }
    window.BiasCardOverlay.setScores(scores)
  }
  
  if (window.BiasPanel && data.feedAnalysis) {
    const recommendations = generateBiasLensRecommendations(data.feedAnalysis)
    
    window.BiasPanel.updateAnalysis({
      ...data.feedAnalysis,
      recommendations
    })
  }
  
  if (window.BiasTabBar) {
    const highBiasCount = data.videos?.filter(v => v.biasScore >= 70).length || 0
    window.BiasTabBar.updateCounts(data.videos?.length || 0, '?')
    window.BiasTabBar.updateHint(`${highBiasCount} high-bias videos in your feed`)
  }
}

function generateBiasLensRecommendations(analysis) {
  const recommendations = []
  
  if (analysis.distribution?.high > 60) {
    recommendations.push({
      type: 'high_bias',
      message: `${analysis.distribution.high}% of your feed has high algorithmic advantage scores`,
      severity: 'high'
    })
  }
  
  if (analysis.channelConcentration?.top5Share > 50) {
    recommendations.push({
      type: 'channel_concentration',
      message: `Top 5 channels make up ${analysis.channelConcentration.top5Share}% of your feed`,
      severity: 'medium'
    })
  }
  
  if (analysis.avgBias > 60) {
    recommendations.push({
      type: 'avg_bias',
      message: 'Your feed is dominated by algorithmically advantaged content',
      severity: 'medium'
    })
  }
  
  return recommendations
}

// ============================================
// HOMEPAGE BIAS LENS - Silenced Discovery
// ============================================

async function discoverSilencedVideos() {
  console.log('[BiasLens] Discovering silenced videos...')
  
  if (window.SilencedGrid) {
    window.SilencedGrid.showLoading()
  }
  
  try {
    const excludedChannels = feedAnalysisData?.videos?.map(v => v.channelId) || []
    
    const response = await chrome.runtime.sendMessage({
      action: 'discoverSilenced',
      topicMap: topicProfile?.topics || [],
      excludedChannels,
      filters: {
        minViews: 10000,
        minSubs: 1000,
        requireTranscript: false
      }
    })
    
    if (response.success) {
      silencedVideosData = response.data.videos
      
      if (window.SilencedGrid) {
        window.SilencedGrid.updateVideos(silencedVideosData)
      }
      
      if (window.BiasTabBar) {
        window.BiasTabBar.updateCounts(undefined, silencedVideosData.length)
      }
      
      console.log(`[BiasLens] Found ${silencedVideosData.length} silenced videos`)
    } else {
      console.error('[BiasLens] Discovery failed:', response.error)
    }
    
  } catch (error) {
    console.error('[BiasLens] Discovery error:', error)
  }
}

// ============================================
// WATCH PAGE - Thumbnail Labeling Styles
// ============================================

function injectBiasReceiptStyles() {
  if (document.getElementById('silenced-bias-receipt-styles')) return

  const style = document.createElement('style')
  style.id = 'silenced-bias-receipt-styles'
  style.textContent = `
    .silenced-bias-receipt {
      margin-top: 8px;
      border-top: 1px solid #262626;
      padding-top: 8px;
    }

    .silenced-bias-receipt-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 4px 0;
      user-select: none;
    }

    .silenced-bias-receipt-toggle:hover .silenced-receipt-title {
      color: #d1d5db;
    }

    .silenced-receipt-title {
      font-size: 10px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .silenced-receipt-method {
      font-size: 8px;
      font-weight: 500;
      color: #4b5563;
      background: #1f1f1f;
      padding: 2px 5px;
      border-radius: 3px;
      text-transform: uppercase;
    }

    .silenced-receipt-method.fallback {
      color: #9ca3af;
    }

    .silenced-receipt-arrow {
      font-size: 10px;
      color: #6b7280;
      transition: transform 0.2s ease;
    }

    .silenced-bias-receipt.open .silenced-receipt-arrow {
      transform: rotate(180deg);
    }

    .silenced-receipt-content {
      display: none;
      padding: 8px 0 4px;
    }

    .silenced-bias-receipt.open .silenced-receipt-content {
      display: block;
    }

    .silenced-receipt-section {
      margin-bottom: 8px;
    }

    .silenced-receipt-section:last-child {
      margin-bottom: 0;
    }

    .silenced-receipt-section-title {
      font-size: 9px;
      font-weight: 600;
      color: #ef4444;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .silenced-receipt-section-title.surfaced {
      color: #10b981;
    }

    .silenced-receipt-bullets {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .silenced-receipt-bullets li {
      font-size: 10px;
      color: #9ca3af;
      line-height: 1.4;
      padding: 2px 0;
      padding-left: 10px;
      position: relative;
    }

    .silenced-receipt-bullets li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #4b5563;
    }

    .silenced-confidence-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #262626;
      display: inline-block;
    }

    .silenced-confidence-dot.filled {
      background: #6b7280;
    }

    .silenced-confidence-dot.filled.high {
      background: #10b981;
    }

    .silenced-confidence-dot.filled.medium {
      background: #f59e0b;
    }

    .silenced-confidence-dot.filled.low {
      background: #6b7280;
    }
  `
  document.head.appendChild(style)
}

function injectThumbnailStyles() {
  if (document.getElementById('silenced-thumbnail-styles')) return

  const style = document.createElement('style')
  style.id = 'silenced-thumbnail-styles'
  style.textContent = `
    .silenced-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
      z-index: 100;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    }
    
    .silenced-badge.noise {
      background: #FF1744;
      color: white;
      animation: noisePulse 2s ease-in-out infinite;
    }
    
    .silenced-badge.amplified {
      background: #FF6D00;
      color: white;
    }
    
    .silenced-badge.silenced {
      background: #00E676;
      color: black;
    }
    
    .silenced-badge.quiet {
      background: #00BFA5;
      color: black;
    }
    
    @keyframes noisePulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.8; }
    }
    
    .silenced-dimmed {
      opacity: 0.3;
      filter: grayscale(0.5);
      transition: opacity 0.3s ease, filter 0.3s ease;
    }
    
    .silenced-dimmed:hover {
      opacity: 0.7;
      filter: grayscale(0.2);
    }
    
    .silenced-highlighted {
      outline: 3px solid #00E676;
      outline-offset: -3px;
    }
    
    .silenced-channel-info {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(transparent, rgba(0,0,0,0.9));
      padding: 24px 8px 8px;
      font-family: 'Roboto', sans-serif;
      z-index: 99;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    
    ytd-rich-item-renderer:hover .silenced-channel-info,
    ytd-video-renderer:hover .silenced-channel-info,
    ytd-compact-video-renderer:hover .silenced-channel-info {
      opacity: 1;
    }
    
    .silenced-channel-info .subs {
      font-size: 11px;
      color: #aaa;
    }
    
    .silenced-channel-info .label {
      font-size: 10px;
      font-weight: 700;
      margin-top: 2px;
    }
    
    .silenced-channel-info .label.noise { color: #FF5252; }
    .silenced-channel-info .label.silenced { color: #00E676; }
  `
  document.head.appendChild(style)
}

async function getChannelSubs(channelHandle) {
  if (channelSubCache.has(channelHandle)) {
    return channelSubCache.get(channelHandle)
  }

  return safeSendMessage({
    action: 'getChannelByHandle',
    handle: channelHandle
  }).then(response => {
    const subs = response?.subscriberCount || 0
    channelSubCache.set(channelHandle, subs)
    return subs
  })
}

async function labelVideoThumbnails() {
  if (!noiseCancellationActive) return

  const videoCards = document.querySelectorAll(`
    ytd-rich-item-renderer,
    ytd-video-renderer,
    ytd-compact-video-renderer,
    ytd-grid-video-renderer
  `)

  for (const card of videoCards) {
    const videoId = card.querySelector('a#thumbnail')?.href?.match(/[?&]v=([^&]+)/)?.[1]
    if (!videoId || processedThumbnails.has(videoId)) continue
    processedThumbnails.add(videoId)

    const channelLink = card.querySelector('a.yt-formatted-string[href^="/@"], ytd-channel-name a, a[href^="/@"]')
    const channelHandle = channelLink?.getAttribute('href')?.replace('/@', '') || ''

    let subs = 0
    if (channelHandle) {
      subs = await getChannelSubs(channelHandle)
    }

    let noiseLevel = 'unknown'
    let badgeText = ''

    if (subs >= 1000000) {
      noiseLevel = 'noise'
      badgeText = 'DOMINANT'
    } else if (subs >= 500000) {
      noiseLevel = 'amplified'
      badgeText = 'AMPLIFIED'
    } else if (subs >= 100000) {
      noiseLevel = 'moderate'
      badgeText = ''
    } else if (subs > 0) {
      noiseLevel = 'silenced'
      badgeText = 'SILENCED'
    }

    const thumbnail = card.querySelector('#thumbnail, ytd-thumbnail')
    if (thumbnail && badgeText) {
      thumbnail.style.position = 'relative'
      thumbnail.querySelector('.silenced-badge')?.remove()

      const badge = document.createElement('div')
      badge.className = `silenced-badge ${noiseLevel}`
      badge.textContent = badgeText
      thumbnail.appendChild(badge)

      if (noiseLevel === 'noise' || noiseLevel === 'amplified') {
        card.classList.add('silenced-dimmed')
      } else if (noiseLevel === 'silenced') {
        card.classList.add('silenced-highlighted')
      }
    }
  }
}

function clearThumbnailLabels() {
  document.querySelectorAll('.silenced-badge').forEach(el => el.remove())
  document.querySelectorAll('.silenced-dimmed').forEach(el => el.classList.remove('silenced-dimmed'))
  document.querySelectorAll('.silenced-highlighted').forEach(el => el.classList.remove('silenced-highlighted'))
  processedThumbnails.clear()
}

// ============================================
// WATCH PAGE - Noise Cancellation State
// ============================================

async function loadNoiseCancellationState() {
  const response = await safeSendMessage({ action: 'getNoiseCancellation' })
  noiseCancellationActive = response?.enabled || false
  return noiseCancellationActive
}

async function saveNoiseCancellationState(enabled) {
  await safeSendMessage({ action: 'setNoiseCancellation', enabled })
}

async function updateStats(voicesUnmuted = 0, noiseMuted = 0) {
  stats.voicesUnmuted += voicesUnmuted
  stats.noiseMuted += noiseMuted
  await chrome.storage.local.set({
    discoveredCount: stats.voicesUnmuted,
    hiddenCount: stats.noiseMuted
  })
}

// ============================================
// WATCH PAGE - Shadow DOM
// ============================================

function createShadowContainer(id, hostElement) {
  const host = document.createElement('div')
  host.id = id
  host.setAttribute('data-silenced', 'true')

  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = getShadowStyles()
  shadow.appendChild(style)

  const container = document.createElement('div')
  container.className = 'silenced-container'
  shadow.appendChild(container)

  if (hostElement) {
    hostElement.insertBefore(host, hostElement.firstChild)
  }

  return { host, shadow, container }
}

function getShadowStyles() {
  return `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    .silenced-container {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #d1d5db;
      font-size: 13px;
      line-height: 1.5;
    }

    .silenced-panel {
      background: #111111;
      border: 1px solid #262626;
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid #262626;
    }

    .header-brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .brand-name {
      font-size: 14px;
      font-weight: 600;
      color: #f5f5f5;
      letter-spacing: -0.3px;
    }
    
    .header-tier {
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .header-tier.dominant { background: #dc2626; color: white; }
    .header-tier.amplified { background: #f97316; color: white; }
    .header-tier.established { background: #f59e0b; color: #111; }
    .header-tier.emerging { background: #22c55e; color: #111; }
    .header-tier.under-represented { background: #10b981; color: #111; }

    .score-section {
      padding: 14px;
      border-bottom: 1px solid #262626;
    }

    .score-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .channel-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
      background: #262626;
    }

    .channel-info {
      flex: 1;
      min-width: 0;
    }

    .channel-name {
      font-size: 13px;
      font-weight: 500;
      color: #f5f5f5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .channel-meta {
      font-size: 11px;
      color: #6b7280;
      margin-top: 1px;
    }

    .score-badge {
      text-align: center;
      min-width: 52px;
    }
    
    .score-value {
      font-size: 20px;
      font-weight: 700;
      line-height: 1;
    }

    .score-value.high { color: #ef4444; }
    .score-value.medium { color: #f59e0b; }
    .score-value.low { color: #10b981; }
    
    .score-label {
      font-size: 8px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }

    .explain-section {
      padding: 10px 14px;
      border-bottom: 1px solid #262626;
      font-size: 12px;
      color: #9ca3af;
      line-height: 1.5;
    }

    .explain-section.advantaged {
      border-left: 3px solid #ef4444;
    }

    .explain-section.underrepresented {
      border-left: 3px solid #10b981;
    }

    .explain-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .explain-list li {
      padding: 2px 0;
      padding-left: 12px;
      position: relative;
    }
    
    .explain-list li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #6b7280;
    }

    .action-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .action-toggle:hover {
      background: #1a1a1a;
    }

    .action-toggle.active {
      background: #10b98110;
    }

    .toggle-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .toggle-text {
      line-height: 1.3;
    }

    .toggle-title {
      font-size: 12px;
      font-weight: 500;
      color: #f5f5f5;
    }

    .toggle-desc {
      font-size: 10px;
      color: #6b7280;
    }
    
    .toggle-switch {
      width: 40px;
      height: 22px;
      background: #404040;
      border-radius: 11px;
      position: relative;
      transition: background 0.2s ease;
    }

    .toggle-switch.on {
      background: #10b981;
    }

    .toggle-knob {
      width: 18px;
      height: 18px;
      background: white;
      border-radius: 50%;
      position: absolute;
      top: 2px;
      left: 2px;
      transition: transform 0.2s ease;
    }

    .toggle-switch.on .toggle-knob {
      transform: translateX(18px);
    }

    .panel-footer {
      display: flex;
      justify-content: space-between;
      padding: 8px 14px;
      border-top: 1px solid #262626;
      font-size: 10px;
      color: #4b5563;
    }

    .panel-footer a {
      color: #10b981;
      cursor: pointer;
      text-decoration: none;
    }
    
    .panel-footer a:hover {
      text-decoration: underline;
    }
    
    .loading-state {
      padding: 32px;
      text-align: center;
    }
    
    .spinner {
      width: 28px;
      height: 28px;
      border: 2px solid #262626;
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 10px;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .loading-text {
      font-size: 11px;
      color: #6b7280;
    }
  `
}

// ============================================
// WATCH PAGE - Dashboard
// ============================================

let currentAnalysisData = null

function createDashboard(data) {
  const { noiseAnalysis, video, channel, sustainability } = data
  const score = noiseAnalysis?.totalScore || 0
  const tier = noiseAnalysis?.exposureTier || noiseAnalysis?.noiseLevel || { label: 'Unknown', color: '#6b7280' }
  const subs = channel?.subscriberCount || 0
  const explainReasons = noiseAnalysis?.explainReasons || []

  const isAdvantaged = score > 50
  const tierClass = score > 80 ? 'dominant' : score > 60 ? 'amplified' : score > 40 ? 'established' : score > 20 ? 'emerging' : 'under-represented'
  const scoreClass = score > 60 ? 'high' : score > 40 ? 'medium' : 'low'

  const explainHtml = explainReasons.length > 0
    ? `<ul class="explain-list">${explainReasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`
    : `<p>${isAdvantaged ? 'This channel has significant platform advantage.' : 'This creator has limited algorithmic visibility.'}</p>`

  return `
    <div class="silenced-panel">
      <div class="panel-header">
        <div class="header-brand">
          <span class="brand-name">silenced</span>
        </div>
        <div class="header-tier ${tierClass}">${tier.label}</div>
      </div>
        
      <div class="score-section">
        <div class="score-row">
          ${channel?.thumbnail
      ? `<img class="channel-avatar" src="${channel.thumbnail}" alt="">`
      : '<div class="channel-avatar"></div>'}
          <div class="channel-info">
            <div class="channel-name">${esc(video?.channel || 'Unknown')}</div>
            <div class="channel-meta">${fmt(subs)} subscribers</div>
          </div>
          <div class="score-badge">
            <div class="score-value ${scoreClass}">${score}</div>
            <div class="score-label">Advantage</div>
          </div>
        </div>
      </div>

      <div class="explain-section ${isAdvantaged ? 'advantaged' : 'underrepresented'}">
        ${explainHtml}
      </div>
          
      <div class="action-toggle ${noiseCancellationActive ? 'active' : ''}" id="noise-cancel-toggle">
        <div class="toggle-left">
          <div class="toggle-text">
            <div class="toggle-title">${noiseCancellationActive ? 'Showing Silenced Voices' : 'Surface Under-represented Creators'}</div>
            <div class="toggle-desc">${noiseCancellationActive ? 'Alternatives shown below' : 'Find creators the algorithm misses'}</div>
          </div>
        </div>
        <div class="toggle-switch ${noiseCancellationActive ? 'on' : ''}">
          <div class="toggle-knob"></div>
        </div>
      </div>
        
      <div class="panel-footer">
        <span>Hack the Bias '26</span>
        <a id="refresh-btn">Refresh</a>
      </div>
    </div>
  `
}

function injectDashboard(data) {
  const sidebar = document.querySelector('#secondary-inner') || document.querySelector('#secondary')
  if (!sidebar) return false

  currentAnalysisData = data

  document.querySelector('#silenced-shadow-host')?.remove()

  const { host, shadow, container } = createShadowContainer('silenced-shadow-host', sidebar)
  shadowHost = host

  container.innerHTML = createDashboard(data)

  const noiseCancelToggle = shadow.getElementById('noise-cancel-toggle')
  const refreshBtn = shadow.getElementById('refresh-btn')

  noiseCancelToggle?.addEventListener('click', () => {
    window.silencedToggleNoiseCancellation()
    const switchEl = noiseCancelToggle.querySelector('.toggle-switch')
    switchEl?.classList.toggle('on', noiseCancellationActive)
    noiseCancelToggle.classList.toggle('active', noiseCancellationActive)

    const title = noiseCancelToggle.querySelector('.toggle-title')
    const desc = noiseCancelToggle.querySelector('.toggle-desc')
    if (title) title.textContent = noiseCancellationActive ? 'Noise Cancellation ON' : 'Unmute the Silenced'
    if (desc) desc.textContent = noiseCancellationActive ? 'Showing hidden voices below ↓' : 'Reveal smaller creators on this topic'
  })

  refreshBtn?.addEventListener('click', () => {
    currentVideoId = null
    panelInjected = false
    runWatchPage()
  })

  panelInjected = true
  return true
}

// ============================================
// WATCH PAGE - Noise Cancellation
// ============================================

async function runNoiseCancellation(query) {
  if (!query) {
    query = extractCurrentQuery()
  }

  console.log('[Silenced] 🎚 Activating noise cancellation for:', query)

  const response = await safeSendMessage({ action: 'cancelNoise', query })
  if (response?.success) {
    discoveryCache = response.data
    console.log('[Silenced] ✔ Noise cancellation complete:', response.data)
    return response.data
  } else {
    console.error('[Silenced] ✗ Noise cancellation failed:', response?.error)
    return null
  }
}

function extractCurrentQuery() {
  if (isSearchPage()) {
    return new URLSearchParams(window.location.search).get('search_query') || ''
  }

  if (isWatchPage()) {
    const titleSelectors = [
      'h1.ytd-video-primary-info-renderer',
      'h1.ytd-watch-metadata',
      'yt-formatted-string.ytd-watch-metadata',
      '#title h1',
      '#title yt-formatted-string',
      'h1.title',
      '#above-the-fold #title yt-formatted-string',
      'ytd-watch-metadata h1 yt-formatted-string',
      '#info-contents h1',
      '[itemprop="name"]'
    ]

    let title = null
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector)
      if (el?.textContent?.trim()) {
        title = el.textContent.trim()
        break
      }
    }

    if (!title) {
      const pageTitle = document.title.replace(' - YouTube', '').trim()
      if (pageTitle && pageTitle !== 'YouTube') {
        title = pageTitle
      }
    }

    if (title) {
      const query = title.split(/[-|:•]/).slice(0, 2).join(' ').trim()
      return query
    }
  }

  return 'sustainability climate environment'
}

window.silencedToggleNoiseCancellation = async function () {
  noiseCancellationActive = !noiseCancellationActive
  await saveNoiseCancellationState(noiseCancellationActive)

  if (shadowHost) {
    const toggle = shadowHost.shadowRoot?.querySelector('#noise-cancel-toggle')
    const switchEl = toggle?.querySelector('.toggle-switch')
    switchEl?.classList.toggle('on', noiseCancellationActive)
    toggle?.classList.toggle('active', noiseCancellationActive)

    const title = toggle?.querySelector('.toggle-title')
    const desc = toggle?.querySelector('.toggle-desc')
    if (title) title.textContent = noiseCancellationActive ? 'Noise Cancellation ON' : 'Unmute the Silenced'
    if (desc) desc.textContent = noiseCancellationActive ? 'Showing hidden voices below ↓' : 'Reveal smaller creators on this topic'
  }

  const floatingToggle = document.getElementById('silenced-noise-toggle')
  if (floatingToggle) {
    floatingToggle.classList.toggle('active', noiseCancellationActive)
    const statusEl = floatingToggle.querySelector('.toggle-status')
    if (statusEl) statusEl.textContent = noiseCancellationActive ? 'ACTIVE' : 'OFF'
  }

  if (noiseCancellationActive) {
    const query = extractCurrentQuery()
    await runNoiseCancellation(query)

    muteNoisyVideos()
    injectUnmutedVoices()
    setupNoiseCancellationObserver()

    if (!isWatchPage()) {
      injectThumbnailStyles()
      labelVideoThumbnails()
    }

    if (discoveryCache) {
      await updateStats(discoveryCache.unmutedVideos?.length || 0, discoveryCache.channelsToMute?.length || 0)
    }
  } else {
    document.querySelectorAll('[data-silenced-muted]').forEach(el => {
      el.style.display = ''
      el.removeAttribute('data-silenced-muted')
    })

    document.querySelectorAll('.silenced-unmuted-container').forEach(el => el.remove())
    clearThumbnailLabels()

    if (discoveryObserver) {
      discoveryObserver.disconnect()
      discoveryObserver = null
    }
  }

  console.log('[Silenced] 🎚 Noise Cancellation:', noiseCancellationActive ? 'ACTIVE' : 'OFF')
}

window.silencedToggleDiscovery = window.silencedToggleNoiseCancellation

function muteNoisyVideos() {
  const noisyIds = new Set(discoveryCache?.noisyChannelIds || discoveryCache?.monopolyChannelIds || [])
  if (noisyIds.size === 0) return

  const sidebarVideos = document.querySelectorAll('ytd-compact-video-renderer, ytd-watch-next-secondary-results-renderer ytd-item-section-renderer')

  let mutedCount = 0
  sidebarVideos.forEach(video => {
    const channelLink = video.querySelector('a.ytd-channel-name, a[href^="/@"], a[href^="/channel/"]')
    if (channelLink) {
      const href = channelLink.getAttribute('href') || ''
      const channelId = href.match(/\/channel\/([^/]+)/)?.[1]

      if (channelId && noisyIds.has(channelId)) {
        video.style.display = 'none'
        video.setAttribute('data-silenced-muted', 'noisy')
        mutedCount++
      }
    }
  })

  const topSidebar = document.querySelectorAll('#secondary ytd-compact-video-renderer')
  topSidebar.forEach((video, i) => {
    if (i < 3 && !video.hasAttribute('data-silenced-muted')) {
      video.style.display = 'none'
      video.setAttribute('data-silenced-muted', 'noisy')
      mutedCount++
    }
  })

  console.log(`[Silenced] 🔇 Muted ${mutedCount} noisy videos`)
}

// Format surfacing method for display
function formatDiversityMethod(method) {
  if (!method || method === 'unknown') {
    return 'exposure-adjusted ranking'
  }

  const methodLower = method.toLowerCase()

  if (methodLower.includes('transcript_analyzed_gemini')) {
    return '🎯 AI transcript analysis + exposure ranking'
  }
  if (methodLower.includes('transcript_analyzed_heuristic') || methodLower.includes('heuristic-transcript')) {
    return '🎯 transcript verified + exposure ranking'
  }
  if (methodLower.includes('quality_filtered_gemini') || methodLower.includes('gemini')) {
    return 'AI quality filter + exposure ranking'
  }
  if (methodLower.includes('quality_filtered_heuristic') || methodLower.includes('quality_filtered')) {
    return 'quality filter + exposure ranking'
  }
  if (methodLower.includes('greedy_cosine') || methodLower.includes('cosine') || methodLower.includes('embedding')) {
    return 'exposure-adjusted ranking + ML diversification'
  }
  if (methodLower.includes('fallback') || methodLower.includes('heuristic')) {
    return 'exposure-adjusted ranking (fallback)'
  }
  return 'exposure-adjusted ranking'
}

function injectUnmutedVoices() {
  const videos = discoveryCache?.unmutedVideos || discoveryCache?.discoveredVideos || []
  const biasSnapshot = discoveryCache?.biasSnapshot

  if (videos.length === 0) {
    document.querySelectorAll('.silenced-unmuted-container').forEach(el => el.remove())

    const sidebar = document.querySelector('#secondary ytd-watch-next-secondary-results-renderer, #secondary-inner')
    if (!sidebar) return

    const emptyContainer = document.createElement('div')
    emptyContainer.className = 'silenced-unmuted-container'
    emptyContainer.style.cssText = `
      margin: 12px 0;
      padding: 14px;
      background: #111111;
      border-radius: 8px;
      border: 1px solid #262626;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-align: center;
    `
    emptyContainer.innerHTML = `
      <div style="font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Under-represented Voices</div>
      <div style="font-size: 12px; color: #9ca3af; line-height: 1.5;">
        No small creators found for this topic.<br>
        <span style="font-size: 10px; color: #6b7280;">This topic may be dominated by large channels.</span>
      </div>
    `

    const shadowHost = document.querySelector('#silenced-shadow-host')
    if (shadowHost) {
      shadowHost.after(emptyContainer)
    } else {
      sidebar.insertBefore(emptyContainer, sidebar.firstChild)
    }
    return
  }

  injectBiasReceiptStyles()
  document.querySelectorAll('.silenced-unmuted-container, .silenced-equity-container').forEach(el => el.remove())

  const sidebar = document.querySelector('#secondary ytd-watch-next-secondary-results-renderer, #secondary-inner')
  if (!sidebar) return

  const container = document.createElement('div')
  container.className = 'silenced-unmuted-container'
  container.style.cssText = `
    margin: 12px 0;
    padding: 14px;
    background: #111111;
    border-radius: 8px;
    border: 1px solid #262626;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `

  // Bias Snapshot (if available)
  if (biasSnapshot) {
    const snapshot = document.createElement('div')
    snapshot.style.cssText = `
      padding: 10px;
      background: #0a0a0a;
      border-radius: 6px;
      margin-bottom: 12px;
    `
    const concentrationClass = biasSnapshot.topicConcentration > 70 ? 'color: #f59e0b;' : 'color: #10b981;'
    const snapshotTitle = auditModeActive ? 'Platform Context' : 'Topic Bias Snapshot'
    const subtitleHtml = auditModeActive
      ? '<div style="font-size: 8px; color: #4b5563; margin-bottom: 6px;">Baseline distribution for this topic</div>'
      : ''

    snapshot.innerHTML = `
      <div style="font-size: 9px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: ${auditModeActive ? '2px' : '8px'};">${snapshotTitle}</div>
      ${subtitleHtml}
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div style="padding: 6px 8px; background: #171717; border-radius: 4px;">
          <div style="font-size: 14px; font-weight: 700; ${concentrationClass}">${biasSnapshot.topicConcentration}%</div>
          <div style="font-size: 8px; color: #6b7280;">Top 10 concentration</div>
        </div>
        <div style="padding: 6px 8px; background: #171717; border-radius: 4px;">
          <div style="font-size: 14px; font-weight: 700; color: #10b981;">${biasSnapshot.underAmplifiedRate}%</div>
          <div style="font-size: 8px; color: #6b7280;">Under-amplified</div>
        </div>
      </div>
    `
    container.appendChild(snapshot)
  }

  const header = document.createElement('div')
  header.style.cssText = 'font-size: 11px; font-weight: 600; color: #10b981; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;'
  header.innerHTML = '<span>Under-represented Voices</span>'
  container.appendChild(header)

  videos.slice(0, 5).forEach((video, index) => {
    const isRising = video.isRisingSignal || video.isRisingStar
    const biasReceipt = video.biasReceipt

    const card = document.createElement('div')
    card.style.cssText = `
      background: #1a1a1a;
      border-radius: 6px;
      margin-bottom: 8px;
      overflow: hidden;
      border-left: 3px solid ${isRising ? '#f59e0b' : '#10b981'};
    `

    // Build Bias Receipt HTML if available
    let biasReceiptHtml = ''
    if (biasReceipt) {
      const whyNotShown = biasReceipt.whyNotShown || []
      const whySurfaced = biasReceipt.whySurfaced || []
      const confidence = biasReceipt.confidence || 'medium'
      const method = biasReceipt.method || 'heuristic'
      const receiptId = `receipt-${video.videoId}-${index}`

      // Confidence dots
      const confidenceDots = ['low', 'medium', 'high'].map((level, i) => {
        const filled = (confidence === 'low' && i === 0) ||
                       (confidence === 'medium' && i <= 1) ||
                       (confidence === 'high')
        return `<span class="silenced-confidence-dot ${filled ? `filled ${confidence}` : ''}"></span>`
      }).join('')

      biasReceiptHtml = `
        <div class="silenced-bias-receipt" data-receipt-id="${receiptId}">
          <div class="silenced-bias-receipt-toggle">
            <span class="silenced-receipt-title">
              Bias Receipt
              ${method === 'heuristic' ? '<span class="silenced-receipt-method fallback">Fallback</span>' : ''}
            </span>
            <span class="silenced-receipt-arrow">▼</span>
          </div>
          <div class="silenced-receipt-content">
            ${whyNotShown.length > 0 ? `
              <div class="silenced-receipt-section">
                <div class="silenced-receipt-section-title">Why you didn't see this</div>
                <ul class="silenced-receipt-bullets">
                  ${whyNotShown.map(b => `<li>${esc(b)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            ${whySurfaced.length > 0 ? `
              <div class="silenced-receipt-section">
                <div class="silenced-receipt-section-title surfaced">Why we surfaced it</div>
                <ul class="silenced-receipt-bullets">
                  ${whySurfaced.map(b => `<li>${esc(b)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            <div class="silenced-receipt-confidence">
              <span class="silenced-confidence-label">Confidence:</span>
              <span class="silenced-confidence-indicator">${confidenceDots}</span>
            </div>
          </div>
        </div>
      `
    }

    // Build audit info line (shows subs, surfaced via, and content description)
    const surfaceMethod = video.surfaceMethod || 'engagement_ranking'
    const methodDisplay = formatDiversityMethod(surfaceMethod)

    // Check if this video was transcript-verified
    const isTranscriptVerified = surfaceMethod.includes('transcript')
    const transcriptBadge = isTranscriptVerified
      ? '<span style="background: #065f46; color: #10b981; padding: 1px 4px; border-radius: 3px; font-size: 8px; margin-left: 4px;">VERIFIED</span>'
      : ''

    // Use AI content summary if available, otherwise fall back to diversityNote/qualityReason
    const contentDescription = biasReceipt?.contentSummary || video.diversityNote || video.qualityReason || ''
    const isAIGenerated = biasReceipt?.contentSummary && biasReceipt?.method === 'gemini'

    // Always show the audit info with subs, surfaced via, and description
    const auditInfoHtml = `
      <div style="padding: 8px 10px; border-top: 1px solid #262626;">
        <div style="font-size: 10px; color: #6b7280; font-family: 'SF Mono', Monaco, monospace; margin-bottom: 6px;">
          Subs: ${fmt(video.subscriberCount)} · Surfaced via: ${methodDisplay}${transcriptBadge}
        </div>
        ${contentDescription ? `
          <div style="font-size: 11px; color: #d1d5db; line-height: 1.5; font-family: -apple-system, sans-serif;">
            ${isAIGenerated ? '<span style="background: #1e3a5f; color: #60a5fa; padding: 1px 4px; border-radius: 3px; font-size: 8px; margin-right: 4px;">AI</span>' : ''}
            ${esc(contentDescription)}
          </div>
        ` : ''}
      </div>
    `

    card.innerHTML = `
      <a href="/watch?v=${video.videoId}" class="video-link" style="display: block; padding: 10px; text-decoration: none;">
        <div style="display: flex; gap: 10px;">
          <img src="${video.thumbnail}" style="width: 100px; height: 56px; border-radius: 4px; object-fit: cover; flex-shrink: 0; background: #262626;" alt="">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 12px; font-weight: 500; color: #e5e5e5; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              ${esc(video.title)}
            </div>
            <div style="font-size: 10px; color: #9ca3af; margin-top: 3px;">${esc(video.channelTitle)} · ${fmt(video.subscriberCount)} subs</div>
          </div>
        </div>
      </a>
      ${auditInfoHtml}
      ${biasReceipt ? `<div style="padding: 0 10px 10px;">${biasReceiptHtml}</div>` : ''}
    `

    // Add hover effects
    card.addEventListener('mouseenter', () => {
      card.style.background = '#222222'
    })
    card.addEventListener('mouseleave', () => {
      card.style.background = '#1a1a1a'
    })

    // Add toggle functionality for bias receipt
    if (biasReceipt) {
      const receiptEl = card.querySelector('.silenced-bias-receipt')
      const toggleEl = card.querySelector('.silenced-bias-receipt-toggle')
      if (toggleEl && receiptEl) {
        toggleEl.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          receiptEl.classList.toggle('open')
        })
      }
    }

    container.appendChild(card)
  })

  // Footer with muted count
  const mutedChannels = discoveryCache?.channelsToMute || []
  const footer = document.createElement('div')
  footer.style.cssText = 'font-size: 10px; color: #6b7280; margin-top: 10px; padding-top: 8px; border-top: 1px solid #262626; display: flex; justify-content: space-between; align-items: center;'
  footer.innerHTML = `
    <span>${mutedChannels.length > 0 ? `${mutedChannels.length} dominant channels de-prioritized` : 'Surfacing under-represented voices'}</span>
    <span style="font-size: 8px; color: #4b5563;">Hack the Bias '26</span>
  `
  container.appendChild(footer)

  const shadowHostEl = document.querySelector('#silenced-shadow-host')
  if (shadowHostEl && shadowHostEl.nextSibling) {
    sidebar.insertBefore(container, shadowHostEl.nextSibling)
  } else if (shadowHostEl) {
    shadowHostEl.after(container)
  } else {
    sidebar.insertBefore(container, sidebar.firstChild)
  }

  console.log('[Silenced] Injected', videos.length, 'unmuted voices with explainability')
}

function setupNoiseCancellationObserver() {
  if (discoveryObserver) {
    discoveryObserver.disconnect()
  }

  discoveryObserver = new MutationObserver((mutations) => {
    if (!noiseCancellationActive) return

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches?.('ytd-compact-video-renderer')) {
            setTimeout(() => muteNoisyVideos(), 100)
          }
        }
      }
    }
  })

  discoveryObserver.observe(document.body, { childList: true, subtree: true })
}

// ============================================
// WATCH PAGE - Floating Toggle
// ============================================

function createFloatingToggle() {
  const existing = document.getElementById('silenced-noise-toggle')
  if (existing) {
    existing.classList.toggle('active', noiseCancellationActive)
    const statusEl = existing.querySelector('.toggle-status')
    if (statusEl) statusEl.textContent = noiseCancellationActive ? 'ACTIVE' : 'OFF'
    return
  }

  document.getElementById('silenced-discovery-toggle')?.remove()

  const toggle = document.createElement('div')
  toggle.id = 'silenced-noise-toggle'
  toggle.className = noiseCancellationActive ? 'active' : ''
  toggle.setAttribute('role', 'switch')
  toggle.setAttribute('aria-checked', noiseCancellationActive)
  toggle.setAttribute('aria-label', 'Toggle Noise Cancellation to unmute silenced voices')
  toggle.setAttribute('tabindex', '0')

  toggle.innerHTML = `
    <div class="toggle-inner">
      <div class="toggle-icon">◉</div>
      <div class="toggle-label">
        <span class="toggle-title">Surface Silenced</span>
        <span class="toggle-status">${noiseCancellationActive ? 'ACTIVE' : 'OFF'}</span>
      </div>
    </div>
  `

  toggle.addEventListener('click', () => window.silencedToggleNoiseCancellation())
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      window.silencedToggleNoiseCancellation()
    }
  })

  document.body.appendChild(toggle)
}

// ============================================
// WATCH PAGE - Main Analysis
// ============================================

async function runWatchPage() {
  const videoId = getVideoId()
  if (!videoId || (videoId === currentVideoId && panelInjected)) return

  currentVideoId = videoId
  panelInjected = false
  breakdownOpen = false
  silenceReportOpen = false

  for (let i = 0; i < 15; i++) {
    if (document.querySelector('#secondary')) break
    await new Promise(r => setTimeout(r, 1000))
  }

  const sidebar = document.querySelector('#secondary-inner') || document.querySelector('#secondary')
  if (!sidebar) return

  document.querySelector('#silenced-shadow-host')?.remove()
  const { host, shadow, container } = createShadowContainer('silenced-shadow-host', sidebar)
  shadowHost = host

  container.innerHTML = `
    <div class="silenced-panel">
      <div class="panel-header">
        <div class="header-brand">
          <span class="brand-name">silenced</span>
        </div>
      </div>
      <div class="loading-state">
        <div class="spinner"></div>
        <div class="loading-text">Analyzing video...</div>
      </div>
    </div>
  `

  const transcript = await getTranscript(videoId)

  const response = await safeSendMessage({
    action: 'analyze',
    videoId,
    transcript: transcript?.substring(0, 8000)
  })

  if (response?.success && response?.data) {
    injectDashboard(response.data)

    if (noiseCancellationActive) {
      const query = extractCurrentQuery()
      await runNoiseCancellation(query)
      muteNoisyVideos()
      injectUnmutedVoices()
    }
  } else {
    container.innerHTML = `
      <div class="silenced-panel">
        <div class="panel-header">
          <div class="header-brand">
            <span class="brand-name">silenced</span>
          </div>
        </div>
        <div style="padding: 24px; text-align: center; color: #888;">
          <div style="margin-bottom: 12px;">Could not analyze this video</div>
          <button onclick="window.silencedRetry()" style="background: #10b981; color: #000; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer;">
            Try Again
          </button>
        </div>
      </div>
    `
  }
}

async function getTranscript(videoId) {
  try {
    for (const lang of ['en', 'en-US', '']) {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (data.events?.length) {
          const text = data.events
            .filter(e => e.segs)
            .flatMap(e => e.segs.map(s => s.utf8 || ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
          if (text.length > 100) return text
        }
      }
    }
  } catch { }
  return null
}

window.silencedRetry = () => {
  currentVideoId = null
  panelInjected = false
  runWatchPage()
}

// ============================================
// NAVIGATION & MESSAGE HANDLERS
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleDiscoveryMode' || request.action === 'toggleNoiseCancellation') {
    window.silencedToggleNoiseCancellation()
    sendResponse({ success: true, noiseCancellationActive })
  }
  return false
})

let lastUrl = location.href
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    currentVideoId = null
    panelInjected = false
    processedVideoCards.clear()

    document.querySelector('#silenced-shadow-host')?.remove()
    document.querySelectorAll('.silenced-unmuted-container, .silenced-equity-container').forEach(el => el.remove())

    // Route to appropriate handler
    if (isWatchPage()) {
      setTimeout(runWatchPage, 1500)
    } else if (isHomepage()) {
      setTimeout(initHomepageBiasLens, 500)
    }

    createFloatingToggle()

    if (noiseCancellationActive) {
      setTimeout(async () => {
        const query = extractCurrentQuery()
        await runNoiseCancellation(query)
        if (isWatchPage()) {
          muteNoisyVideos()
          injectUnmutedVoices()
        }
      }, 2000)
    }
  }
}).observe(document.body, { childList: true, subtree: true })

window.addEventListener('yt-navigate-finish', () => {
  currentVideoId = null
  panelInjected = false
  processedVideoCards.clear()
  processedThumbnails.clear()

  if (isWatchPage()) {
    setTimeout(runWatchPage, 1500)
  } else if (isHomepage()) {
    setTimeout(initHomepageBiasLens, 500)
  }
  
  createFloatingToggle()

  if (noiseCancellationActive && !isWatchPage()) {
    injectThumbnailStyles()
    setTimeout(() => labelVideoThumbnails(), 2000)
    setTimeout(() => labelVideoThumbnails(), 4000)
  }

  if (noiseCancellationActive) {
    setTimeout(async () => {
      const query = extractCurrentQuery()
      await runNoiseCancellation(query)
      if (isWatchPage()) {
        muteNoisyVideos()
        injectUnmutedVoices()
      }
    }, 2000)
  }
})

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  console.log('[Silenced] Initializing content script...')
  
  // Load noise cancellation state
  await loadNoiseCancellationState()

  // Load session stats
  const stored = await chrome.storage.local.get(['discoveredCount', 'hiddenCount'])
  stats.voicesUnmuted = stored.discoveredCount || 0
  stats.noiseMuted = stored.hiddenCount || 0

  // Create floating toggle
  setTimeout(createFloatingToggle, 2000)

  // Route to appropriate handler based on current page
  if (isWatchPage()) {
    setTimeout(runWatchPage, 2000)
  } else if (isHomepage()) {
    setTimeout(initHomepageBiasLens, 500)
  }

  // Label thumbnails on homepage/search if noise cancellation is active
  if (noiseCancellationActive && !isWatchPage()) {
    injectThumbnailStyles()
    setTimeout(() => labelVideoThumbnails(), 2500)
  }

  // Auto-enable noise cancellation if it was on
  if (noiseCancellationActive) {
    setTimeout(async () => {
      const query = extractCurrentQuery()
      await runNoiseCancellation(query)
      if (isWatchPage()) {
        muteNoisyVideos()
        injectUnmutedVoices()
      }
    }, 3000)
  }
  
  console.log('[Silenced] Content script initialized')
}

init()

console.log('[Silenced] 🔇→🔈 Merged Content Script v4.0 loaded - Homepage Bias Lens + Watch Page Sidebar')
