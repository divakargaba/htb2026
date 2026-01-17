// Silenced - YouTube Equity Filter with Shadow DOM Injection
// Features: Equity Score Dashboard + Discovery Mode + KPMG Sustainability Audit

const SUPABASE_URL = 'https://ntspwmgvabdpifzzebrv.supabase.co/functions/v1/recommend'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50c3B3bWd2YWJkcGlmenplYnJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MzIyNjIsImV4cCI6MjA4NDIwODI2Mn0.26ndaCrexA3g29FHrJB1uBKJIUW6E5yn-nbvarsBp4o'

// ===============================================
// STATE
// ===============================================
let currentVideoId = null
let panelInjected = false
let isOpen = true
let breakdownOpen = false
let discoveryMode = false
let discoveryCache = null
let discoveryObserver = null
let processedVideoCards = new Set()
let shadowHost = null

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

// ===============================================
// PERSISTENCE - Load Discovery Mode state
// ===============================================
async function loadDiscoveryState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getDiscoveryMode' }, (response) => {
      discoveryMode = response?.enabled || false
      resolve(discoveryMode)
    })
  })
}

async function saveDiscoveryState(enabled) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'setDiscoveryMode', enabled }, () => {
      resolve()
    })
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
    /* Reset and base styles inside Shadow DOM */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    .silenced-container {
      font-family: "Roboto", "Arial", sans-serif;
      color: #f1f1f1;
      font-size: 14px;
      line-height: 1.4;
    }
    
    /* Dashboard Panel */
    .silenced-dashboard {
      background: linear-gradient(145deg, #1a1a1a 0%, #0d0d0d 100%);
      border: 1px solid #333;
      border-radius: 12px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    
    .dashboard-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: linear-gradient(90deg, #1a3a1a 0%, #1a1a1a 100%);
      cursor: pointer;
      border-bottom: 1px solid #333;
    }
    
    .dashboard-header:hover {
      background: linear-gradient(90deg, #1f4a1f 0%, #252525 100%);
    }
    
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .logo-icon {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #00E676 0%, #00C853 100%);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .logo-icon svg {
      width: 16px;
      height: 16px;
      fill: white;
    }
    
    .logo-text {
      font-size: 16px;
      font-weight: 600;
      color: #00E676;
      letter-spacing: -0.3px;
    }
    
    .score-chip {
      background: #00E676;
      color: #000;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
    }
    
    .chevron {
      width: 24px;
      height: 24px;
      fill: #aaa;
      transition: transform 0.2s ease;
    }
    
    .chevron.open {
      transform: rotate(180deg);
    }
    
    /* Score Display */
    .score-section {
      padding: 24px 16px;
      text-align: center;
      background: linear-gradient(180deg, rgba(0,230,118,0.05) 0%, transparent 100%);
    }
    
    .score-ring {
      width: 120px;
      height: 120px;
      margin: 0 auto 16px;
      position: relative;
    }
    
    .score-ring svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }
    
    .score-ring circle {
      fill: none;
      stroke-width: 8;
    }
    
    .score-ring .bg {
      stroke: #333;
    }
    
    .score-ring .progress {
      stroke: #00E676;
      stroke-linecap: round;
      transition: stroke-dashoffset 1s ease;
    }
    
    .score-value {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 32px;
      font-weight: 700;
      color: #00E676;
    }
    
    .score-value span {
      font-size: 16px;
      color: #888;
    }
    
    .score-label {
      font-size: 14px;
      color: #aaa;
      margin-bottom: 8px;
    }
    
    .score-sublabel {
      font-size: 12px;
      color: #666;
    }
    
    /* Breakdown Items */
    .breakdown-section {
      border-top: 1px solid #333;
    }
    
    .breakdown-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      cursor: pointer;
    }
    
    .breakdown-header:hover {
      background: #252525;
    }
    
    .breakdown-title {
      font-size: 14px;
      font-weight: 500;
      color: #f1f1f1;
    }
    
    .breakdown-content {
      display: none;
      padding: 0 16px 16px;
    }
    
    .breakdown-content.open {
      display: block;
    }
    
    .metric-item {
      padding: 12px;
      background: #1a1a1a;
      border-radius: 8px;
      margin-bottom: 8px;
      border-left: 3px solid #00E676;
    }
    
    .metric-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    
    .metric-name {
      font-size: 13px;
      font-weight: 500;
      color: #f1f1f1;
    }
    
    .metric-score {
      font-size: 13px;
      font-weight: 600;
      color: #00E676;
    }
    
    .metric-bar {
      height: 4px;
      background: #333;
      border-radius: 2px;
      margin-bottom: 6px;
      overflow: hidden;
    }
    
    .metric-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #00E676 0%, #00C853 100%);
      border-radius: 2px;
      transition: width 0.5s ease;
    }
    
    .metric-explanation {
      font-size: 12px;
      color: #888;
      line-height: 1.4;
    }
    
    .metric-value {
      font-size: 11px;
      color: #666;
      margin-top: 4px;
    }
    
    /* Sustainability Badge */
    .sustainability-badge {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      margin: 12px 16px;
      border-radius: 8px;
      animation: badgePulse 2s ease-in-out infinite;
    }
    
    .sustainability-badge.verified {
      background: linear-gradient(135deg, rgba(0,230,118,0.2) 0%, rgba(0,200,83,0.1) 100%);
      border: 1px solid #00E676;
    }
    
    .sustainability-badge.warning {
      background: linear-gradient(135deg, rgba(255,152,0,0.2) 0%, rgba(255,87,34,0.1) 100%);
      border: 1px solid #FF9800;
    }
    
    .badge-icon {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    
    .badge-content {
      flex: 1;
    }
    
    .badge-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .badge-subtitle {
      font-size: 11px;
      color: #aaa;
      margin-top: 2px;
    }
    
    @keyframes badgePulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.85; }
    }
    
    /* Discovery Mode Toggle */
    .discovery-toggle {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: #1a1a1a;
      border-top: 1px solid #333;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    
    .discovery-toggle:hover {
      background: #252525;
    }
    
    .toggle-switch {
      width: 48px;
      height: 26px;
      background: #444;
      border-radius: 13px;
      position: relative;
      transition: background 0.3s ease;
    }
    
    .toggle-switch.active {
      background: #00E676;
    }
    
    .toggle-thumb {
      width: 22px;
      height: 22px;
      background: white;
      border-radius: 50%;
      position: absolute;
      top: 2px;
      left: 2px;
      transition: transform 0.3s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    
    .toggle-switch.active .toggle-thumb {
      transform: translateX(22px);
    }
    
    .toggle-label {
      flex: 1;
    }
    
    .toggle-title {
      font-size: 14px;
      font-weight: 500;
      color: #f1f1f1;
    }
    
    .toggle-hint {
      font-size: 11px;
      color: #888;
    }
    
    /* Footer */
    .dashboard-footer {
      padding: 10px 16px;
      background: #0d0d0d;
      border-top: 1px solid #333;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .footer-text {
      font-size: 11px;
      color: #555;
    }
    
    .footer-link {
      font-size: 11px;
      color: #00E676;
      cursor: pointer;
      text-decoration: none;
    }
    
    .footer-link:hover {
      text-decoration: underline;
    }
    
    /* Loading State */
    .loading-state {
      padding: 48px 16px;
      text-align: center;
    }
    
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #333;
      border-top-color: #00E676;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .loading-text {
      font-size: 14px;
      color: #888;
    }
    
    /* Body visibility */
    .dashboard-body {
      display: none;
    }
    
    .dashboard-body.open {
      display: block;
    }
    
    /* ARIA Focus Styles */
    button:focus, [role="button"]:focus, [tabindex="0"]:focus {
      outline: 2px solid #00E676;
      outline-offset: 2px;
    }
    
    /* Injected Video Cards (for sidebar) */
    .equity-video-card {
      background: #1a1a1a;
      border: 2px solid #00E676;
      border-radius: 8px;
      margin-bottom: 8px;
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    
    .equity-video-card:hover {
      transform: translateX(-4px);
      box-shadow: 4px 0 12px rgba(0,230,118,0.3);
    }
    
    .equity-video-link {
      display: flex;
      gap: 8px;
      padding: 8px;
      text-decoration: none;
    }
    
    .equity-thumb {
      width: 120px;
      height: 68px;
      border-radius: 4px;
      object-fit: cover;
      flex-shrink: 0;
    }
    
    .equity-info {
      flex: 1;
      min-width: 0;
    }
    
    .equity-title {
      font-size: 12px;
      font-weight: 500;
      color: #f1f1f1;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 4px;
    }
    
    .equity-channel {
      font-size: 11px;
      color: #aaa;
      margin-bottom: 4px;
    }
    
    .equity-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      background: linear-gradient(90deg, #00E676 0%, #00C853 100%);
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      color: #000;
    }
    
    .rising-star-badge {
      background: linear-gradient(90deg, #FFD700 0%, #FFA000 100%);
    }
  `
}

// ===============================================
// EQUITY SCORE DASHBOARD
// ===============================================
function createDashboard(data) {
  const { equityScore, sustainability, video, channel } = data
  const score = equityScore?.totalScore || 0
  const breakdown = equityScore?.breakdown || []
  const circumference = 2 * Math.PI * 52
  const offset = circumference - (score / 100) * circumference
  
  // Sustainability badge HTML
  let sustainabilityHtml = ''
  if (sustainability?.isSustainability && sustainability?.auditResult) {
    const audit = sustainability.auditResult
    const isVerified = audit.passesAudit
    sustainabilityHtml = `
      <div class="sustainability-badge ${isVerified ? 'verified' : 'warning'}"
           role="status"
           aria-label="${audit.level}: Score ${audit.score} out of 100">
        <div class="badge-icon" style="background: ${audit.badgeColor}20; border: 2px solid ${audit.badgeColor}">
          ${isVerified ? '🌿' : '⚠️'}
        </div>
        <div class="badge-content">
          <div class="badge-title" style="color: ${audit.badgeColor}">${audit.level}</div>
          <div class="badge-subtitle">${audit.recommendation}</div>
        </div>
      </div>
    `
  }
  
  return `
    <div class="silenced-dashboard" role="region" aria-label="Algorithmic Bias Analysis Dashboard">
      <div class="dashboard-header" 
           id="dashboard-toggle"
           role="button"
           tabindex="0"
           aria-expanded="${isOpen}"
           aria-controls="dashboard-body"
           aria-label="Toggle dashboard, current score ${score} out of 100">
        <div class="header-left">
          <div class="logo-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
          </div>
          <span class="logo-text">Silenced</span>
          <span class="score-chip" aria-label="Bias score">${score}/100</span>
        </div>
        <svg class="chevron ${isOpen ? 'open' : ''}" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
        </svg>
      </div>
      
      <div class="dashboard-body ${isOpen ? 'open' : ''}" id="dashboard-body">
        <div class="loading-state" id="loading-state" style="display: none;">
          <div class="spinner" aria-hidden="true"></div>
          <div class="loading-text">Analyzing algorithmic bias...</div>
        </div>
        
        <div id="dashboard-content">
          <div class="score-section">
            <div class="score-ring" role="img" aria-label="Bias score ${score} percent">
              <svg viewBox="0 0 120 120">
                <circle class="bg" cx="60" cy="60" r="52"/>
                <circle class="progress" cx="60" cy="60" r="52"
                        stroke-dasharray="${circumference}"
                        stroke-dashoffset="${offset}"/>
              </svg>
              <div class="score-value">${score}<span>/100</span></div>
            </div>
            <div class="score-label">Algorithmic Bias Score</div>
            <div class="score-sublabel">Higher = More Algorithmically Favored</div>
          </div>
          
          ${sustainabilityHtml}
          
          <div class="breakdown-section">
            <div class="breakdown-header"
                 id="breakdown-toggle"
                 role="button"
                 tabindex="0"
                 aria-expanded="${breakdownOpen}"
                 aria-controls="breakdown-content"
                 aria-label="Toggle detailed breakdown">
              <span class="breakdown-title">Detailed Breakdown</span>
              <svg class="chevron ${breakdownOpen ? 'open' : ''}" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
            </div>
            <div class="breakdown-content ${breakdownOpen ? 'open' : ''}" id="breakdown-content" role="list">
              ${breakdown.map((item, i) => `
                <div class="metric-item" role="listitem" aria-label="${item.factor}: ${item.weighted} points">
                  <div class="metric-header">
                    <span class="metric-name">${esc(item.factor)}</span>
                    <span class="metric-score">+${item.weighted}/${item.weight}</span>
                  </div>
                  <div class="metric-bar" role="progressbar" aria-valuenow="${item.score}" aria-valuemin="0" aria-valuemax="100">
                    <div class="metric-bar-fill" style="width: ${item.score}%"></div>
                  </div>
                  <div class="metric-explanation">${esc(item.explanation)}</div>
                  <div class="metric-value">${esc(item.metric)}</div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="discovery-toggle"
               id="discovery-mode-toggle"
               role="switch"
               tabindex="0"
               aria-checked="${discoveryMode}"
               aria-label="Discovery Mode: Find underrepresented creators">
            <div class="toggle-switch ${discoveryMode ? 'active' : ''}">
              <div class="toggle-thumb"></div>
            </div>
            <div class="toggle-label">
              <div class="toggle-title">Discovery Mode</div>
              <div class="toggle-hint">Hide monopoly channels, show equity creators</div>
            </div>
          </div>
        </div>
        
        <div class="dashboard-footer">
          <span class="footer-text">Silenced by the Algorithm v2.0</span>
          <a class="footer-link" id="refresh-btn" role="button" tabindex="0" aria-label="Refresh analysis">Refresh</a>
        </div>
      </div>
    </div>
  `
}

// ===============================================
// INJECT DASHBOARD INTO SIDEBAR
// ===============================================
function injectDashboard(data) {
  const sidebar = document.querySelector('#secondary-inner') || document.querySelector('#secondary')
  if (!sidebar) return false
  
  // Remove existing
  document.querySelector('#silenced-shadow-host')?.remove()
  
  // Create Shadow DOM container
  const { host, shadow, container } = createShadowContainer('silenced-shadow-host', sidebar)
  shadowHost = host
  
  // Insert dashboard content
  container.innerHTML = createDashboard(data)
  
  // Attach event listeners inside shadow DOM
  const dashboardToggle = shadow.getElementById('dashboard-toggle')
  const breakdownToggle = shadow.getElementById('breakdown-toggle')
  const discoveryToggle = shadow.getElementById('discovery-mode-toggle')
  const refreshBtn = shadow.getElementById('refresh-btn')
  
  dashboardToggle?.addEventListener('click', () => {
    isOpen = !isOpen
    const body = shadow.getElementById('dashboard-body')
    const chevron = dashboardToggle.querySelector('.chevron')
    body?.classList.toggle('open', isOpen)
    chevron?.classList.toggle('open', isOpen)
    dashboardToggle.setAttribute('aria-expanded', isOpen)
  })
  
  // Keyboard support
  dashboardToggle?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      dashboardToggle.click()
    }
  })
  
  breakdownToggle?.addEventListener('click', () => {
    breakdownOpen = !breakdownOpen
    const content = shadow.getElementById('breakdown-content')
    const chevron = breakdownToggle.querySelector('.chevron')
    content?.classList.toggle('open', breakdownOpen)
    chevron?.classList.toggle('open', breakdownOpen)
    breakdownToggle.setAttribute('aria-expanded', breakdownOpen)
  })
  
  breakdownToggle?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      breakdownToggle.click()
    }
  })
  
  discoveryToggle?.addEventListener('click', () => {
    window.silencedToggleDiscovery()
    const switchEl = discoveryToggle.querySelector('.toggle-switch')
    switchEl?.classList.toggle('active', discoveryMode)
    discoveryToggle.setAttribute('aria-checked', discoveryMode)
  })
  
  discoveryToggle?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      discoveryToggle.click()
    }
  })
  
  refreshBtn?.addEventListener('click', () => {
    currentVideoId = null
    panelInjected = false
    run()
  })
  
  refreshBtn?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      refreshBtn.click()
    }
  })
  
  panelInjected = true
  return true
}

// ===============================================
// DISCOVERY MODE - Hide Monopolies, Show Equity
// ===============================================
async function runDiscovery(query) {
  if (!query) {
    query = extractCurrentQuery()
  }
  
  console.log('[Silenced] Running Discovery for:', query)
  
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'discover', query }, (response) => {
      if (response?.success) {
        discoveryCache = response.data
        console.log('[Silenced] Discovery complete:', response.data)
        resolve(response.data)
      } else {
        console.error('[Silenced] Discovery failed:', response?.error)
        resolve(null)
      }
    })
  })
}

function extractCurrentQuery() {
  if (isSearchPage()) {
    return new URLSearchParams(window.location.search).get('search_query') || ''
  }
  
  if (isWatchPage()) {
    const title = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata, yt-formatted-string.ytd-watch-metadata')?.textContent
    return title?.split(/[-|:]/).slice(0, 2).join(' ').trim() || ''
  }
  
  return 'sustainability climate environment'
}

window.silencedToggleDiscovery = async function() {
  discoveryMode = !discoveryMode
  await saveDiscoveryState(discoveryMode)
  
  // Update toggle UI if exists in shadow DOM
  if (shadowHost) {
    const toggle = shadowHost.shadowRoot?.querySelector('#discovery-mode-toggle')
    const switchEl = toggle?.querySelector('.toggle-switch')
    switchEl?.classList.toggle('active', discoveryMode)
    toggle?.setAttribute('aria-checked', discoveryMode)
  }
  
  // Update floating toggle if exists
  const floatingToggle = document.getElementById('silenced-discovery-toggle')
  if (floatingToggle) {
    floatingToggle.classList.toggle('active', discoveryMode)
    floatingToggle.querySelector('.toggle-status').textContent = discoveryMode ? 'ON' : 'OFF'
  }
  
  if (discoveryMode) {
    const query = extractCurrentQuery()
    await runDiscovery(query)
    
    // Hide monopoly videos in sidebar
    hideMonopolyVideos()
    
    // Inject equity alternatives
    injectEquityAlternatives()
    
    // Setup observer
    setupDiscoveryObserver()
  } else {
    // Show hidden videos
    document.querySelectorAll('[data-silenced-hidden]').forEach(el => {
      el.style.display = ''
      el.removeAttribute('data-silenced-hidden')
    })
    
    // Remove injected cards
    document.querySelectorAll('.silenced-equity-card').forEach(el => el.remove())
    
    if (discoveryObserver) {
      discoveryObserver.disconnect()
      discoveryObserver = null
    }
  }
  
  console.log('[Silenced] Discovery Mode:', discoveryMode ? 'ON' : 'OFF')
}

// Hide videos from monopoly channels (>100K subs)
function hideMonopolyVideos() {
  if (!discoveryCache?.monopolyChannelIds?.length) return
  
  const monopolyIds = new Set(discoveryCache.monopolyChannelIds)
  
  // Target sidebar recommendations
  const sidebarVideos = document.querySelectorAll('ytd-compact-video-renderer, ytd-watch-next-secondary-results-renderer ytd-item-section-renderer')
  
  let hiddenCount = 0
  sidebarVideos.forEach(video => {
    // Try to get channel link to check
    const channelLink = video.querySelector('a.ytd-channel-name, a[href^="/@"], a[href^="/channel/"]')
    if (channelLink) {
      const href = channelLink.getAttribute('href') || ''
      const channelId = href.match(/\/channel\/([^/]+)/)?.[1]
      
      if (channelId && monopolyIds.has(channelId)) {
        video.style.display = 'none'
        video.setAttribute('data-silenced-hidden', 'true')
        hiddenCount++
      }
    }
  })
  
  // Also hide first 3 sidebar videos by default (typically from large channels)
  const topSidebar = document.querySelectorAll('#secondary ytd-compact-video-renderer')
  topSidebar.forEach((video, i) => {
    if (i < 3 && !video.hasAttribute('data-silenced-hidden')) {
      video.style.display = 'none'
      video.setAttribute('data-silenced-hidden', 'true')
      hiddenCount++
    }
  })
  
  console.log(`[Silenced] Hidden ${hiddenCount} monopoly videos`)
}

// Inject equity alternative videos
function injectEquityAlternatives() {
  if (!discoveryCache?.discoveredVideos?.length) return
  
  // Remove existing injected cards
  document.querySelectorAll('.silenced-equity-card').forEach(el => el.remove())
  
  // Find sidebar
  const sidebar = document.querySelector('#secondary ytd-watch-next-secondary-results-renderer, #secondary-inner')
  if (!sidebar) return
  
  // Create container for equity videos
  const equityContainer = document.createElement('div')
  equityContainer.className = 'silenced-equity-container'
  equityContainer.style.cssText = 'margin: 12px 0; padding: 12px; background: #0a1a0a; border-radius: 8px; border: 1px solid #00E67633;'
  
  // Title
  const title = document.createElement('div')
  title.style.cssText = 'font-size: 14px; font-weight: 600; color: #00E676; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;'
  title.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#00E676">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
    </svg>
    <span>Equity Alternatives</span>
    <span style="font-size: 11px; color: #888; font-weight: 400;">(Under 100K subs)</span>
  `
  equityContainer.appendChild(title)
  
  // Add equity video cards
  const videos = discoveryCache.discoveredVideos.slice(0, 5)
  videos.forEach(video => {
    const card = document.createElement('div')
    card.className = 'silenced-equity-card'
    card.style.cssText = `
      background: #1a1a1a;
      border: 2px solid ${video.isRisingStar ? '#FFD700' : '#00E676'};
      border-radius: 8px;
      margin-bottom: 8px;
      overflow: hidden;
      transition: transform 0.2s ease;
    `
    
    card.innerHTML = `
      <a href="/watch?v=${video.videoId}" style="display: flex; gap: 8px; padding: 8px; text-decoration: none;">
        <img src="${video.thumbnail}" style="width: 120px; height: 68px; border-radius: 4px; object-fit: cover; flex-shrink: 0;" alt="${esc(video.title)}">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 12px; font-weight: 500; color: #f1f1f1; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 4px;">
            ${esc(video.title)}
          </div>
          <div style="font-size: 11px; color: #aaa; margin-bottom: 4px;">${esc(video.channelTitle)}</div>
          <div style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background: ${video.isRisingStar ? 'linear-gradient(90deg, #FFD700, #FFA000)' : 'linear-gradient(90deg, #00E676, #00C853)'}; border-radius: 4px; font-size: 10px; font-weight: 600; color: #000;">
            ${video.isRisingStar ? '⭐ Rising Star' : '🌱 Equity Creator'} · ${fmt(video.subscriberCount)} subs
          </div>
        </div>
      </a>
    `
    
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translateX(-4px)'
      card.style.boxShadow = `4px 0 12px ${video.isRisingStar ? 'rgba(255,215,0,0.3)' : 'rgba(0,230,118,0.3)'}`
    })
    
    card.addEventListener('mouseleave', () => {
      card.style.transform = ''
      card.style.boxShadow = ''
    })
    
    equityContainer.appendChild(card)
  })
  
  // Insert at top of sidebar
  sidebar.insertBefore(equityContainer, sidebar.firstChild)
}

// ===============================================
// MUTATION OBSERVER
// ===============================================
function setupDiscoveryObserver() {
  if (discoveryObserver) {
    discoveryObserver.disconnect()
  }
  
  discoveryObserver = new MutationObserver((mutations) => {
    if (!discoveryMode) return
    
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Re-hide any new monopoly videos
          if (node.matches?.('ytd-compact-video-renderer')) {
            setTimeout(() => hideMonopolyVideos(), 100)
          }
        }
      }
    }
  })
  
  discoveryObserver.observe(document.body, { childList: true, subtree: true })
}

// ===============================================
// FLOATING TOGGLE (for non-watch pages)
// ===============================================
function createFloatingToggle() {
  const existing = document.getElementById('silenced-discovery-toggle')
  if (existing) {
    existing.classList.toggle('active', discoveryMode)
    existing.querySelector('.toggle-status').textContent = discoveryMode ? 'ON' : 'OFF'
    return
  }
  
  const toggle = document.createElement('div')
  toggle.id = 'silenced-discovery-toggle'
  toggle.className = discoveryMode ? 'active' : ''
  toggle.setAttribute('role', 'switch')
  toggle.setAttribute('aria-checked', discoveryMode)
  toggle.setAttribute('aria-label', 'Toggle Discovery Mode to find underrepresented creators')
  toggle.setAttribute('tabindex', '0')
  
  toggle.innerHTML = `
    <div class="toggle-inner">
      <div class="toggle-icon">
        <svg viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      </div>
      <div class="toggle-label">
        <span class="toggle-title">Discovery Mode</span>
        <span class="toggle-status">${discoveryMode ? 'ON' : 'OFF'}</span>
      </div>
    </div>
  `
  
  toggle.addEventListener('click', () => window.silencedToggleDiscovery())
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      window.silencedToggleDiscovery()
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
    <div class="silenced-dashboard">
      <div class="dashboard-header">
        <div class="header-left">
          <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg></div>
          <span class="logo-text">Silenced</span>
        </div>
      </div>
      <div class="dashboard-body open">
        <div class="loading-state">
          <div class="spinner"></div>
          <div class="loading-text">Analyzing algorithmic bias...</div>
        </div>
      </div>
    </div>
  `
  
  // Fetch transcript
  const transcript = await getTranscript(videoId)
  
  // Get analysis from background script
  const response = await new Promise(resolve => {
    chrome.runtime.sendMessage({ 
      action: 'analyze', 
      videoId, 
      transcript: transcript?.substring(0, 8000) 
    }, resolve)
  })
  
  if (response?.success && response?.data) {
    injectDashboard(response.data)
    
    // If discovery mode is on, run discovery
    if (discoveryMode) {
      const query = extractCurrentQuery()
      await runDiscovery(query)
      hideMonopolyVideos()
      injectEquityAlternatives()
    }
  } else {
    // Show error
    container.innerHTML = `
      <div class="silenced-dashboard">
        <div class="dashboard-header">
          <div class="header-left">
            <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg></div>
            <span class="logo-text">Silenced</span>
          </div>
        </div>
        <div class="dashboard-body open">
          <div style="padding: 24px; text-align: center; color: #888;">
            <div style="margin-bottom: 12px;">Could not analyze this video</div>
            <button onclick="window.silencedRetry()" style="background: #00E676; color: #000; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer;">
              Try Again
            </button>
          </div>
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
  } catch {}
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
  if (request.action === 'toggleDiscoveryMode') {
    window.silencedToggleDiscovery()
    sendResponse({ success: true, discoveryMode })
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
    document.querySelectorAll('.silenced-equity-container').forEach(el => el.remove())
    
    if (isWatchPage()) {
      setTimeout(run, 1500)
    }
    
    // Update floating toggle
    createFloatingToggle()
    
    // Re-run discovery on navigation
    if (discoveryMode) {
      setTimeout(async () => {
        const query = extractCurrentQuery()
        await runDiscovery(query)
        if (isWatchPage()) {
          hideMonopolyVideos()
          injectEquityAlternatives()
        }
      }, 2000)
    }
  }
}).observe(document.body, { childList: true, subtree: true })

window.addEventListener('yt-navigate-finish', () => {
  currentVideoId = null
  panelInjected = false
  processedVideoCards.clear()
  
  if (isWatchPage()) setTimeout(run, 1500)
  createFloatingToggle()
  
  if (discoveryMode) {
    setTimeout(async () => {
      const query = extractCurrentQuery()
      await runDiscovery(query)
      if (isWatchPage()) {
        hideMonopolyVideos()
        injectEquityAlternatives()
      }
    }, 2000)
  }
})

// ===============================================
// INITIALIZATION
// ===============================================
async function init() {
  // Load persisted discovery state
  await loadDiscoveryState()
  
  // Create floating toggle
  setTimeout(createFloatingToggle, 2000)
  
  // Run analysis on watch pages
  if (isWatchPage()) {
    setTimeout(run, 2000)
  }
  
  // Auto-enable discovery if it was on
  if (discoveryMode) {
    setTimeout(async () => {
      const query = extractCurrentQuery()
      await runDiscovery(query)
      if (isWatchPage()) {
        hideMonopolyVideos()
        injectEquityAlternatives()
      }
    }, 3000)
  }
}

init()

console.log('[Silenced] YouTube Equity Filter v2.0 loaded')
