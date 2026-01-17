// content.js - Silenced by the Algorithm Chrome Extension
// YouTube-native drawer panel design

// ============== CONFIGURATION ==============
// Replace with your actual Supabase details
const SUPABASE_FUNCTION_URL = 'YOUR_SUPABASE_FUNCTION_URL'
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'

// ============== STATE ==============
let drawerOpen = false
let currentQuery = ''
let cachedResults = null
let isLoading = false

// ============== PAGE DETECTION ==============

function getPageType() {
  const url = window.location.href
  if (url.includes('/watch')) return 'watch'
  if (url.includes('/results')) return 'search'
  if (url.includes('/@') || url.includes('/channel/')) return 'channel'
  return 'home'
}

function extractQuery() {
  const pageType = getPageType()
  
  if (pageType === 'search') {
    const params = new URLSearchParams(window.location.search)
    return params.get('search_query') || ''
  }
  
  if (pageType === 'watch') {
    const titleSelectors = [
      'h1.ytd-video-primary-info-renderer',
      'h1.ytd-watch-metadata',
      'h1.title',
      '#title h1',
      'h1.style-scope.ytd-watch-metadata'
    ]
    
    for (const selector of titleSelectors) {
      const titleEl = document.querySelector(selector)
      if (titleEl && titleEl.textContent) {
        return titleEl.textContent.trim()
      }
    }
    
    const metaTitle = document.querySelector('meta[name="title"]')
    if (metaTitle) {
      return metaTitle.getAttribute('content') || ''
    }
  }
  
  return ''
}

// ============== FLOATING BUTTON ==============

function createFloatingButton() {
  const existing = document.getElementById('silenced-algo-btn')
  if (existing) existing.remove()
  
  const btn = document.createElement('button')
  btn.id = 'silenced-algo-btn'
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <path d="M21 21l-4.35-4.35"/>
    </svg>
    <span>Analyze</span>
  `
  btn.addEventListener('click', toggleDrawer)
  document.body.appendChild(btn)
}

// ============== DRAWER PANEL ==============

function createDrawer() {
  // Remove existing
  const existingDrawer = document.getElementById('silenced-algo-drawer')
  const existingBackdrop = document.getElementById('silenced-algo-backdrop')
  if (existingDrawer) existingDrawer.remove()
  if (existingBackdrop) existingBackdrop.remove()
  
  // Create backdrop
  const backdrop = document.createElement('div')
  backdrop.id = 'silenced-algo-backdrop'
  backdrop.addEventListener('click', closeDrawer)
  document.body.appendChild(backdrop)
  
  // Create drawer
  const drawer = document.createElement('div')
  drawer.id = 'silenced-algo-drawer'
  drawer.innerHTML = `
    <div class="drawer-header">
      <div class="drawer-title">
        <svg class="drawer-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        Bias Analysis
      </div>
      <button class="drawer-close" id="drawer-close-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    
    <div class="drawer-query">
      <div class="query-label">Search query</div>
      <div class="query-input-row">
        <input type="text" class="query-input" id="query-input" placeholder="Enter search query...">
        <button class="query-btn" id="query-btn">Analyze</button>
      </div>
    </div>
    
    <div class="drawer-tabs">
      <button class="drawer-tab active" data-tab="silence">Silenced</button>
      <button class="drawer-tab" data-tab="noise">Noise</button>
      <button class="drawer-tab" data-tab="audit">Audit</button>
    </div>
    
    <div class="drawer-content">
      <div id="drawer-loading" class="drawer-loading" style="display: none;">
        ${renderSkeletons(5)}
      </div>
      
      <div id="drawer-results">
        <div id="panel-silence" class="drawer-panel active"></div>
        <div id="panel-noise" class="drawer-panel"></div>
        <div id="panel-audit" class="drawer-panel"></div>
      </div>
      
      <div id="drawer-error" class="drawer-error" style="display: none;"></div>
      
      <div id="drawer-empty" class="panel-empty">
        <div class="panel-empty-icon">🔍</div>
        <p>Enter a search query and click Analyze to check for algorithmic bias.</p>
      </div>
    </div>
    
    <div class="drawer-footer">
      Powered by YouTube Data API & Gemini AI
    </div>
  `
  
  document.body.appendChild(drawer)
  
  // Event listeners
  document.getElementById('drawer-close-btn').addEventListener('click', closeDrawer)
  
  document.getElementById('query-btn').addEventListener('click', () => {
    const input = document.getElementById('query-input')
    if (input.value.trim()) {
      fetchResults(input.value.trim())
    }
  })
  
  document.getElementById('query-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const input = document.getElementById('query-input')
      if (input.value.trim()) {
        fetchResults(input.value.trim())
      }
    }
  })
  
  // Tab switching
  drawer.querySelectorAll('.drawer-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab))
  })
  
  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen) {
      closeDrawer()
    }
  })
}

function renderSkeletons(count) {
  let html = ''
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-card">
        <div class="skeleton-thumb"></div>
        <div class="skeleton-info">
          <div class="skeleton-line medium"></div>
          <div class="skeleton-line short"></div>
          <div class="skeleton-line short"></div>
        </div>
      </div>
    `
  }
  return html
}

function switchTab(tabName) {
  document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'))
  document.querySelector(`.drawer-tab[data-tab="${tabName}"]`).classList.add('active')
  
  document.querySelectorAll('.drawer-panel').forEach(p => p.classList.remove('active'))
  document.getElementById(`panel-${tabName}`).classList.add('active')
}

function toggleDrawer() {
  if (drawerOpen) {
    closeDrawer()
  } else {
    openDrawer()
  }
}

function openDrawer() {
  let drawer = document.getElementById('silenced-algo-drawer')
  let backdrop = document.getElementById('silenced-algo-backdrop')
  
  if (!drawer) {
    createDrawer()
    drawer = document.getElementById('silenced-algo-drawer')
    backdrop = document.getElementById('silenced-algo-backdrop')
  }
  
  // Set current query from page
  const query = extractQuery()
  const input = document.getElementById('query-input')
  if (input && query && !input.value) {
    input.value = query
  }
  
  // Open drawer
  drawerOpen = true
  backdrop.classList.add('visible')
  
  // Small delay for animation
  requestAnimationFrame(() => {
    drawer.classList.add('open')
  })
}

function closeDrawer() {
  const drawer = document.getElementById('silenced-algo-drawer')
  const backdrop = document.getElementById('silenced-algo-backdrop')
  
  if (drawer) {
    drawer.classList.remove('open')
    drawerOpen = false
  }
  
  if (backdrop) {
    backdrop.classList.remove('visible')
  }
}

// ============== API CALLS ==============

async function fetchResults(query) {
  if (isLoading) return
  
  const loading = document.getElementById('drawer-loading')
  const results = document.getElementById('drawer-results')
  const error = document.getElementById('drawer-error')
  const empty = document.getElementById('drawer-empty')
  const btn = document.getElementById('query-btn')
  
  isLoading = true
  currentQuery = query
  
  loading.style.display = 'flex'
  results.style.display = 'none'
  error.style.display = 'none'
  empty.style.display = 'none'
  btn.disabled = true
  btn.textContent = 'Loading...'
  
  try {
    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        query: query,
        page_type: getPageType()
      })
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || 'Request failed')
    }
    
    const data = await response.json()
    cachedResults = data
    renderResults(data)
    
  } catch (err) {
    console.error('Analysis error:', err)
    showError(err.message || 'Failed to analyze. Please try again.')
  } finally {
    isLoading = false
    loading.style.display = 'none'
    btn.disabled = false
    btn.textContent = 'Analyze'
  }
}

function showError(message) {
  const error = document.getElementById('drawer-error')
  const results = document.getElementById('drawer-results')
  
  results.style.display = 'none'
  error.style.display = 'block'
  error.innerHTML = `
    <div class="drawer-error-icon">⚠️</div>
    <h3 class="drawer-error-title">Analysis Failed</h3>
    <p class="drawer-error-msg">${escapeHtml(message)}</p>
    <button class="drawer-error-btn" onclick="window.silencedRetry()">Try Again</button>
  `
}

window.silencedRetry = function() {
  if (currentQuery) {
    fetchResults(currentQuery)
  }
}

// ============== RENDER RESULTS ==============

function renderResults(data) {
  const results = document.getElementById('drawer-results')
  const empty = document.getElementById('drawer-empty')
  
  results.style.display = 'block'
  empty.style.display = 'none'
  
  // Silence panel
  const silencePanel = document.getElementById('panel-silence')
  if (data.silence_lens && data.silence_lens.length > 0) {
    silencePanel.innerHTML = `
      <p class="panel-desc">Quality content that may be under-promoted by the algorithm</p>
      <div class="video-list">
        ${data.silence_lens.map(v => renderVideoCard(v, 'silence')).join('')}
      </div>
    `
  } else {
    silencePanel.innerHTML = `
      <div class="panel-empty">
        <div class="panel-empty-icon">📭</div>
        <p>No silenced content found.</p>
      </div>
    `
  }
  
  // Noise panel
  const noisePanel = document.getElementById('panel-noise')
  if (data.noise_lens && data.noise_lens.length > 0) {
    noisePanel.innerHTML = `
      <p class="panel-desc">Content that may be over-promoted relative to educational value</p>
      <div class="video-list">
        ${data.noise_lens.map(v => renderVideoCard(v, 'noise')).join('')}
      </div>
    `
  } else {
    noisePanel.innerHTML = `
      <div class="panel-empty">
        <div class="panel-empty-icon">📭</div>
        <p>No noise content identified.</p>
      </div>
    `
  }
  
  // Audit panel
  const auditPanel = document.getElementById('panel-audit')
  auditPanel.innerHTML = renderAuditPanel(data.audit)
}

function renderVideoCard(video, type) {
  const score = type === 'silence' ? video.silence_score : video.noise_score
  const scoreLabel = type === 'silence' ? 'Silenced' : 'Noise'
  
  return `
    <a href="https://youtube.com/watch?v=${video.video_id}" target="_blank" class="video-card">
      <div class="video-thumb">
        <img src="${video.thumbnail}" alt="" loading="lazy">
        <div class="video-thumb-overlay">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
      <div class="video-info">
        <h4 class="video-title">${escapeHtml(video.title)}</h4>
        <div class="video-channel">${escapeHtml(video.channel)}</div>
        <div class="video-meta">
          <span>${formatNumber(video.view_count)} views</span>
          <span class="video-meta-dot"></span>
          <span>${formatNumber(video.subscriber_count)} subs</span>
        </div>
        <div class="video-chips">
          <span class="video-score ${type}">${scoreLabel}: ${Math.round(score * 100)}%</span>
          ${video.tags.slice(0, 2).map(t => `<span class="video-chip">${t}</span>`).join('')}
        </div>
        <div class="video-why">${escapeHtml(video.why)}</div>
      </div>
    </a>
  `
}

function renderAuditPanel(audit) {
  if (!audit) {
    return `
      <div class="panel-empty">
        <div class="panel-empty-icon">📊</div>
        <p>No audit data available.</p>
      </div>
    `
  }
  
  return `
    <div class="audit-section">
      <h3 class="audit-section-title">Summary</h3>
      <ul class="audit-summary">
        ${audit.summary.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>
    </div>
    
    <div class="audit-section">
      <h3 class="audit-section-title">Metrics</h3>
      <div class="audit-metrics">
        ${renderMetric('Large Creator Dominance', audit.metrics.creator_concentration, 'Lower is better', 'negative')}
        ${renderMetric('Small Creator Suppression', audit.metrics.small_creator_suppression, 'Lower is better', 'negative')}
        ${renderMetric('Educational Ratio', audit.metrics.educational_ratio, 'Higher is better', 'positive')}
        ${renderMetric('Sensational Ratio', audit.metrics.sensational_ratio, 'Lower is better', 'negative')}
        ${renderMetric('Topic Diversity', audit.metrics.topic_diversity, 'Higher is better', 'positive')}
      </div>
    </div>
    
    <div class="audit-section">
      <h3 class="audit-section-title">Recommendations</h3>
      <ul class="audit-recommendations">
        ${audit.recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>
  `
}

function renderMetric(label, value, hint, type) {
  const percentage = Math.round((value || 0) * 100)
  const isGood = type === 'positive' ? percentage > 50 : percentage < 50
  const colorClass = isGood ? 'good' : 'bad'
  
  return `
    <div class="audit-metric">
      <div class="audit-metric-header">
        <span class="audit-metric-label">${label}</span>
        <span class="audit-metric-value ${colorClass}">${percentage}%</span>
      </div>
      <div class="audit-metric-bar">
        <div class="audit-metric-fill ${colorClass}" style="width: ${percentage}%"></div>
      </div>
      <div class="audit-metric-hint">${hint}</div>
    </div>
  `
}

function formatNumber(num) {
  if (!num) return '0'
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

function escapeHtml(text) {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ============== NAVIGATION DETECTION ==============

let lastUrl = location.href
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    currentQuery = ''
    cachedResults = null
    setTimeout(createFloatingButton, 1000)
  }
})

observer.observe(document.body, { subtree: true, childList: true })

// ============== MESSAGE LISTENER ==============

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggle_overlay') {
    toggleDrawer()
  }
  return true
})

// ============== INITIALIZATION ==============

function init() {
  console.log('Bias Analysis extension loaded')
  createFloatingButton()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000))
} else {
  setTimeout(init, 1000)
}
