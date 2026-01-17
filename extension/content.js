// Silenced by the Algorithm - Content Script v2
// Auto-analyzes videos and injects into YouTube sidebar

// ============== CONFIG ==============
const SUPABASE_URL = 'https://ntspwmgvabdpifzzebrv.supabase.co/functions/v1/recommend'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50c3B3bWd2YWJkcGlmenplYnJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MzIyNjIsImV4cCI6MjA4NDIwODI2Mn0.26ndaCrexA3g29FHrJB1uBKJIUW6E5yn-nbvarsBp4o'

// ============== STATE ==============
let currentVideoId = null
let analysisData = null
let isAnalyzing = false
let panelInjected = false

// ============== UTILITIES ==============

function getVideoId() {
  const url = new URL(window.location.href)
  return url.searchParams.get('v')
}

function isWatchPage() {
  return window.location.pathname === '/watch'
}

// ============== API ==============

async function analyzeVideo(videoId) {
  if (isAnalyzing) return null
  isAnalyzing = true
  
  try {
    const response = await fetch(SUPABASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY
      },
      body: JSON.stringify({ video_id: videoId })
    })
    
    if (!response.ok) throw new Error('Analysis failed')
    return await response.json()
  } catch (error) {
    console.error('Analysis error:', error)
    return null
  } finally {
    isAnalyzing = false
  }
}

// ============== PANEL INJECTION ==============

function createPanel() {
  const panel = document.createElement('div')
  panel.id = 'silenced-panel'
  panel.innerHTML = `
    <div class="silenced-panel-header">
      <div class="silenced-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 16v-4M12 8h.01"/>
        </svg>
        <span>Bias Analysis</span>
      </div>
      <button class="silenced-minimize" id="silenced-minimize">−</button>
    </div>
    <div class="silenced-panel-content" id="silenced-content">
      <div class="silenced-loading" id="silenced-loading">
        <div class="silenced-spinner"></div>
        <span>Analyzing video...</span>
      </div>
      <div class="silenced-results" id="silenced-results" style="display: none;"></div>
      <div class="silenced-error" id="silenced-error" style="display: none;"></div>
    </div>
  `
  return panel
}

function injectPanel() {
  if (panelInjected) return
  
  // Find YouTube's secondary column (sidebar)
  const sidebar = document.querySelector('#secondary, ytd-watch-next-secondary-results-renderer, #related')
  if (!sidebar) {
    // Retry after a delay
    setTimeout(injectPanel, 1000)
    return
  }
  
  // Remove existing panel if any
  const existing = document.getElementById('silenced-panel')
  if (existing) existing.remove()
  
  // Create and inject panel
  const panel = createPanel()
  sidebar.insertBefore(panel, sidebar.firstChild)
  panelInjected = true
  
  // Add minimize functionality
  document.getElementById('silenced-minimize').addEventListener('click', () => {
    const content = document.getElementById('silenced-content')
    const btn = document.getElementById('silenced-minimize')
    if (content.style.display === 'none') {
      content.style.display = 'block'
      btn.textContent = '−'
    } else {
      content.style.display = 'none'
      btn.textContent = '+'
    }
  })
}

function showLoading() {
  const loading = document.getElementById('silenced-loading')
  const results = document.getElementById('silenced-results')
  const error = document.getElementById('silenced-error')
  
  if (loading) loading.style.display = 'flex'
  if (results) results.style.display = 'none'
  if (error) error.style.display = 'none'
}

function showError(message) {
  const loading = document.getElementById('silenced-loading')
  const results = document.getElementById('silenced-results')
  const error = document.getElementById('silenced-error')
  
  if (loading) loading.style.display = 'none'
  if (results) results.style.display = 'none'
  if (error) {
    error.style.display = 'block'
    error.innerHTML = `<p>${message}</p><button onclick="window.silencedRetry()">Retry</button>`
  }
}

function showResults(data) {
  const loading = document.getElementById('silenced-loading')
  const results = document.getElementById('silenced-results')
  const error = document.getElementById('silenced-error')
  
  if (loading) loading.style.display = 'none'
  if (error) error.style.display = 'none'
  if (results) {
    results.style.display = 'block'
    results.innerHTML = renderResults(data)
  }
}

// ============== RENDER ==============

function renderResults(data) {
  const { analysis, silenced_alternatives } = data
  
  // Determine bias indicator
  let biasClass = 'neutral'
  let biasLabel = 'Neutral'
  let biasIcon = '⚖️'
  
  if (analysis.bias_type === 'algorithm_favored') {
    biasClass = 'favored'
    biasLabel = 'Algorithm Favored'
    biasIcon = '📈'
  } else if (analysis.bias_type === 'quality_content') {
    biasClass = 'quality'
    biasLabel = 'Quality Content'
    biasIcon = '✨'
  }
  
  // Sustainability badge
  let sustainabilityBadge = ''
  if (analysis.is_sustainability) {
    const esgLabel = analysis.esg_category ? analysis.esg_category.toUpperCase() : 'ESG'
    const gwRisk = analysis.greenwashing_risk
    let gwBadge = ''
    if (gwRisk === 'high') {
      gwBadge = '<span class="gw-badge high">⚠️ High Greenwashing Risk</span>'
    } else if (gwRisk === 'medium') {
      gwBadge = '<span class="gw-badge medium">Greenwashing Risk</span>'
    }
    
    sustainabilityBadge = `
      <div class="sustainability-section">
        <div class="sustainability-header">
          <span class="sustainability-icon">🌱</span>
          <span>Sustainability Content Detected</span>
        </div>
        <div class="sustainability-details">
          <span class="esg-badge">${esgLabel}</span>
          <span class="sustainability-score">Score: ${Math.round(analysis.sustainability_score * 100)}%</span>
          ${gwBadge}
        </div>
        ${analysis.greenwashing_flags.length > 0 ? `
          <div class="gw-flags">
            <strong>Flags:</strong> ${analysis.greenwashing_flags.join(', ')}
          </div>
        ` : ''}
      </div>
    `
  }
  
  // Bias reasons
  const reasonsHtml = analysis.bias_reasons.map(r => `<li>${r}</li>`).join('')
  
  // Alternatives
  let alternativesHtml = ''
  if (silenced_alternatives && silenced_alternatives.length > 0) {
    alternativesHtml = `
      <div class="alternatives-section">
        <div class="alternatives-header">
          <span>🔇</span>
          <span>Silenced Alternatives</span>
        </div>
        <p class="alternatives-desc">Quality content on this topic that may be under-promoted:</p>
        <div class="alternatives-list">
          ${silenced_alternatives.map(alt => `
            <a href="https://youtube.com/watch?v=${alt.video_id}" class="alt-video">
              <img src="${alt.thumbnail}" class="alt-thumb" alt="">
              <div class="alt-info">
                <div class="alt-title">${escapeHtml(alt.title)}</div>
                <div class="alt-channel">${escapeHtml(alt.channel)}</div>
                <div class="alt-meta">
                  <span>${formatNumber(alt.view_count)} views</span>
                  <span class="alt-score">${Math.round(alt.silence_score * 100)}% silenced</span>
                </div>
                <div class="alt-why">${alt.why_silenced}</div>
              </div>
            </a>
          `).join('')}
        </div>
      </div>
    `
  }
  
  return `
    <div class="bias-card ${biasClass}">
      <div class="bias-header">
        <span class="bias-icon">${biasIcon}</span>
        <span class="bias-label">${biasLabel}</span>
        <span class="bias-score">${analysis.bias_score}%</span>
      </div>
      <div class="bias-reasons">
        <ul>${reasonsHtml}</ul>
      </div>
      <div class="video-meta-row">
        <span class="creator-type">${analysis.creator_type} creator</span>
        ${analysis.is_educational ? '<span class="edu-badge">📚 Educational</span>' : ''}
        ${analysis.sensational_score > 0.6 ? '<span class="sens-badge">🔥 Sensational</span>' : ''}
      </div>
    </div>
    
    ${sustainabilityBadge}
    ${alternativesHtml}
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

// ============== MAIN LOGIC ==============

async function handleVideoPage() {
  const videoId = getVideoId()
  if (!videoId || videoId === currentVideoId) return
  
  currentVideoId = videoId
  panelInjected = false
  
  // Wait for sidebar to load
  await waitForElement('#secondary, ytd-watch-next-secondary-results-renderer')
  
  // Inject panel
  injectPanel()
  showLoading()
  
  // Analyze video
  const data = await analyzeVideo(videoId)
  
  if (data && data.analysis) {
    analysisData = data
    showResults(data)
  } else {
    showError('Could not analyze this video')
  }
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    const element = document.querySelector(selector)
    if (element) return resolve(element)
    
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        observer.disconnect()
        resolve(el)
      }
    })
    
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeout)
  })
}

window.silencedRetry = function() {
  currentVideoId = null
  handleVideoPage()
}

// ============== NAVIGATION DETECTION ==============

let lastUrl = location.href

function checkNavigation() {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    currentVideoId = null
    panelInjected = false
    
    if (isWatchPage()) {
      setTimeout(handleVideoPage, 1000)
    } else {
      // Remove panel on non-watch pages
      const panel = document.getElementById('silenced-panel')
      if (panel) panel.remove()
    }
  }
}

// YouTube uses SPA navigation
const observer = new MutationObserver(checkNavigation)
observer.observe(document.body, { childList: true, subtree: true })

// Also check on popstate
window.addEventListener('popstate', checkNavigation)
window.addEventListener('yt-navigate-finish', checkNavigation)

// ============== INIT ==============

function init() {
  console.log('🔇 Silenced by the Algorithm loaded')
  
  if (isWatchPage()) {
    setTimeout(handleVideoPage, 1500)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
