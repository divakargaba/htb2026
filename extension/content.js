// Silenced by the Algorithm
// See the bias. Hear the silenced.

const SUPABASE_URL = 'https://ntspwmgvabdpifzzebrv.supabase.co/functions/v1/recommend'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50c3B3bWd2YWJkcGlmenplYnJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MzIyNjIsImV4cCI6MjA4NDIwODI2Mn0.26ndaCrexA3g29FHrJB1uBKJIUW6E5yn-nbvarsBp4o'

// ===============================================
// STATE
// ===============================================
let currentVideoId = null
let panelInjected = false
let isOpen = true
let breakdownOpen = false
let silenceReportOpen = false
let noiseCancellationActive = false
let auditModeActive = false // Bias Audit Mode state
let discoveryCache = null
let discoveryObserver = null
let processedVideoCards = new Set()
let processedThumbnails = new Set()
let shadowHost = null
let stats = { voicesUnmuted: 0, noiseMuted: 0 }
let channelSubCache = new Map() // Cache channel subscriber counts

// ===============================================
// HELPERS
// ===============================================
const getVideoId = () => new URL(window.location.href).searchParams.get('v')
const isWatchPage = () => window.location.pathname === '/watch'
const isHomePage = () => window.location.pathname === '/' || window.location.pathname === ''
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
 * @param {Object} message - The message to send
 * @param {Function} callback - Optional callback function
 * @returns {Promise} Promise that resolves with the response or null if context is invalid
 */
function safeSendMessage(message, callback) {
  return new Promise((resolve) => {
    try {
      // Check if runtime is still available
      if (!chrome.runtime || !chrome.runtime.id) {
        console.warn('[Silenced] Extension context invalidated - runtime not available')
        if (callback) callback(null)
        resolve(null)
        return
      }

      chrome.runtime.sendMessage(message, (response) => {
        // Check for runtime errors
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

// ===============================================
// VIDEO THUMBNAIL LABELING - Show noise/silence on ALL videos
// ===============================================
function injectBiasReceiptStyles() {
  if (document.getElementById('silenced-bias-receipt-styles')) return

  const style = document.createElement('style')
  style.id = 'silenced-bias-receipt-styles'
  style.textContent = `
    /* Bias Receipt Styles - injected for unmuted voices container */
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

    .silenced-receipt-confidence {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #262626;
    }

    .silenced-confidence-label {
      font-size: 8px;
      color: #4b5563;
      text-transform: uppercase;
    }

    .silenced-confidence-indicator {
      display: flex;
      gap: 2px;
    }

    .silenced-confidence-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #262626;
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
    
    /* Dim noisy videos when noise cancellation is active */
    .silenced-dimmed {
      opacity: 0.3;
      filter: grayscale(0.5);
      transition: opacity 0.3s ease, filter 0.3s ease;
    }
    
    .silenced-dimmed:hover {
      opacity: 0.7;
      filter: grayscale(0.2);
    }
    
    /* Highlight silenced videos */
    .silenced-highlighted {
      outline: 3px solid #00E676;
      outline-offset: -3px;
    }
    
    /* Channel info overlay on hover */
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
  // Check cache first
  if (channelSubCache.has(channelHandle)) {
    return channelSubCache.get(channelHandle)
  }

  // Request from background script
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

  // Find all video renderers
  const videoCards = document.querySelectorAll(`
    ytd-rich-item-renderer,
    ytd-video-renderer,
    ytd-compact-video-renderer,
    ytd-grid-video-renderer
  `)

  for (const card of videoCards) {
    // Skip if already processed
    const videoId = card.querySelector('a#thumbnail')?.href?.match(/[?&]v=([^&]+)/)?.[1]
    if (!videoId || processedThumbnails.has(videoId)) continue
    processedThumbnails.add(videoId)

    // Get channel info
    const channelLink = card.querySelector('a.yt-formatted-string[href^="/@"], ytd-channel-name a, a[href^="/@"]')
    const channelHandle = channelLink?.getAttribute('href')?.replace('/@', '') || ''

    // Get subscriber count
    let subs = 0
    if (channelHandle) {
      subs = await getChannelSubs(channelHandle)
    }

    // Determine exposure tier
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
      badgeText = '' // Don't label moderate
    } else if (subs > 0) {
      noiseLevel = 'silenced'
      badgeText = 'SILENCED'
    }

    // Add badge to thumbnail
    const thumbnail = card.querySelector('#thumbnail, ytd-thumbnail')
    if (thumbnail && badgeText) {
      // Make thumbnail position relative for badge positioning
      thumbnail.style.position = 'relative'

      // Remove existing badge if any
      thumbnail.querySelector('.silenced-badge')?.remove()

      // Create and add badge
      const badge = document.createElement('div')
      badge.className = `silenced-badge ${noiseLevel}`
      badge.textContent = badgeText
      thumbnail.appendChild(badge)

      // Apply dimming for noisy videos
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

// ===============================================
// PERSISTENCE - Load Noise Cancellation state
// ===============================================
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

// ===============================================
// SHADOW DOM INJECTION - Protects from YouTube CSS changes
// ===============================================
function createShadowContainer(id, hostElement) {
  const host = document.createElement('div')
  host.id = id
  host.setAttribute('data-silenced', 'true')

  const shadow = host.attachShadow({ mode: 'open' })

  // Inject isolated styles
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
    /* ====================================
       SILENCED - Clean, Professional UI
       No gradients, minimal glow, clear hierarchy
       ==================================== */

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

    /* === MAIN PANEL === */
    .silenced-panel {
      background: #111111;
      border: 1px solid #262626;
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    
    /* === HEADER === */
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

    /* === SCORE SECTION === */
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

    /* === EXPLANATION === */
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

    /* === BIAS SNAPSHOT === */
    .bias-snapshot {
      padding: 12px 14px;
      border-bottom: 1px solid #262626;
      background: #0a0a0a;
    }

    .snapshot-title {
      font-size: 10px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }

    .snapshot-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .snapshot-item {
      padding: 8px;
      background: #171717;
      border-radius: 4px;
    }

    .snapshot-value {
      font-size: 16px;
      font-weight: 700;
      color: #f5f5f5;
    }

    .snapshot-value.warning { color: #f59e0b; }
    .snapshot-value.good { color: #10b981; }

    .snapshot-label {
      font-size: 9px;
      color: #6b7280;
      margin-top: 2px;
    }

    /* === SUSTAINABILITY AUDIT === */
    .sustainability-section {
      border-bottom: 1px solid #262626;
    }
    
    .sustainability-section.sustainability-inactive {
      padding: 10px 14px;
      background: #0a0a0a;
    }
    
    .sustainability-header-static {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .sustainability-title-muted {
      font-size: 11px;
      color: #4b5563;
    }
    
    .sustainability-na-badge {
      font-size: 9px;
      font-weight: 600;
      color: #6b7280;
      background: #1f1f1f;
      padding: 2px 6px;
      border-radius: 3px;
    }
    
    .sustainability-na-text {
      font-size: 10px;
      color: #4b5563;
      margin-top: 4px;
    }

    .sustainability-header-toggle {
      width: 100%;
      padding: 12px 14px;
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: left;
      transition: background 0.2s ease;
    }

    .sustainability-header-toggle:hover {
      background: #1a1a1a;
    }

    .sustainability-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0;
    }

    .sustainability-title {
      font-size: 12px;
      font-weight: 600;
      color: #059669;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .sustainability-arrow {
      font-size: 10px;
      color: #6b7280;
      transition: transform 0.3s ease;
    }

    .sustainability-header-toggle[aria-expanded="true"] .sustainability-arrow {
      transform: rotate(180deg);
    }

    .transparency-score {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
    }

    .transparency-score.verified { background: #10b98130; color: #10b981; }
    .transparency-score.partial { background: #f59e0b30; color: #f59e0b; }
    .transparency-score.caution { background: #ef444430; color: #ef4444; }
    .transparency-score.unverified { background: #6b728030; color: #9ca3af; }

    .sustainability-content {
      padding: 0 14px 14px;
      border-top: 1px solid #262626;
      margin-top: 8px;
      padding-top: 14px;
    }
    
    .audit-category-badge {
      font-size: 10px;
      color: #9ca3af;
      background: #1a1a1a;
      padding: 6px 10px;
      border-radius: 4px;
      margin-bottom: 12px;
      border-left: 3px solid #059669;
    }

    .audit-flags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 16px;
    }

    .audit-flag {
      font-size: 10px;
      padding: 3px 8px;
      border-radius: 3px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .audit-flag.warning { background: #ef444420; color: #fca5a5; }
    .audit-flag.caution { background: #f59e0b20; color: #fcd34d; }
    .audit-flag.info { background: #3b82f620; color: #93c5fd; }
    .audit-flag.positive { background: #10b98120; color: #6ee7b7; }

    /* Detailed Sustainability Cards */
    .sustainability-detailed {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }

    .sustainability-card {
      background: #1a1a1a;
      border-radius: 8px;
      padding: 12px;
      border: 1px solid #374151;
    }
    
    .sustainability-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }

    .sustainability-card-header h4 {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      color: #F9FAFB;
      flex: 1;
    }

    .card-icon {
      font-size: 16px;
    }

    .risk-badge, .credibility-badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .sustainability-card-content {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .risk-score-circle {
      text-align: center;
      padding: 12px;
    }

    .risk-score-value {
      font-size: 32px;
      font-weight: 700;
      line-height: 1;
    }

    .risk-score-label {
      font-size: 12px;
      color: #9CA3AF;
      margin-top: 4px;
    }

    .sustainability-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .sustainability-issue {
      font-size: 11px;
      color: #FCA5A5;
      padding: 6px 8px;
      background: #7F1D1D20;
      border-radius: 4px;
      border-left: 2px solid #EF4444;
    }

    .sustainability-list.positives .sustainability-positive {
      font-size: 11px;
      color: #6EE7B7;
      padding: 6px 8px;
      background: #064E3B20;
      border-radius: 4px;
      border-left: 2px solid #10B981;
    }

    .verification-bar {
      height: 6px;
      background: #374151;
      border-radius: 3px;
      overflow: hidden;
    }
    
    .verification-fill {
      height: 100%;
      background: linear-gradient(90deg, #10B981, #059669);
      border-radius: 3px;
      transition: width 0.6s ease;
    }

    .verification-percentage {
      font-size: 12px;
      font-weight: 600;
      color: #10B981;
      text-align: center;
    }
    
    .verification-stats {
      font-size: 11px;
      font-weight: 600;
      color: #F9FAFB;
    }
    
    .claims-preview {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }

    .claim-item {
      display: flex;
      gap: 8px;
      padding: 8px;
      background: #111827;
      border-radius: 6px;
      border-left: 3px solid;
    }

    .claim-item.verified {
      border-left-color: #10B981;
    }

    .claim-item.unverified {
      border-left-color: #EF4444;
    }

    .claim-icon {
      font-size: 14px;
      flex-shrink: 0;
    }

    .claim-text {
      font-size: 10px;
      color: #E5E7EB;
      font-style: italic;
      line-height: 1.4;
      flex: 1;
    }

    .claim-evidence {
      font-size: 9px;
      color: #10B981;
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid #10B981;
    }

    /* === AI GREENWASHING ANALYSIS === */
    .ai-greenwashing-analysis {
      margin-top: 12px;
      padding: 12px;
      background: #0d1117;
      border-radius: 6px;
      border: 1px solid #30363d;
    }
    
    .ai-analysis-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    
    .ai-badge {
      font-size: 10px;
      font-weight: 600;
      color: #58a6ff;
      background: #58a6ff20;
      padding: 3px 8px;
      border-radius: 4px;
    }
    
    .ai-transparency {
      font-size: 10px;
      color: #8b949e;
    }
    
    .ai-flags-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .ai-flags-list.warnings {
      margin-bottom: 8px;
    }
    
    .ai-flag {
      display: flex;
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      align-items: flex-start;
    }
    
    .ai-flag.warning {
      background: #f8514920;
      border-left: 3px solid #f85149;
    }
    
    .ai-flag.positive {
      background: #3fb95020;
      border-left: 3px solid #3fb950;
    }
    
    .flag-type {
      font-size: 14px;
      flex-shrink: 0;
    }
    
    .flag-content {
      flex: 1;
      min-width: 0;
    }
    
    .flag-text {
      font-size: 11px;
      color: #c9d1d9;
      line-height: 1.4;
    }
    
    .flag-evidence {
      font-size: 9px;
      color: #8b949e;
      margin-top: 6px;
      padding: 6px 8px;
      background: #161b22;
      border-radius: 4px;
      border-left: 2px solid #30363d;
      font-style: italic;
    }
    
    .ai-method-note {
      font-size: 9px;
      color: #6e7681;
      margin-top: 8px;
      text-align: right;
    }

    .claim-issue {
      font-size: 9px;
      color: #EF4444;
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid #EF4444;
    }

    .no-claims {
      font-size: 11px;
      color: #9CA3AF;
      text-align: center;
      padding: 12px;
      margin: 0;
    }

    .source-type {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: #111827;
      border-radius: 6px;
      margin-bottom: 8px;
    }

    .source-icon {
      font-size: 20px;
    }

    .source-label {
      font-size: 11px;
      font-weight: 600;
      color: #F9FAFB;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .recommendation {
      font-size: 11px;
      color: #D1D5DB;
      line-height: 1.5;
      margin: 8px 0;
      padding: 8px;
      background: #111827;
      border-radius: 6px;
    }

    .conflicts-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .conflict-item {
      font-size: 10px;
      color: #FCA5A5;
      padding: 6px 8px;
      background: #7F1D1D20;
      border-radius: 4px;
      border-left: 2px solid #EF4444;
    }
    .audit-flag.info { background: #3b82f620; color: #93c5fd; }
    .audit-flag.positive { background: #10b98120; color: #6ee7b7; }

    .flag-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
    }

    .flag-dot.warning { background: #ef4444; }
    .flag-dot.caution { background: #f59e0b; }
    .flag-dot.info { background: #3b82f6; }
    .flag-dot.positive { background: #10b981; }

    /* === ACTION TOGGLE === */
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

    /* === FOOTER === */
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
    
    /* === LOADING === */
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

    /* === BIAS RECEIPT === */
    .bias-receipt {
      margin-top: 8px;
      border-top: 1px solid #262626;
      padding-top: 8px;
    }

    .bias-receipt-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 4px 0;
      user-select: none;
    }

    .bias-receipt-toggle:hover .receipt-title {
      color: #d1d5db;
    }

    .receipt-title {
      font-size: 10px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .receipt-method {
      font-size: 8px;
      font-weight: 500;
      color: #4b5563;
      background: #1f1f1f;
      padding: 2px 5px;
      border-radius: 3px;
      text-transform: uppercase;
    }

    .receipt-method.fallback {
      color: #9ca3af;
    }

    .receipt-arrow {
      font-size: 10px;
      color: #6b7280;
      transition: transform 0.2s ease;
    }

    .bias-receipt.open .receipt-arrow {
      transform: rotate(180deg);
    }

    .receipt-content {
      display: none;
      padding: 8px 0 4px;
    }
    
    .bias-receipt.open .receipt-content {
      display: block;
    }
    
    .receipt-section {
      margin-bottom: 8px;
    }

    .receipt-section:last-child {
      margin-bottom: 0;
    }

    .receipt-section-title {
      font-size: 9px;
      font-weight: 600;
      color: #ef4444;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .receipt-section-title.surfaced {
      color: #10b981;
    }

    .receipt-bullets {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .receipt-bullets li {
      font-size: 10px;
      color: #9ca3af;
      line-height: 1.4;
      padding: 2px 0;
      padding-left: 10px;
      position: relative;
    }

    .receipt-bullets li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #4b5563;
    }

    .receipt-confidence {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #262626;
    }

    .confidence-label {
      font-size: 8px;
      color: #4b5563;
      text-transform: uppercase;
    }

    .confidence-indicator {
      display: flex;
      gap: 2px;
    }

    .confidence-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #262626;
    }

    .confidence-dot.filled {
      background: #6b7280;
    }

    .confidence-dot.filled.high {
      background: #10b981;
    }

    .confidence-dot.filled.medium {
      background: #f59e0b;
    }

    .confidence-dot.filled.low {
      background: #6b7280;
    }

    /* === AUDIT MODE === */
    .audit-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      border-top: 1px solid #262626;
      cursor: pointer;
    }

    .audit-toggle:hover {
      background: #1a1a1a;
    }

    .audit-toggle-label {
      font-size: 10px;
      font-weight: 500;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .audit-toggle.active .audit-toggle-label {
      color: #3b82f6;
    }

    .audit-switch {
      width: 32px;
      height: 16px;
      background: #404040;
      border-radius: 8px;
      position: relative;
      transition: background 0.2s ease;
    }

    .audit-switch.on {
      background: #3b82f6;
    }

    .audit-switch-knob {
      width: 12px;
      height: 12px;
      background: white;
      border-radius: 50%;
      position: absolute;
      top: 2px;
      left: 2px;
      transition: transform 0.2s ease;
    }

    .audit-switch.on .audit-switch-knob {
      transform: translateX(16px);
    }

    .impact-snapshot {
      padding: 12px 14px;
      background: #0d1117;
      border-bottom: 1px solid #262626;
    }

    .impact-snapshot-title {
      font-size: 9px;
      font-weight: 600;
      color: #3b82f6;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }

    .impact-metrics {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .impact-metric {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
    }

    .impact-metric-label {
      color: #9ca3af;
    }

    .impact-metric-value {
      font-weight: 600;
      color: #e5e5e5;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
    }

    .impact-metric-value.highlight {
      color: #10b981;
    }

    .impact-metric-value.muted {
      color: #6b7280;
    }

    .impact-divider {
      height: 1px;
      background: #262626;
      margin: 6px 0;
    }

    .impact-unavailable {
      font-size: 11px;
      color: #6b7280;
      text-align: center;
      padding: 8px 0;
    }
  `
}

// (Old orphaned CSS removed successfully)

// ===============================================
// DASHBOARD - Clean, professional design
// ===============================================
function createDashboard(data) {
  const { noiseAnalysis, video, channel, sustainability } = data
  const score = noiseAnalysis?.totalScore || 0
  const tier = noiseAnalysis?.exposureTier || noiseAnalysis?.noiseLevel || { label: 'Unknown', color: '#6b7280' }
  const subs = channel?.subscriberCount || 0
  const explainReasons = noiseAnalysis?.explainReasons || []

  const isAdvantaged = score > 50
  const tierClass = score > 80 ? 'dominant' : score > 60 ? 'amplified' : score > 40 ? 'established' : score > 20 ? 'emerging' : 'under-represented'
  const scoreClass = score > 60 ? 'high' : score > 40 ? 'medium' : 'low'

  // Build sustainability section HTML if applicable
  let sustainabilityHtml = ''
  if (sustainability?.isSustainability && sustainability?.auditResult) {
    const audit = sustainability.auditResult
    const detailed = sustainability?.detailedAnalysis
    const flagsHtml = (audit.flags || []).map(flag =>
      `<div class="audit-flag ${flag.type}"><span class="flag-dot ${flag.type}"></span>${esc(flag.text)}</div>`
    ).join('')

    console.log('[Silenced] Rendering sustainability audit UI for KPMG challenge')

    // Build detailed analysis HTML if available
    let detailedHtml = ''
    if (detailed) {
      const { greenwashingRisk, claimVerification, sourceCredibility } = detailed

      // Greenwashing Risk Card
      const riskColor = greenwashingRisk.level === 'HIGH' ? '#EF4444' :
        greenwashingRisk.level === 'MODERATE' ? '#F59E0B' : '#10B981'
      const riskIssuesHtml = greenwashingRisk.issues.map(issue =>
        `<li class="sustainability-issue">${esc(issue)}</li>`
      ).join('')
      const riskPositivesHtml = greenwashingRisk.positives.map(pos =>
        `<li class="sustainability-positive">${esc(pos)}</li>`
      ).join('')

      // Claim Verification
      const verificationRate = claimVerification.totalClaims > 0
        ? Math.round((claimVerification.verifiedClaims / claimVerification.totalClaims) * 100)
        : 0
      const claimsHtml = claimVerification.claims.slice(0, 3).map(claim => `
        <div class="claim-item ${claim.verified ? 'verified' : 'unverified'}">
          <span class="claim-icon">${claim.verified ? '✅' : '❌'}</span>
          <div class="claim-text">"${esc(claim.text)}"</div>
          ${claim.evidence ? `<div class="claim-evidence">${esc(claim.evidence)}</div>` : ''}
          ${claim.issue ? `<div class="claim-issue">${esc(claim.issue)}</div>` : ''}
        </div>
      `).join('')

      // Source Credibility
      const sourceIcon = sourceCredibility.type === 'CORPORATE' ? '🏢' :
        sourceCredibility.type === 'INDEPENDENT' ? '🔬' :
          sourceCredibility.type === 'COMMUNITY' ? '🌍' : '❓'
      const credibilityColor = sourceCredibility.credibilityLevel === 'HIGH' ? '#10B981' :
        sourceCredibility.credibilityLevel === 'MODERATE' ? '#F59E0B' : '#EF4444'
      const conflictsHtml = sourceCredibility.conflicts.map(conflict =>
        `<li class="conflict-item">${esc(conflict)}</li>`
      ).join('')

      // AI-powered greenwashing flags (from backend)
      let aiAnalysisHtml = ''
      if (greenwashingRisk.aiFlags && greenwashingRisk.aiFlags.length > 0) {
        const aiRiskColor = greenwashingRisk.aiRiskLevel === 'high' ? '#EF4444' :
          greenwashingRisk.aiRiskLevel === 'medium' ? '#F59E0B' : '#10B981'

        const aiWarnings = greenwashingRisk.aiFlags.filter(f => f.type === 'warning').map(f => `
          <li class="ai-flag warning">
            <span class="flag-type">⚠️</span>
            <div class="flag-content">
              <div class="flag-text">${esc(f.text)}</div>
              ${f.evidence ? `<div class="flag-evidence">"${esc(f.evidence.substring(0, 150))}..."</div>` : ''}
            </div>
          </li>
        `).join('')

        const aiPositives = greenwashingRisk.aiFlags.filter(f => f.type === 'positive').map(f => `
          <li class="ai-flag positive">
            <span class="flag-type">✓</span>
            <div class="flag-content">
              <div class="flag-text">${esc(f.text)}</div>
              ${f.evidence ? `<div class="flag-evidence">"${esc(f.evidence.substring(0, 150))}..."</div>` : ''}
            </div>
          </li>
        `).join('')

        aiAnalysisHtml = `
          <div class="ai-greenwashing-analysis">
            <div class="ai-analysis-header">
              <span class="ai-badge">🤖 AI Analysis</span>
              <span class="ai-transparency">Transparency: ${greenwashingRisk.aiTransparencyScore}/100</span>
            </div>
            ${aiWarnings ? `<ul class="ai-flags-list warnings">${aiWarnings}</ul>` : ''}
            ${aiPositives ? `<ul class="ai-flags-list positives">${aiPositives}</ul>` : ''}
            <div class="ai-method-note">Analysis: ${greenwashingRisk.analysisMethod || 'gemini'}</div>
          </div>
        `
      }

      detailedHtml = `
        <div class="sustainability-detailed" id="sustainability-detailed">
          <div class="sustainability-card">
            <div class="sustainability-card-header">
              <span class="card-icon">⚠️</span>
              <h4>Greenwashing Risk</h4>
              <span class="risk-badge risk-${greenwashingRisk.level.toLowerCase()}" style="background: ${riskColor}20; color: ${riskColor}">
                ${greenwashingRisk.level}
              </span>
            </div>
            <div class="sustainability-card-content">
              <div class="risk-score-circle">
                <div class="risk-score-value" style="color: ${riskColor}">${greenwashingRisk.score}</div>
                <div class="risk-score-label">/100</div>
              </div>
              ${riskIssuesHtml ? `<ul class="sustainability-list">${riskIssuesHtml}</ul>` : ''}
              ${riskPositivesHtml ? `<ul class="sustainability-list positives">${riskPositivesHtml}</ul>` : ''}
              ${aiAnalysisHtml}
            </div>
          </div>

          <div class="sustainability-card">
            <div class="sustainability-card-header">
              <span class="card-icon">🔍</span>
              <h4>Claim Verification</h4>
              <span class="verification-stats">${claimVerification.verifiedClaims}/${claimVerification.totalClaims}</span>
            </div>
            <div class="sustainability-card-content">
              <div class="verification-bar">
                <div class="verification-fill" style="width: ${verificationRate}%"></div>
              </div>
              <div class="verification-percentage">${verificationRate}% verified</div>
              ${claimVerification.totalClaims > 0 ? `
                <div class="claims-preview">
                  ${claimsHtml}
                </div>
              ` : '<p class="no-claims">No specific sustainability claims detected.</p>'}
            </div>
          </div>

          <div class="sustainability-card">
            <div class="sustainability-card-header">
              <span class="card-icon">📊</span>
              <h4>Source Credibility</h4>
              <span class="credibility-badge" style="background: ${credibilityColor}20; color: ${credibilityColor}">
                ${sourceCredibility.credibilityLevel}
              </span>
            </div>
            <div class="sustainability-card-content">
              <div class="source-type">
                <span class="source-icon">${sourceIcon}</span>
                <span class="source-label">${sourceCredibility.type}</span>
              </div>
              <p class="recommendation">${esc(sourceCredibility.recommendation)}</p>
              ${conflictsHtml ? `<ul class="conflicts-list">${conflictsHtml}</ul>` : ''}
            </div>
        </div>
      </div>
    `
    }

    sustainabilityHtml = `
      <div class="sustainability-section">
        <button class="sustainability-header-toggle" id="sustainability-toggle" aria-expanded="true">
          <div class="sustainability-header">
            <span class="sustainability-title">🌍 KPMG Sustainability Audit</span>
            <span class="transparency-score ${audit.tier}">${audit.transparencyScore}/100</span>
          </div>
          <span class="sustainability-arrow">▼</span>
        </button>
        <div class="sustainability-content" id="sustainability-content" style="display: block;">
          <div class="audit-category-badge">📋 Category: ${esc(audit.category || 'General')}</div>
          ${flagsHtml ? `<div class="audit-flags">${flagsHtml}</div>` : ''}
          ${detailedHtml}
        </div>
      </div>
    `
  } else {
    // Show a minimal indicator that this isn't sustainability content
    sustainabilityHtml = `
      <div class="sustainability-section sustainability-inactive">
        <div class="sustainability-header-static">
          <span class="sustainability-title-muted">🌍 Sustainability Audit</span>
          <span class="sustainability-na-badge">N/A</span>
        </div>
        <div class="sustainability-na-text">Not sustainability-related content</div>
      </div>
    `
  }

  // Build explanation list
  const explainHtml = explainReasons.length > 0
    ? `<ul class="explain-list">${explainReasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`
    : `<p>${isAdvantaged ? 'This channel has significant platform advantage.' : 'This creator has limited algorithmic visibility.'}</p>`

  return `
    <div class="silenced-panel">
      <!-- Header -->
      <div class="panel-header">
        <div class="header-brand">
          <span class="brand-name">silenced</span>
          </div>
        <div class="header-tier ${tierClass}">${tier.label}</div>
        </div>
        
      <!-- Score Section -->
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

      <!-- Explanation -->
      <div class="explain-section ${isAdvantaged ? 'advantaged' : 'underrepresented'}">
        ${explainHtml}
          </div>
          
          ${sustainabilityHtml}
          
      <!-- Toggle -->
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
          
      <!-- Audit Mode Toggle -->
      <div class="audit-toggle ${auditModeActive ? 'active' : ''}" id="audit-mode-toggle">
        <span class="audit-toggle-label">Audit Mode</span>
        <div class="audit-switch ${auditModeActive ? 'on' : ''}">
          <div class="audit-switch-knob"></div>
            </div>
          </div>
          
      <!-- Impact Snapshot (only shown when audit mode is active) -->
      <div id="impact-snapshot-container"></div>
        
      <!-- Footer -->
      <div class="panel-footer">
        <span>Hack the Bias '26</span>
        <a id="refresh-btn">Refresh</a>
            </div>
            </div>
  `
}

// ===============================================
// IMPACT SNAPSHOT - Audit Mode metrics display
// ===============================================

/**
 * Format the diversity method for display
 * @param {string} method - The raw method string
 * @returns {string} Human-readable method description
 */
function formatDiversityMethod(method) {
  if (!method || method === 'unknown') {
    return 'exposure-adjusted ranking'
  }

  const methodLower = method.toLowerCase()

  // Check for transcript-analyzed Gemini (best quality)
  if (methodLower.includes('gemini-transcript') || methodLower.includes('transcript_analyzed_gemini')) {
    return '🎯 AI transcript analysis + exposure ranking'
  }

  // Check for transcript-analyzed heuristic
  if (methodLower.includes('transcript_analyzed_heuristic') || methodLower.includes('heuristic-transcript')) {
    return '🎯 transcript verified + exposure ranking'
  }

  // Check for Gemini quality filtering (no transcript)
  if (methodLower.includes('quality_filtered_gemini') || methodLower.includes('gemini')) {
    return 'AI quality filter + exposure ranking'
  }

  // Check for heuristic quality filtering
  if (methodLower.includes('quality_filtered_heuristic') || methodLower.includes('quality_filtered')) {
    return 'quality filter + exposure ranking'
  }

  // Check for ML diversification methods
  if (methodLower.includes('greedy_cosine') || methodLower.includes('cosine') || methodLower.includes('embedding')) {
    return 'exposure-adjusted ranking + ML diversification'
  }

  // Check for fallback
  if (methodLower.includes('fallback') || methodLower.includes('heuristic')) {
    return 'exposure-adjusted ranking (fallback)'
  }

  // Default: exposure-adjusted ranking
  return 'exposure-adjusted ranking'
}

function renderImpactSnapshot(auditMetrics) {
  if (!auditMetrics) {
    return `
      <div class="impact-snapshot">
        <div class="impact-snapshot-title">Impact Snapshot</div>
        <div class="impact-unavailable">Enable "Surface Under-represented Creators" above to see metrics</div>
          </div>
    `
  }

  const {
    under100kShare = 0,
    under50kShare = 0,
    dominantShareTop10 = 0,
    redundancyFiltered = 0,
    qualityFiltered = 0,
    transcriptAnalyzed = 0,
    diversityMethod = 'unknown'
  } = auditMetrics

  // Format quality filtering display
  let qualityFilterHtml = ''
  if (qualityFiltered > 0) {
    qualityFilterHtml = `
      <div class="impact-metric">
        <span class="impact-metric-label">Low-quality videos filtered</span>
        <span class="impact-metric-value highlight">${qualityFiltered}</span>
        </div>
    `
  } else {
    qualityFilterHtml = `
      <div class="impact-metric">
        <span class="impact-metric-label">Quality filter</span>
        <span class="impact-metric-value muted">All passed</span>
      </div>
    `
  }

  // Format transcript analysis display
  let transcriptHtml = ''
  if (transcriptAnalyzed > 0) {
    transcriptHtml = `
      <div class="impact-metric">
        <span class="impact-metric-label">🎯 Transcript-verified videos</span>
        <span class="impact-metric-value highlight">${transcriptAnalyzed}</span>
        </div>
    `
  }

  // Format duplicates display
  let duplicatesHtml = ''
  if (redundancyFiltered === 0) {
    duplicatesHtml = `
      <div class="impact-metric">
        <span class="impact-metric-label">Near-duplicate removals</span>
        <span class="impact-metric-value muted">None detected</span>
      </div>
    `
  } else {
    duplicatesHtml = `
      <div class="impact-metric">
        <span class="impact-metric-label">Near-duplicate videos removed</span>
        <span class="impact-metric-value highlight">${redundancyFiltered}</span>
    </div>
  `
  }

  // Format method display (Fix 3)
  const methodDisplay = formatDiversityMethod(diversityMethod)

  return `
    <div class="impact-snapshot">
      <div class="impact-snapshot-title">Impact Snapshot</div>
      <div style="font-size: 9px; color: #4b5563; margin-bottom: 8px;">Share of surfaced results from under-represented creators</div>
      <div class="impact-metrics">
        <div class="impact-metric">
          <span class="impact-metric-label">From creators &lt;100k subs</span>
          <span class="impact-metric-value ${under100kShare > 50 ? 'highlight' : ''}">${under100kShare}%</span>
        </div>
        <div class="impact-metric">
          <span class="impact-metric-label">From very small creators &lt;50k</span>
          <span class="impact-metric-value ${under50kShare > 30 ? 'highlight' : ''}">${under50kShare}%</span>
        </div>
        ${dominantShareTop10 > 0 ? `
        <div class="impact-divider"></div>
        <div class="impact-metric">
          <span class="impact-metric-label">Topic concentration (top 10)</span>
          <span class="impact-metric-value ${dominantShareTop10 > 70 ? 'muted' : ''}">${dominantShareTop10}%</span>
        </div>
        ` : ''}
        <div class="impact-divider"></div>
        ${qualityFilterHtml}
        ${transcriptHtml}
        ${duplicatesHtml}
        <div class="impact-metric">
          <span class="impact-metric-label">Method</span>
          <span class="impact-metric-value muted">${methodDisplay}</span>
        </div>
      </div>
    </div>
  `
}

// Generate audio waveform visualization (kept for potential future use)
function generateWaveform(score, isNoisy) {
  const barCount = 20
  const bars = []

  for (let i = 0; i < barCount; i++) {
    // Create a wave pattern that responds to the score
    const position = i / barCount
    const baseHeight = Math.sin(position * Math.PI) * 0.7 + 0.3
    const noiseVariance = (Math.random() * 0.3 + 0.7)
    const scoreMultiplier = 0.3 + (score / 100) * 0.7
    const height = Math.round(baseHeight * noiseVariance * scoreMultiplier * 100)

    // Color based on score - gradient from green (quiet) to red (noisy)
    const hue = 120 - (score * 1.2) // 120 = green, 0 = red
    const saturation = 70 + (score * 0.3)
    const lightness = 45 + (Math.random() * 10)
    const color = `hsl(${Math.max(0, hue)}, ${saturation}%, ${lightness}%)`

    const isActive = score > 50 && i % 3 === 0

    bars.push(`<div class="waveform-bar ${isActive ? 'active' : ''}" 
                   style="height: ${Math.max(8, height * 0.6)}px; 
                          background: ${color};
                          animation-delay: ${i * 0.05}s"></div>`)
  }

  return bars.join('')
}

// ===============================================
// INJECT DASHBOARD INTO SIDEBAR
// ===============================================
let currentAnalysisData = null // Store for silence report

function injectDashboard(data) {
  const sidebar = document.querySelector('#secondary-inner') || document.querySelector('#secondary')
  if (!sidebar) return false

  // Store data for silence report
  currentAnalysisData = data

  // Remove existing
  document.querySelector('#silenced-shadow-host')?.remove()

  // Create Shadow DOM container
  const { host, shadow, container } = createShadowContainer('silenced-shadow-host', sidebar)
  shadowHost = host

  // Insert dashboard content
  container.innerHTML = createDashboard(data)

  // Attach event listeners inside shadow DOM
  const noiseCancelToggle = shadow.getElementById('noise-cancel-toggle')
  const refreshBtn = shadow.getElementById('refresh-btn')
  const auditToggle = shadow.getElementById('audit-mode-toggle')
  const impactContainer = shadow.getElementById('impact-snapshot-container')
  const sustainabilityToggle = shadow.getElementById('sustainability-toggle')
  const sustainabilityContent = shadow.getElementById('sustainability-content')

  // Sustainability Toggle
  sustainabilityToggle?.addEventListener('click', () => {
    const isExpanded = sustainabilityToggle.getAttribute('aria-expanded') === 'true'
    const newState = !isExpanded
    sustainabilityToggle.setAttribute('aria-expanded', newState)
    if (sustainabilityContent) {
      sustainabilityContent.style.display = newState ? 'block' : 'none'
    }
  })

  // Noise Cancellation Toggle
  noiseCancelToggle?.addEventListener('click', () => {
    window.silencedToggleNoiseCancellation()
    const switchEl = noiseCancelToggle.querySelector('.toggle-switch')
    switchEl?.classList.toggle('on', noiseCancellationActive)
    noiseCancelToggle.classList.toggle('active', noiseCancellationActive)

    // Update toggle text
    const title = noiseCancelToggle.querySelector('.toggle-title')
    const desc = noiseCancelToggle.querySelector('.toggle-desc')
    const icon = noiseCancelToggle.querySelector('.toggle-icon')
    if (title) title.textContent = noiseCancellationActive ? 'Noise Cancellation ON' : 'Unmute the Silenced'
    if (desc) desc.textContent = noiseCancellationActive ? 'Showing hidden voices below ↓' : 'Reveal smaller creators on this topic'
    if (icon) icon.textContent = noiseCancellationActive ? '🎧' : '📢'
  })

  // Audit Mode Toggle
  auditToggle?.addEventListener('click', () => {
    auditModeActive = !auditModeActive
    const switchEl = auditToggle.querySelector('.audit-switch')
    switchEl?.classList.toggle('on', auditModeActive)
    auditToggle.classList.toggle('active', auditModeActive)

    // Update impact snapshot
    if (impactContainer) {
      if (auditModeActive) {
        impactContainer.innerHTML = renderImpactSnapshot(discoveryCache?.auditMetrics)
      } else {
        impactContainer.innerHTML = ''
      }
    }

    // Re-inject unmuted voices to update audit info display
    if (noiseCancellationActive && discoveryCache) {
      injectUnmutedVoices()
    }
  })

  refreshBtn?.addEventListener('click', () => {
    currentVideoId = null
    panelInjected = false
    run()
  })

  panelInjected = true
  return true
}

// ===============================================
// SILENCE REPORT MODAL
// ===============================================
function showSilenceReport(shadow, data) {
  const { noiseAnalysis, video, channel } = data
  const score = noiseAnalysis?.totalScore || 0
  const voicesSilenced = noiseAnalysis?.voicesSilenced || { count: 0, breakdown: {} }
  const isNoisy = score > 50

  // Create modal HTML
  const modalHtml = `
    <div class="silence-report-modal" id="silence-report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <div class="silence-report-content">
        <div class="report-header">
          <h2 class="report-title" id="report-title">
            🔇 The Silence Report
          </h2>
          <button class="report-close" id="report-close" aria-label="Close report">&times;</button>
        </div>
        
        <div class="report-body">
          <div class="report-section">
            <div class="report-section-title">Current Video Analysis</div>
            <div class="report-stat-card">
              <div class="report-stat-value ${isNoisy ? 'noise' : 'silenced'}">${score}/100</div>
              <div class="report-stat-label">
                ${isNoisy ? '🔊 Noise Level - This voice is algorithmically amplified' : '🔇 Signal Clarity - This voice struggles to be heard'}
              </div>
            </div>
          </div>
          
          ${voicesSilenced.count > 0 ? `
          <div class="report-section">
            <div class="report-section-title">What You're Not Hearing</div>
            <div class="report-chart">
              <div class="chart-bar-container">
                <div class="chart-bar-label">
                  <span>Noisy Channels (${'>'}100K subs)</span>
                  <span>~85% of recommendations</span>
                </div>
                <div class="chart-bar">
                  <div class="chart-bar-fill noise" style="width: 85%"></div>
                </div>
              </div>
              <div class="chart-bar-container">
                <div class="chart-bar-label">
                  <span>Silenced Voices (${'<'}100K subs)</span>
                  <span>~15% of recommendations</span>
                </div>
                <div class="chart-bar">
                  <div class="chart-bar-fill silenced" style="width: 15%"></div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="report-section">
            <div class="report-section-title">~${voicesSilenced.count} Voices Drowned Out</div>
            <div class="silenced-voices-list">
              <div class="silenced-voice-item">
                <div class="silenced-voice-icon">🌱</div>
                <div class="silenced-voice-info">
                  <div class="silenced-voice-type">Grassroots Activists</div>
                  <div class="silenced-voice-count">~${voicesSilenced.breakdown.grassrootsActivists || 0} voices silenced</div>
                </div>
              </div>
              <div class="silenced-voice-item">
                <div class="silenced-voice-icon">🌍</div>
                <div class="silenced-voice-info">
                  <div class="silenced-voice-type">Global South Perspectives</div>
                  <div class="silenced-voice-count">~${voicesSilenced.breakdown.globalSouthVoices || 0} voices silenced</div>
                </div>
              </div>
              <div class="silenced-voice-item">
                <div class="silenced-voice-icon">📚</div>
                <div class="silenced-voice-info">
                  <div class="silenced-voice-type">Local Experts & Researchers</div>
                  <div class="silenced-voice-count">~${voicesSilenced.breakdown.localExperts || 0} voices silenced</div>
                </div>
              </div>
              <div class="silenced-voice-item">
                <div class="silenced-voice-icon">🎓</div>
                <div class="silenced-voice-info">
                  <div class="silenced-voice-type">Emerging Educators</div>
                  <div class="silenced-voice-count">~${voicesSilenced.breakdown.emergingEducators || 0} voices silenced</div>
                </div>
              </div>
            </div>
          </div>
          ` : `
          <div class="report-section">
            <div class="report-stat-card" style="text-align: center;">
              <div style="font-size: 48px; margin-bottom: 12px;">🎉</div>
              <div class="report-stat-value silenced">Low Noise</div>
              <div class="report-stat-label">
                This creator is part of the solution! Supporting smaller voices helps diversify the content ecosystem.
              </div>
            </div>
          </div>
          `}
          
          <div class="report-section">
            <div class="report-section-title">Take Action</div>
            <div class="noise-cancel-toggle ${noiseCancellationActive ? 'active' : ''}"
                 id="report-noise-toggle"
                 role="switch"
                 tabindex="0"
                 style="margin: 0; border-radius: 8px;">
              <div class="toggle-switch ${noiseCancellationActive ? 'active' : ''}">
                <div class="toggle-thumb"></div>
              </div>
              <div class="toggle-label">
                <div class="toggle-title">🎧 Activate Noise Cancellation</div>
                <div class="toggle-hint">Mute noisy channels, unmute silenced voices</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  // Add modal to shadow DOM
  const modalContainer = document.createElement('div')
  modalContainer.innerHTML = modalHtml
  shadow.appendChild(modalContainer.firstElementChild)

  // Get modal elements
  const modal = shadow.getElementById('silence-report-modal')
  const closeBtn = shadow.getElementById('report-close')
  const reportNoiseToggle = shadow.getElementById('report-noise-toggle')

  // Close modal handlers
  const closeModal = () => {
    modal?.remove()
    silenceReportOpen = false
  }

  closeBtn?.addEventListener('click', closeModal)
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal()
  })

  // Escape key to close
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal()
      document.removeEventListener('keydown', escHandler)
    }
  }
  document.addEventListener('keydown', escHandler)

  // Noise toggle in report
  reportNoiseToggle?.addEventListener('click', () => {
    window.silencedToggleNoiseCancellation()
    const switchEl = reportNoiseToggle.querySelector('.toggle-switch')
    switchEl?.classList.toggle('active', noiseCancellationActive)
    reportNoiseToggle.classList.toggle('active', noiseCancellationActive)

    // Also update main toggle
    const mainToggle = shadow.getElementById('noise-cancel-toggle')
    const mainSwitch = mainToggle?.querySelector('.toggle-switch')
    mainSwitch?.classList.toggle('active', noiseCancellationActive)
    mainToggle?.classList.toggle('active', noiseCancellationActive)
  })

  silenceReportOpen = true
}

// ===============================================
// NOISE CANCELLATION - Mute the Noise, Unmute Silenced Voices
// ===============================================
async function runNoiseCancellation(query) {
  if (!query) {
    query = extractCurrentQuery()
  }

  console.log('[Silenced] 🎧 Activating noise cancellation for:', query)

  const response = await safeSendMessage({ action: 'cancelNoise', query })
  if (response?.success) {
    discoveryCache = response.data
    console.log('[Silenced] ✓ Noise cancellation complete:', response.data)
    console.log('[Silenced] Response has unmutedVideos:', Array.isArray(response.data?.unmutedVideos))
    console.log('[Silenced] Unmuted videos count:', response.data?.unmutedVideos?.length || 0)
    if (response.data?.unmutedVideos?.length === 0) {
      console.warn('[Silenced] ⚠️ No unmuted videos in response - all may have been filtered or none found')
    }
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
    // Try multiple selectors for video title (YouTube changes DOM frequently)
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
        console.log(`[Silenced] Found video title using selector: ${selector}`)
        break
      }
    }

    if (!title) {
      // Fallback: try to get from page title
      const pageTitle = document.title.replace(' - YouTube', '').trim()
      if (pageTitle && pageTitle !== 'YouTube') {
        title = pageTitle
        console.log('[Silenced] Using page title as fallback')
      }
    }

    if (title) {
      // Extract meaningful keywords from title
      const query = title.split(/[-|:•]/).slice(0, 2).join(' ').trim()
      console.log(`[Silenced] Extracted query from title: "${query}"`)
      return query
    }
  }

  // Default fallback
  console.log('[Silenced] Using default query (no title found)')
  return 'sustainability climate environment'
}

// Renamed and enhanced toggle function
window.silencedToggleNoiseCancellation = async function () {
  noiseCancellationActive = !noiseCancellationActive
  await saveNoiseCancellationState(noiseCancellationActive)

  // Update toggle UI if exists in shadow DOM
  if (shadowHost) {
    const toggle = shadowHost.shadowRoot?.querySelector('#noise-cancel-toggle')
    const switchEl = toggle?.querySelector('.toggle-switch')
    switchEl?.classList.toggle('on', noiseCancellationActive)
    toggle?.classList.toggle('active', noiseCancellationActive)

    // Update toggle text
    const title = toggle?.querySelector('.toggle-title')
    const desc = toggle?.querySelector('.toggle-desc')
    const icon = toggle?.querySelector('.toggle-icon')
    if (title) title.textContent = noiseCancellationActive ? 'Noise Cancellation ON' : 'Unmute the Silenced'
    if (desc) desc.textContent = noiseCancellationActive ? 'Showing hidden voices below ↓' : 'Reveal smaller creators on this topic'
    if (icon) icon.textContent = noiseCancellationActive ? '🎧' : '📢'
  }

  // Update floating toggle if exists
  const floatingToggle = document.getElementById('silenced-noise-toggle')
  if (floatingToggle) {
    floatingToggle.classList.toggle('active', noiseCancellationActive)
    const statusEl = floatingToggle.querySelector('.toggle-status')
    if (statusEl) statusEl.textContent = noiseCancellationActive ? 'ACTIVE' : 'OFF'
  }

  if (noiseCancellationActive) {
    const query = extractCurrentQuery()
    await runNoiseCancellation(query)

    // Mute noisy videos in sidebar
    muteNoisyVideos()

    // Inject unmuted alternatives
    injectUnmutedVoices()

    // Setup observer
    setupNoiseCancellationObserver()

    // Label thumbnails on homepage/search
    if (!isWatchPage()) {
      injectThumbnailStyles()
      labelVideoThumbnails()
    }

    // Update stats
    if (discoveryCache) {
      await updateStats(discoveryCache.unmutedVideos?.length || 0, discoveryCache.channelsToMute?.length || 0)
    }
  } else {
    // Restore muted videos
    document.querySelectorAll('[data-silenced-muted]').forEach(el => {
      el.style.display = ''
      el.removeAttribute('data-silenced-muted')
    })

    // Remove injected unmuted cards
    document.querySelectorAll('.silenced-unmuted-container').forEach(el => el.remove())

    // Clear thumbnail labels
    clearThumbnailLabels()

    if (discoveryObserver) {
      discoveryObserver.disconnect()
      discoveryObserver = null
    }
  }

  console.log('[Silenced] 🎧 Noise Cancellation:', noiseCancellationActive ? 'ACTIVE' : 'OFF')
}

// Backward compatibility alias
window.silencedToggleDiscovery = window.silencedToggleNoiseCancellation

// Mute noisy videos in sidebar (>100K subs)
function muteNoisyVideos() {
  const noisyIds = new Set(discoveryCache?.noisyChannelIds || discoveryCache?.monopolyChannelIds || [])
  if (noisyIds.size === 0) return

  // Target sidebar recommendations
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

  // Also mute first 3 sidebar videos by default (typically from noisy channels)
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

// Backward compatibility
function hideMonopolyVideos() { muteNoisyVideos() }

// Inject unmuted voice alternative videos with bias snapshot and explainability
function injectUnmutedVoices() {
  console.log('[Silenced] Attempting to inject unmuted voices')
  console.log('[Silenced] discoveryCache:', discoveryCache)
  console.log('[Silenced] unmutedVideos count:', discoveryCache?.unmutedVideos?.length || 0)

  const videos = discoveryCache?.unmutedVideos || discoveryCache?.discoveredVideos || []
  const biasSnapshot = discoveryCache?.biasSnapshot

  if (videos.length === 0) {
    console.log('[Silenced] No videos to inject - unmutedVideos is empty')

    // Show a message that no silenced voices were found for this topic
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

  // Inject bias receipt styles (outside shadow DOM)
  injectBiasReceiptStyles()

  // Remove existing injected cards
  document.querySelectorAll('.silenced-unmuted-container, .silenced-equity-container').forEach(el => el.remove())

  // Find sidebar
  const sidebar = document.querySelector('#secondary ytd-watch-next-secondary-results-renderer, #secondary-inner')
  if (!sidebar) {
    console.log('[Silenced] Could not find sidebar element')
    return
  }
  console.log('[Silenced] Found sidebar, injecting', videos.length, 'videos')

  // Create container
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
  // When Audit Mode is ON, rename to "Platform Context" to avoid confusion with Impact Snapshot
  if (biasSnapshot) {
    const snapshot = document.createElement('div')
    snapshot.style.cssText = `
      padding: 10px;
      background: #0a0a0a;
      border-radius: 6px;
      margin-bottom: 12px;
    `
    const concentrationClass = biasSnapshot.topicConcentration > 70 ? 'color: #f59e0b;' : 'color: #10b981;'

    // Fix 1: Different title when Audit Mode is ON
    const snapshotTitle = auditModeActive ? 'Platform Context' : 'Topic Bias Snapshot'
    const subtitleHtml = auditModeActive
      ? '<div style="font-size: 8px; color: #4b5563; margin-bottom: 6px;">Baseline distribution for this topic</div>'
      : ''

    // Safely format percentage values
    const topicConcentration = typeof biasSnapshot.topicConcentration === 'number' ? biasSnapshot.topicConcentration : 0
    const underAmplifiedRate = typeof biasSnapshot.underAmplifiedRate === 'number' ? biasSnapshot.underAmplifiedRate : 0
    const safeConcentrationClass = topicConcentration > 70 ? 'color: #f59e0b;' : 'color: #10b981;'

    snapshot.innerHTML = `
      <div style="font-size: 9px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: ${auditModeActive ? '2px' : '8px'};">${snapshotTitle}</div>
      ${subtitleHtml}
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div style="padding: 6px 8px; background: #171717; border-radius: 4px;">
          <div style="font-size: 14px; font-weight: 700; ${safeConcentrationClass}">${topicConcentration}%</div>
          <div style="font-size: 8px; color: #6b7280;">Top 10 concentration</div>
        </div>
        <div style="padding: 6px 8px; background: #171717; border-radius: 4px;">
          <div style="font-size: 14px; font-weight: 700; color: #10b981;">${underAmplifiedRate}%</div>
          <div style="font-size: 8px; color: #6b7280;">Under-amplified</div>
        </div>
      </div>
    `
    container.appendChild(snapshot)
  }

  // Check if current topic is sustainability-related
  const currentQuery = extractCurrentQuery().toLowerCase()
  const sustainabilityKeywords = ['climate', 'sustainable', 'sustainability', 'esg', 'carbon', 'renewable', 'green energy', 'clean energy', 'environment', 'eco-friendly', 'biodiversity', 'emissions', 'net zero', 'net-zero']
  const isSustainabilityTopic = sustainabilityKeywords.some(kw => currentQuery.includes(kw))

  // Header with KPMG sustainability badge if applicable
  const header = document.createElement('div')
  header.style.cssText = 'font-size: 11px; font-weight: 600; color: #10b981; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between;'
  header.innerHTML = `
    <span>Under-represented Voices</span>
    ${isSustainabilityTopic ? '<span style="font-size: 8px; background: #059669; color: #fff; padding: 2px 6px; border-radius: 3px; font-weight: 600;">🌍 KPMG</span>' : ''}
  `
  container.appendChild(header)

  if (isSustainabilityTopic) {
    const sustainabilityNote = document.createElement('div')
    sustainabilityNote.style.cssText = 'font-size: 10px; color: #6b7280; margin-bottom: 10px; padding: 8px 10px; background: #0a0a0a; border-radius: 4px; border-left: 2px solid #059669;'
    sustainabilityNote.innerHTML = '🌿 <strong style="color: #10b981;">KPMG Sustainability Challenge:</strong> Surfacing smaller voices on environmental topics helps counter greenwashing from dominant corporate channels.'
    container.appendChild(sustainabilityNote)
  }

  // Add video cards with Bias Receipt
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
              ${method === 'heuristic' ? '<span class="silenced-receipt-method fallback">Fallback</span>' : method === 'gemini' ? '<span class="silenced-receipt-method ai">AI</span>' : ''}
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

    // Build audit info line (only when audit mode is active)
    // Fix 3: Use improved method label formatting
    const surfaceMethod = video.surfaceMethod || 'engagement_ranking'
    const diversityNote = video.diversityNote || ''
    const methodDisplay = formatDiversityMethod(surfaceMethod)

    // Check if this video was transcript-verified
    const isTranscriptVerified = surfaceMethod.includes('transcript')
    const transcriptBadge = isTranscriptVerified
      ? '<span style="background: #065f46; color: #10b981; padding: 1px 4px; border-radius: 3px; font-size: 8px; margin-left: 4px;">VERIFIED</span>'
      : ''

    // KPMG Sustainability badge for this video
    let sustainabilityBadgeHtml = ''
    if (video.isSustainabilityVideo && video.sustainabilityCredibility) {
      const credColors = {
        high: { bg: '#065f46', color: '#10b981', label: '✓ VERIFIED' },
        moderate: { bg: '#78350f', color: '#fbbf24', label: '? REVIEW' },
        caution: { bg: '#7f1d1d', color: '#f87171', label: '⚠ CAUTION' }
      }
      const cred = credColors[video.sustainabilityCredibility] || credColors.moderate
      sustainabilityBadgeHtml = `<span style="background: ${cred.bg}; color: ${cred.color}; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: 600; margin-left: 6px;">${cred.label}</span>`
    }

    const auditInfoHtml = auditModeActive ? `
      <div style="padding: 6px 10px; border-top: 1px solid #262626; font-size: 10px; color: #6b7280; font-family: 'SF Mono', Monaco, monospace;">
        Subs: ${fmt(video.subscriberCount)} · Surfaced via: ${methodDisplay}${transcriptBadge}
        ${diversityNote ? `<div style="font-size: 9px; color: #4b5563; margin-top: 2px;">${esc(diversityNote)}</div>` : ''}
      </div>
    ` : ''

    card.innerHTML = `
      <a href="/watch?v=${video.videoId}" class="video-link" style="display: block; padding: 10px; text-decoration: none;">
        <div style="display: flex; gap: 10px;">
          <img src="${video.thumbnail}" style="width: 100px; height: 56px; border-radius: 4px; object-fit: cover; flex-shrink: 0; background: #262626;" alt="">
        <div style="flex: 1; min-width: 0;">
            <div style="font-size: 12px; font-weight: 500; color: #e5e5e5; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
            ${esc(video.title)}
          </div>
            <div style="font-size: 10px; color: #9ca3af; margin-top: 3px;">${esc(video.channelTitle)} · ${fmt(video.subscriberCount)} subs${sustainabilityBadgeHtml}</div>
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

  // Footer with muted count and KPMG badge
  const mutedChannels = discoveryCache?.channelsToMute || []
  const footer = document.createElement('div')
  footer.style.cssText = 'font-size: 10px; color: #6b7280; margin-top: 10px; padding-top: 8px; border-top: 1px solid #262626; display: flex; justify-content: space-between; align-items: center;'
  footer.innerHTML = `
    <span>${mutedChannels.length > 0 ? `${mutedChannels.length} dominant channels de-prioritized` : 'Surfacing under-represented voices'}</span>
    <span style="font-size: 8px; color: #4b5563;">Hack the Bias '26 ${isSustainabilityTopic ? '· KPMG Challenge' : ''}</span>
  `
  container.appendChild(footer)

  // Insert after shadow host
  const shadowHost = document.querySelector('#silenced-shadow-host')
  if (shadowHost && shadowHost.nextSibling) {
    sidebar.insertBefore(container, shadowHost.nextSibling)
  } else if (shadowHost) {
    shadowHost.after(container)
  } else {
    sidebar.insertBefore(container, sidebar.firstChild)
  }

  console.log('[Silenced] Injected', videos.length, 'unmuted voices with explainability')
}

// Backward compatibility
function injectEquityAlternatives() { injectUnmutedVoices() }

// ===============================================
// MUTATION OBSERVER - Re-mute new noisy videos
// ===============================================
function setupNoiseCancellationObserver() {
  if (discoveryObserver) {
    discoveryObserver.disconnect()
  }

  discoveryObserver = new MutationObserver((mutations) => {
    if (!noiseCancellationActive) return

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Re-mute any new noisy videos
          if (node.matches?.('ytd-compact-video-renderer')) {
            setTimeout(() => muteNoisyVideos(), 100)
          }
        }
      }
    }
  })

  discoveryObserver.observe(document.body, { childList: true, subtree: true })
}

// Backward compatibility
function setupDiscoveryObserver() { setupNoiseCancellationObserver() }

// ===============================================
// FLOATING TOGGLE (for non-watch pages)
// ===============================================
function createFloatingToggle() {
  const existing = document.getElementById('silenced-noise-toggle')
  if (existing) {
    existing.classList.toggle('active', noiseCancellationActive)
    const statusEl = existing.querySelector('.toggle-status')
    if (statusEl) statusEl.textContent = noiseCancellationActive ? 'ACTIVE' : 'OFF'
    return
  }

  // Also remove old toggle if exists
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

// ===============================================
// MAIN ANALYSIS FUNCTION
// ===============================================
async function run() {
  const videoId = getVideoId()
  if (!videoId || (videoId === currentVideoId && panelInjected)) return

  currentVideoId = videoId
  panelInjected = false
  breakdownOpen = false
  silenceReportOpen = false

  // Wait for sidebar
  for (let i = 0; i < 15; i++) {
    if (document.querySelector('#secondary')) break
    await new Promise(r => setTimeout(r, 1000))
  }

  // Show loading state (inject minimal dashboard first)
  const sidebar = document.querySelector('#secondary-inner') || document.querySelector('#secondary')
  if (!sidebar) return

  // Create shadow host with loading state
  document.querySelector('#silenced-shadow-host')?.remove()
  const { host, shadow, container } = createShadowContainer('silenced-shadow-host', sidebar)
  shadowHost = host

  container.innerHTML = `
    <div class="silenced-panel">
      <div class="panel-header">
        <div class="header-brand">
          <span class="brand-icon">🔊</span>
          <span class="brand-name">silenced</span>
        </div>
      </div>
        <div class="loading-state">
          <div class="spinner"></div>
        <div class="loading-text">Analyzing video...</div>
      </div>
    </div>
  `

  // Fetch transcript
  const transcript = await getTranscript(videoId)

  // Get analysis from background script
  const response = await safeSendMessage({
    action: 'analyze',
    videoId,
    transcript: transcript?.substring(0, 8000)
  })

  if (response?.success && response?.data) {
    injectDashboard(response.data)

    // If noise cancellation is active, run it
    if (noiseCancellationActive) {
      const query = extractCurrentQuery()
      await runNoiseCancellation(query)
      muteNoisyVideos()
      injectUnmutedVoices()
    }
  } else {
    // Show error
    container.innerHTML = `
      <div class="silenced-panel">
        <div class="panel-header">
          <div class="header-brand">
            <span class="brand-icon">📡</span>
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

// ===============================================
// TRANSCRIPT FETCHING
// ===============================================
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

// ===============================================
// RETRY FUNCTION
// ===============================================
window.silencedRetry = () => {
  currentVideoId = null
  panelInjected = false
  run()
}

// ===============================================
// MESSAGE HANDLER
// ===============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleDiscoveryMode' || request.action === 'toggleNoiseCancellation') {
    window.silencedToggleNoiseCancellation()
    sendResponse({ success: true, noiseCancellationActive })
  }
  return false
})

// ===============================================
// NAVIGATION DETECTION
// ===============================================
let lastUrl = location.href
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    currentVideoId = null
    panelInjected = false
    processedVideoCards.clear()

    // Remove old UI
    document.querySelector('#silenced-shadow-host')?.remove()
    document.querySelectorAll('.silenced-unmuted-container, .silenced-equity-container').forEach(el => el.remove())

    if (isWatchPage()) {
      setTimeout(run, 1500)
    }

    // Update floating toggle
    createFloatingToggle()

    // Re-run noise cancellation on navigation
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

  if (isWatchPage()) setTimeout(run, 1500)
  createFloatingToggle()

  // Label thumbnails on homepage/search when noise cancellation is active
  if (noiseCancellationActive && !isWatchPage()) {
    injectThumbnailStyles()
    setTimeout(() => labelVideoThumbnails(), 2000)
    setTimeout(() => labelVideoThumbnails(), 4000) // Re-run for lazy-loaded content
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

// ===============================================
// INITIALIZATION
// ===============================================
async function init() {
  // Load persisted noise cancellation state
  await loadNoiseCancellationState()

  // Load session stats
  const stored = await chrome.storage.local.get(['discoveredCount', 'hiddenCount'])
  stats.voicesUnmuted = stored.discoveredCount || 0
  stats.noiseMuted = stored.hiddenCount || 0

  // Create floating toggle
  setTimeout(createFloatingToggle, 2000)

  // Run analysis on watch pages
  if (isWatchPage()) {
    setTimeout(run, 2000)
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
}

init()

console.log('[Silenced] 🔇→🔊 Noise Cancellation Engine v3.0 loaded - Hear the voices the algorithm drowns out')
