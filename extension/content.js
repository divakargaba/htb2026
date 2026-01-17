// Silenced by the Algorithm - v5 YouTube Native UI
// Clean, professional design that blends with YouTube

const SUPABASE_URL = 'https://ntspwmgvabdpifzzebrv.supabase.co/functions/v1/recommend'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50c3B3bWd2YWJkcGlmenplYnJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MzIyNjIsImV4cCI6MjA4NDIwODI2Mn0.26ndaCrexA3g29FHrJB1uBKJIUW6E5yn-nbvarsBp4o'

// State
let currentVideoId = null
let analysisData = null
let transcriptData = null
let isAnalyzing = false
let panelInjected = false

// UI State
let uiState = {
  detailedExpanded: false,
  greenwashingExpanded: false,
  alternativesExpanded: false,
  transcriptExpanded: false,
  expandedSubsections: new Set()
}

// Utilities
function log(...args) { console.log('[BiasAnalysis]', ...args) }
function getVideoId() { return new URL(window.location.href).searchParams.get('v') }
function isWatchPage() { return window.location.pathname === '/watch' }

// ============== TRANSCRIPT FETCHING ==============
async function fetchTranscript(videoId) {
  try {
    // Method 1: Try the timedtext API directly
    const langs = ['en', 'en-US', 'en-GB', '']
    
    for (const lang of langs) {
      try {
        const url = lang 
          ? `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`
          : `https://www.youtube.com/api/timedtext?v=${videoId}&fmt=json3`
        
        const response = await fetch(url)
        if (response.ok) {
          const data = await response.json()
          if (data.events && data.events.length > 0) {
            // Extract text from segments
            const text = data.events
              .filter(e => e.segs)
              .map(e => e.segs.map(s => s.utf8 || '').join(''))
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
            
            if (text.length > 100) {
              log('Transcript fetched successfully:', text.length, 'chars')
              return { text, language: lang || 'auto' }
            }
          }
        }
      } catch (e) {
        // Try next language
      }
    }
    
    // Method 2: Try to extract from page data
    const ytInitialPlayerResponse = window.ytInitialPlayerResponse
    if (ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      const tracks = ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks
      const englishTrack = tracks.find(t => t.languageCode?.startsWith('en')) || tracks[0]
      
      if (englishTrack?.baseUrl) {
        const response = await fetch(englishTrack.baseUrl + '&fmt=json3')
        if (response.ok) {
          const data = await response.json()
          if (data.events) {
            const text = data.events
              .filter(e => e.segs)
              .map(e => e.segs.map(s => s.utf8 || '').join(''))
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
            
            if (text.length > 100) {
              log('Transcript extracted from page:', text.length, 'chars')
              return { text, language: englishTrack.languageCode }
            }
          }
        }
      }
    }
    
    log('No transcript available')
    return null
  } catch (error) {
    log('Transcript fetch error:', error)
    return null
  }
}

// ============== API ==============
async function analyzeVideo(videoId, transcript = null) {
  if (isAnalyzing) return null
  isAnalyzing = true
  
  try {
    const body = { video_id: videoId }
    if (transcript) {
      // Send first 8000 chars of transcript to stay within limits
      body.transcript = transcript.text.substring(0, 8000)
      body.transcript_language = transcript.language
    }
    
    // #region agent log
    console.log('[DEBUG] API request starting', {videoId, url:SUPABASE_URL, body:body});
    // #endregion
    
    const response = await fetch(SUPABASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY
      },
      body: JSON.stringify(body)
    })
    
    // #region agent log
    const responseText = await response.clone().text();
    console.log('[DEBUG] API response received', {status:response.status, ok:response.ok, responseBody:responseText});
    // #endregion
    
    if (!response.ok) {
      console.log('[DEBUG] API returned non-ok status, body:', responseText);
      throw new Error('Analysis failed: ' + response.status + ' - ' + responseText.substring(0, 200))
    }
    return JSON.parse(responseText)
  } catch (error) {
    // #region agent log
    console.log('[DEBUG] API error caught', {errorMsg:error.message, errorName:error.name});
    // #endregion
    console.error('Analysis error:', error)
    return null
  } finally {
    isAnalyzing = false
  }
}

// ============== PANEL CREATION ==============
function createPanel() {
  const panel = document.createElement('div')
  panel.id = 'silenced-panel'
  panel.innerHTML = `
    <div class="sp-header">
      <div class="sp-header-title">Bias Analysis</div>
      <button class="sp-minimize-btn" id="sp-minimize" title="Minimize">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 13H5v-2h14v2z"/>
        </svg>
      </button>
    </div>
    <div class="sp-loading" id="sp-loading">
      <div class="sp-loading-content">
        <div class="sp-spinner"></div>
        <div class="sp-loading-title">Analyzing video content</div>
        <div class="sp-loading-steps">
          <div class="sp-step active"><span class="sp-step-dot"></span>Detecting content type</div>
          <div class="sp-step"><span class="sp-step-dot"></span>Calculating bias metrics</div>
          <div class="sp-step"><span class="sp-step-dot"></span>Finding alternatives</div>
        </div>
      </div>
    </div>
    <div class="sp-content" id="sp-content" style="display: none;"></div>
    <div class="sp-error" id="sp-error" style="display: none;"></div>
  `
  return panel
}

function findSidebar() {
  const selectors = ['#secondary #secondary-inner', '#secondary-inner', '#secondary']
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  return null
}

function injectPanel() {
  if (panelInjected) return true
  const sidebar = findSidebar()
  if (!sidebar) { setTimeout(injectPanel, 1000); return false }
  
  const existing = document.getElementById('silenced-panel')
  if (existing) existing.remove()
  
  sidebar.insertBefore(createPanel(), sidebar.firstChild)
  panelInjected = true
  
  // Add minimize handler
  document.getElementById('sp-minimize')?.addEventListener('click', () => {
    const content = document.getElementById('sp-content')
    const loading = document.getElementById('sp-loading')
    const error = document.getElementById('sp-error')
    const btn = document.getElementById('sp-minimize')
    
    const isHidden = content?.style.display === 'none' && loading?.style.display === 'none'
    
    if (isHidden) {
      if (analysisData) {
        content.style.display = 'block'
      } else if (isAnalyzing) {
        loading.style.display = 'flex'
      }
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>'
    } else {
      content.style.display = 'none'
      loading.style.display = 'none'
      error.style.display = 'none'
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>'
    }
  })
  
  return true
}

function showLoading() {
  const loading = document.getElementById('sp-loading')
  const content = document.getElementById('sp-content')
  const error = document.getElementById('sp-error')
  if (loading) loading.style.display = 'flex'
  if (content) content.style.display = 'none'
  if (error) error.style.display = 'none'
}

function updateLoadingStep(step) {
  const steps = document.querySelectorAll('.sp-step')
  steps.forEach((el, i) => {
    if (i < step) el.classList.add('active')
    else if (i === step) el.classList.add('active')
    else el.classList.remove('active')
  })
}

function showError(message) {
  const loading = document.getElementById('sp-loading')
  const content = document.getElementById('sp-content')
  const error = document.getElementById('sp-error')
  if (loading) loading.style.display = 'none'
  if (content) content.style.display = 'none'
  if (error) {
    error.style.display = 'block'
    error.innerHTML = `
      <div class="sp-error-content">
        <div class="sp-error-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
        </div>
        <div class="sp-error-title">Analysis Unavailable</div>
        <p>${message}</p>
        <button class="sp-btn sp-btn-primary" onclick="window.silencedRetry()">Try Again</button>
      </div>
    `
  }
}

function showResults(data) {
  const loading = document.getElementById('sp-loading')
  const content = document.getElementById('sp-content')
  const error = document.getElementById('sp-error')
  
  if (loading) loading.style.display = 'none'
  if (error) error.style.display = 'none'
  if (content) {
    content.style.display = 'block'
    content.innerHTML = renderSummaryView(data)
    attachEventListeners()
  }
}

// ============== RENDER FUNCTIONS ==============

function getScoreClass(score) {
  if (score <= 35) return 'low'
  if (score <= 70) return 'moderate'
  return 'high'
}

function getVerdictText(score) {
  if (score <= 35) return 'Minimal Bias'
  if (score <= 70) return 'Moderate Bias'
  return 'High Bias'
}

function getVerdictDesc(score) {
  if (score <= 35) return 'This video shows minimal signs of algorithmic promotion.'
  if (score <= 70) return 'This video has some algorithmic advantages over similar content.'
  return 'This video shows significant signs of algorithmic promotion.'
}

function renderSummaryView(data) {
  const { bias_analysis, content_analysis, sustainability, silenced_alternatives, transcript_analysis } = data
  const isSustainability = sustainability?.is_sustainability
  const score = bias_analysis.total_score
  const scoreClass = getScoreClass(score)
  
  // Get top contributing factor
  const topFactor = bias_analysis.breakdown.reduce((a, b) => 
    (b.points / b.maxPoints) > (a.points / a.maxPoints) ? b : a
  )
  
  // Greenwashing metrics
  const gwScore = sustainability?.greenwashing?.score ? Math.round(sustainability.greenwashing.score * 100) : 0
  const gwRisk = sustainability?.greenwashing?.risk_level || 'low'
  
  return `
    <!-- HEADER WITH MODE -->
    <div class="sp-header">
      <div class="sp-header-title">
        Bias Analysis
        ${isSustainability ? '<span class="sp-header-badge sustainability">Sustainability</span>' : ''}
      </div>
    </div>
    
    <!-- SCORE SECTION -->
    <div class="sp-score-section">
      <div class="sp-score-label">Algorithmic Bias Score</div>
      <div class="sp-score-display">
        <span class="sp-score-value ${scoreClass}">${score}</span>
        <span class="sp-score-max">/100</span>
      </div>
      <div class="sp-score-bar">
        <div class="sp-score-fill ${scoreClass}" style="width: ${score}%"></div>
      </div>
      <div class="sp-verdict ${scoreClass}">
        <span class="sp-verdict-dot"></span>
        ${getVerdictText(score)}
      </div>
      <div class="sp-score-desc">${getVerdictDesc(score)}</div>
    </div>
    
    ${isSustainability ? `
      <!-- DUAL SCORES (Sustainability Mode) -->
      <div class="sp-dual-scores">
        <div class="sp-dual-score">
          <div class="sp-dual-score-label">Bias Score</div>
          <div class="sp-dual-score-value ${scoreClass}">
            <span class="sp-verdict-dot"></span>
            ${score}/100
          </div>
        </div>
        <div class="sp-dual-score">
          <div class="sp-dual-score-label">Greenwashing Risk</div>
          <div class="sp-dual-score-value ${gwRisk}">
            <span class="sp-verdict-dot"></span>
            ${gwScore}/100
          </div>
        </div>
      </div>
      
      ${sustainability.greenwashing?.flags?.length > 0 ? `
        <div class="sp-issues">
          <div class="sp-issues-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
            </svg>
            Key Issues Detected
          </div>
          <ul class="sp-issues-list">
            ${sustainability.greenwashing.flags.slice(0, 2).map(f => `<li>${escapeHtml(f)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    ` : `
      <!-- KEY INSIGHT (General Mode) -->
      <div class="sp-insight-box">
        <div class="sp-insight-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
          </svg>
          Primary Bias Factor
        </div>
        <div class="sp-insight-content">
          <div class="sp-insight-factor">${topFactor.factor}</div>
          <div class="sp-insight-explanation">${topFactor.explanation}</div>
        </div>
      </div>
    `}
    
    <!-- METRICS GRID -->
    <div class="sp-metrics-grid">
      ${bias_analysis.breakdown.slice(0, 4).map(item => `
        <div class="sp-metric-card">
          <div class="sp-metric-label">${item.factor.replace(' Advantage', '').replace(' Optimization', '')}</div>
          <div class="sp-metric-value">${item.points > item.maxPoints/2 ? 'High' : item.points > item.maxPoints/4 ? 'Moderate' : 'Low'}</div>
          <div class="sp-metric-bar">
            <div class="sp-metric-fill bias" style="width: ${(item.points/item.maxPoints)*100}%"></div>
          </div>
          <div class="sp-metric-points">+${item.points}/${item.maxPoints} pts</div>
        </div>
      `).join('')}
    </div>
    
    <!-- ALTERNATIVES PREVIEW -->
    ${silenced_alternatives?.length > 0 ? `
      <div class="sp-alternatives-preview">
        <div class="sp-alternatives-header">
          <div class="sp-alternatives-title">Underrepresented Alternatives</div>
        </div>
        <div class="sp-alternatives-row">
          ${silenced_alternatives.slice(0, 3).map(alt => `
            <a href="https://youtube.com/watch?v=${alt.video_id}" class="sp-alt-thumb" title="${escapeHtml(alt.title)}">
              <img src="${alt.thumbnail}" alt="" loading="lazy">
              <div class="sp-alt-overlay">
                <span class="sp-alt-views">${formatNumber(alt.view_count)}</span>
              </div>
            </a>
          `).join('')}
        </div>
        <button class="sp-view-all" data-action="expand-alternatives">
          View all ${silenced_alternatives.length} alternatives
        </button>
      </div>
    ` : ''}
    
    <!-- EXPAND BUTTONS -->
    <div class="sp-expand-buttons">
      ${isSustainability ? `
        <button class="sp-btn sp-btn-success" data-action="toggle-greenwashing">
          <span class="sp-btn-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 8l-1.41 1.41L17.17 11H9v2h8.17l-1.58 1.58L17 16l4-4-4-4zM5 5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h7v-2H5V5z"/>
            </svg>
          </span>
          Greenwashing Report
          <span class="sp-btn-arrow">+</span>
        </button>
      ` : ''}
      <button class="sp-btn sp-btn-secondary" data-action="toggle-detailed">
        <span class="sp-btn-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
          </svg>
        </span>
        Detailed Analysis
        <span class="sp-btn-arrow">+</span>
      </button>
      ${transcript_analysis ? `
        <button class="sp-btn sp-btn-secondary" data-action="toggle-transcript">
          <span class="sp-btn-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
            </svg>
          </span>
          Transcript Analysis
          <span class="sp-btn-arrow">+</span>
        </button>
      ` : ''}
    </div>
    
    <!-- EXPANDABLE: GREENWASHING REPORT -->
    ${isSustainability ? `
      <div class="sp-expandable" id="sp-greenwashing" style="display: none;">
        ${renderGreenwashingReport(sustainability)}
      </div>
    ` : ''}
    
    <!-- EXPANDABLE: DETAILED ANALYSIS -->
    <div class="sp-expandable" id="sp-detailed" style="display: none;">
      ${renderDetailedAnalysis(data)}
    </div>
    
    <!-- EXPANDABLE: TRANSCRIPT ANALYSIS -->
    ${transcript_analysis ? `
      <div class="sp-expandable" id="sp-transcript" style="display: none;">
        ${renderTranscriptAnalysis(transcript_analysis)}
      </div>
    ` : ''}
    
    <!-- EXPANDABLE: FULL ALTERNATIVES -->
    <div class="sp-expandable" id="sp-alternatives-full" style="display: none;">
      ${renderFullAlternatives(silenced_alternatives, content_analysis)}
    </div>
    
    <!-- FOOTER -->
    <div class="sp-footer">
      <span>AI-Powered Analysis</span>
      <a href="#" onclick="window.silencedRetry(); return false;">Refresh</a>
    </div>
  `
}

function renderGreenwashingReport(sustainability) {
  const gw = sustainability?.greenwashing
  if (!gw) return '<p class="sp-empty">Greenwashing analysis not available for this content.</p>'
  
  const cred = sustainability?.credibility
  const gwScore = Math.round((gw.score || 0) * 100)
  const riskLevel = gw.risk_level || 'low'
  
  return `
    <div class="sp-section-header">
      <span class="sp-section-title">Greenwashing Analysis</span>
      <button class="sp-collapse-btn" data-action="collapse-greenwashing">Collapse</button>
    </div>
    
    <div class="sp-gw-overview ${riskLevel}">
      <div class="sp-gw-ring" style="--score: ${gwScore}">
        <span>${gwScore}</span>
      </div>
      <div class="sp-gw-info">
        <div class="sp-gw-risk">Risk Level: <strong>${riskLevel.toUpperCase()}</strong></div>
        <div class="sp-gw-explanation">${escapeHtml(gw?.explanation || 'No significant greenwashing indicators detected.')}</div>
      </div>
    </div>
    
    <!-- Red Flags -->
    <div class="sp-subsection">
      <button class="sp-subsection-header" data-subsection="gw-flags">
        <span>Red Flags Detected</span>
        ${gw?.flags?.length > 0 ? `<span class="sp-subsection-count">${gw.flags.length}</span>` : ''}
        <span class="sp-subsection-arrow">›</span>
      </button>
      <div class="sp-subsection-content" id="gw-flags">
        ${gw?.flags?.length > 0 ? `
          <ul class="sp-list">
            ${gw.flags.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
          </ul>
        ` : '<p class="sp-empty">No red flags detected</p>'}
      </div>
    </div>
    
    <!-- Credibility -->
    <div class="sp-subsection">
      <button class="sp-subsection-header" data-subsection="gw-cred">
        <span>Source Credibility</span>
        <span class="sp-subsection-score">${Math.round((cred?.score || 0.5) * 100)}%</span>
        <span class="sp-subsection-arrow">›</span>
      </button>
      <div class="sp-subsection-content" id="gw-cred">
        ${cred?.signals?.length > 0 ? `
          <div class="sp-cred-section positive">
            <strong>Positive Signals</strong>
            <ul>${cred.signals.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>
        ` : ''}
        ${cred?.concerns?.length > 0 ? `
          <div class="sp-cred-section negative">
            <strong>Concerns</strong>
            <ul>${cred.concerns.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
          </div>
        ` : ''}
        ${!cred?.signals?.length && !cred?.concerns?.length ? '<p class="sp-empty">No credibility data available</p>' : ''}
      </div>
    </div>
    
    <!-- Claims to Verify -->
    ${sustainability.fact_check_needed?.length > 0 ? `
      <div class="sp-subsection">
        <button class="sp-subsection-header" data-subsection="gw-claims">
          <span>Claims Requiring Verification</span>
          <span class="sp-subsection-count">${sustainability.fact_check_needed.length}</span>
          <span class="sp-subsection-arrow">›</span>
        </button>
        <div class="sp-subsection-content" id="gw-claims">
          <ul class="sp-list">
            ${sustainability.fact_check_needed.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
          </ul>
        </div>
      </div>
    ` : ''}
  `
}

function renderDetailedAnalysis(data) {
  const { bias_analysis, content_analysis } = data
  
  return `
    <div class="sp-section-header">
      <span class="sp-section-title">Detailed Bias Analysis</span>
      <button class="sp-collapse-btn" data-action="collapse-detailed">Collapse</button>
    </div>
    
    <!-- Bias Breakdown -->
    <div class="sp-subsection">
      <button class="sp-subsection-header" data-subsection="bias-breakdown">
        <span>Bias Score Breakdown</span>
        <span class="sp-subsection-score">${bias_analysis.total_score}/100</span>
        <span class="sp-subsection-arrow">›</span>
      </button>
      <div class="sp-subsection-content" id="bias-breakdown">
        ${bias_analysis.breakdown.map(item => `
          <div class="sp-breakdown-item">
            <div class="sp-breakdown-header">
              <span class="sp-breakdown-name">${item.factor}</span>
              <span class="sp-breakdown-points ${item.points > item.maxPoints/2 ? 'high' : 'low'}">
                +${item.points}/${item.maxPoints}
              </span>
            </div>
            <div class="sp-breakdown-bar">
              <div class="sp-breakdown-fill" style="width: ${(item.points/item.maxPoints)*100}%"></div>
            </div>
            <div class="sp-breakdown-explanation">${item.explanation}</div>
            <div class="sp-breakdown-insight">${item.insight}</div>
          </div>
        `).join('')}
      </div>
    </div>
    
    <!-- Content Quality -->
    <div class="sp-subsection">
      <button class="sp-subsection-header" data-subsection="content-quality">
        <span>Content Quality Analysis</span>
        <span class="sp-subsection-arrow">›</span>
      </button>
      <div class="sp-subsection-content" id="content-quality">
        <div class="sp-content-metric">
          <span class="sp-content-metric-label">Educational Value</span>
          <div class="sp-content-metric-bar">
            <div class="sp-content-metric-fill green" style="width: ${content_analysis.educational_value || 0}%"></div>
          </div>
          <span class="sp-content-metric-value">${content_analysis.educational_value || 0}%</span>
        </div>
        <div class="sp-content-metric">
          <span class="sp-content-metric-label">Content Depth</span>
          <div class="sp-content-metric-bar">
            <div class="sp-content-metric-fill blue" style="width: ${content_analysis.depth_score || 0}%"></div>
          </div>
          <span class="sp-content-metric-value">${content_analysis.depth_score || 0}%</span>
        </div>
        <div class="sp-content-metric">
          <span class="sp-content-metric-label">Sensationalism</span>
          <div class="sp-content-metric-bar">
            <div class="sp-content-metric-fill orange" style="width: ${content_analysis.sensationalism || 0}%"></div>
          </div>
          <span class="sp-content-metric-value">${content_analysis.sensationalism || 0}%</span>
        </div>
        
        ${content_analysis.clickbait_indicators?.length > 0 ? `
          <div class="sp-warning-box">
            <strong>Clickbait Indicators Detected</strong>
            <div class="sp-tags">
              ${content_analysis.clickbait_indicators.map(i => `<span class="sp-tag warning">${escapeHtml(i)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        
        <div class="sp-content-tags">
          <span class="sp-tag topic">${escapeHtml(content_analysis.topic || 'Unknown')}</span>
          <span class="sp-tag type">${escapeHtml(content_analysis.content_type || 'Unknown')}</span>
        </div>
      </div>
    </div>
  `
}

function renderTranscriptAnalysis(analysis) {
  if (!analysis) return '<p class="sp-empty">No transcript analysis available</p>'
  
  return `
    <div class="sp-section-header">
      <span class="sp-section-title">Transcript Analysis</span>
      <button class="sp-collapse-btn" data-action="collapse-transcript">Collapse</button>
    </div>
    
    <div class="sp-subsection-content" style="display: block;">
      <div class="sp-transcript-metrics">
        <div class="sp-transcript-stat">
          <div class="sp-transcript-stat-value">${analysis.claims_count || 0}</div>
          <div class="sp-transcript-stat-label">Claims Found</div>
        </div>
        <div class="sp-transcript-stat">
          <div class="sp-transcript-stat-value">${analysis.sources_cited || 0}</div>
          <div class="sp-transcript-stat-label">Sources Cited</div>
        </div>
        <div class="sp-transcript-stat">
          <div class="sp-transcript-stat-value">${analysis.specificity_score || 0}%</div>
          <div class="sp-transcript-stat-label">Specificity</div>
        </div>
      </div>
      
      ${analysis.key_claims?.length > 0 ? `
        <div class="sp-claims-section">
          <div class="sp-claims-title">Key Claims Identified</div>
          ${analysis.key_claims.slice(0, 5).map(claim => `
            <div class="sp-claim-item">${escapeHtml(claim)}</div>
          `).join('')}
        </div>
      ` : ''}
      
      ${analysis.topic_coverage ? `
        <div class="sp-content-metric" style="margin-top: 16px;">
          <span class="sp-content-metric-label">Topic Coverage</span>
          <div class="sp-content-metric-bar">
            <div class="sp-content-metric-fill blue" style="width: ${analysis.topic_coverage}%"></div>
          </div>
          <span class="sp-content-metric-value">${analysis.topic_coverage}%</span>
        </div>
      ` : ''}
    </div>
  `
}

function renderFullAlternatives(alternatives, content_analysis) {
  if (!alternatives?.length) return '<p class="sp-empty">No alternatives found</p>'
  
  return `
    <div class="sp-section-header">
      <span class="sp-section-title">Underrepresented Alternatives</span>
      <button class="sp-collapse-btn" data-action="collapse-alternatives">Collapse</button>
    </div>
    
    <p class="sp-section-desc">Videos covering "${escapeHtml(content_analysis?.topic || 'this topic')}" that may be algorithmically underrepresented:</p>
    
    <div class="sp-alternatives-list">
      ${alternatives.map((alt) => `
        <div class="sp-alt-card">
          <a href="https://youtube.com/watch?v=${alt.video_id}" class="sp-alt-card-thumb">
            <img src="${alt.thumbnail}" alt="" loading="lazy">
          </a>
          <div class="sp-alt-card-info">
            <a href="https://youtube.com/watch?v=${alt.video_id}" class="sp-alt-card-title">
              ${escapeHtml(alt.title)}
            </a>
            <div class="sp-alt-card-channel">${escapeHtml(alt.channel)}</div>
            <div class="sp-alt-card-stats">
              ${formatNumber(alt.view_count)} views · ${formatNumber(alt.subscriber_count)} subscribers
            </div>
            <div class="sp-alt-card-suppression">
              <div class="sp-suppression-bar">
                <div class="sp-suppression-fill" style="width: ${alt.silence_score}%"></div>
              </div>
              <span class="sp-suppression-label">${alt.silence_score}% underrepresented</span>
            </div>
            ${alt.reasons?.length > 0 ? `
              <div class="sp-alt-card-reasons">
                ${alt.reasons.slice(0, 2).map(r => `<span class="sp-reason-tag">${escapeHtml(r)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `
}

// ============== EVENT HANDLERS ==============

function attachEventListeners() {
  // Expand buttons
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleAction)
  })
  
  // Subsection toggles
  document.querySelectorAll('[data-subsection]').forEach(btn => {
    btn.addEventListener('click', () => toggleSubsection(btn.dataset.subsection))
  })
}

function handleAction(e) {
  const action = e.currentTarget.dataset.action
  
  switch(action) {
    case 'toggle-detailed':
      toggleSection('sp-detailed', 'detailedExpanded')
      break
    case 'toggle-greenwashing':
      toggleSection('sp-greenwashing', 'greenwashingExpanded')
      break
    case 'toggle-transcript':
      toggleSection('sp-transcript', 'transcriptExpanded')
      break
    case 'expand-alternatives':
    case 'collapse-alternatives':
      toggleSection('sp-alternatives-full', 'alternativesExpanded')
      break
    case 'collapse-detailed':
      toggleSection('sp-detailed', 'detailedExpanded')
      break
    case 'collapse-greenwashing':
      toggleSection('sp-greenwashing', 'greenwashingExpanded')
      break
    case 'collapse-transcript':
      toggleSection('sp-transcript', 'transcriptExpanded')
      break
  }
}

function toggleSection(sectionId, stateKey) {
  const section = document.getElementById(sectionId)
  if (!section) return
  
  uiState[stateKey] = !uiState[stateKey]
  
  if (uiState[stateKey]) {
    section.style.display = 'block'
    section.classList.add('expanded')
    section.style.maxHeight = '0'
    section.style.opacity = '0'
    requestAnimationFrame(() => {
      section.style.maxHeight = section.scrollHeight + 'px'
      section.style.opacity = '1'
    })
  } else {
    section.style.maxHeight = '0'
    section.style.opacity = '0'
    setTimeout(() => {
      section.style.display = 'none'
      section.classList.remove('expanded')
    }, 300)
  }
  
  // Update button arrow
  const btn = document.querySelector(`[data-action="toggle-${sectionId.replace('sp-', '')}"]`)
  if (btn) {
    const arrow = btn.querySelector('.sp-btn-arrow')
    if (arrow) arrow.textContent = uiState[stateKey] ? '−' : '+'
  }
}

function toggleSubsection(subsectionId) {
  const content = document.getElementById(subsectionId)
  const header = document.querySelector(`[data-subsection="${subsectionId}"]`)
  if (!content || !header) return
  
  const isExpanded = uiState.expandedSubsections.has(subsectionId)
  
  if (isExpanded) {
    uiState.expandedSubsections.delete(subsectionId)
    content.classList.remove('expanded')
    header.classList.remove('expanded')
  } else {
    uiState.expandedSubsections.add(subsectionId)
    content.classList.add('expanded')
    header.classList.add('expanded')
  }
}

// ============== HELPERS ==============

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
  // #region agent log
  console.log('[DEBUG] Video page handling started', {videoId, currentVideoId, panelInjected, url:window.location.href, supabaseUrl:SUPABASE_URL});
  // #endregion
  if (!videoId || (videoId === currentVideoId && panelInjected)) return
  
  currentVideoId = videoId
  panelInjected = false
  transcriptData = null
  uiState = { 
    detailedExpanded: false, 
    greenwashingExpanded: false, 
    alternativesExpanded: false,
    transcriptExpanded: false,
    expandedSubsections: new Set() 
  }
  
  const sidebar = await waitForElement('#secondary, #secondary-inner')
  if (!sidebar) return
  
  if (!injectPanel()) return
  showLoading()
  
  // Step 1: Try to fetch transcript
  updateLoadingStep(0)
  transcriptData = await fetchTranscript(videoId)
  
  // Step 2: Analyze video with transcript
  updateLoadingStep(1)
  const data = await analyzeVideo(videoId, transcriptData)
  
  // Step 3: Show results
  updateLoadingStep(2)
  
  if (data && data.bias_analysis) {
    analysisData = data
    showResults(data)
  } else {
    showError('Unable to analyze this video. Please try again.')
  }
}

function waitForElement(selector, timeout = 15000) {
  return new Promise(resolve => {
    const el = document.querySelector(selector)
    if (el) return resolve(el)
    
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) { observer.disconnect(); resolve(el) }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { observer.disconnect(); resolve(null) }, timeout)
  })
}

window.silencedRetry = function() {
  currentVideoId = null
  panelInjected = false
  analysisData = null
  handleVideoPage()
}

// ============== NAVIGATION ==============

let lastUrl = location.href
function checkNavigation() {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    currentVideoId = null
    panelInjected = false
    analysisData = null
    
    if (isWatchPage()) setTimeout(handleVideoPage, 1500)
    else {
      const panel = document.getElementById('silenced-panel')
      if (panel) panel.remove()
    }
  }
}

const navObserver = new MutationObserver(checkNavigation)
navObserver.observe(document.body, { childList: true, subtree: true })
window.addEventListener('popstate', checkNavigation)
window.addEventListener('yt-navigate-finish', checkNavigation)

// ============== INIT ==============

function init() {
  log('Extension loaded v5 - YouTube Native UI')
  // #region agent log
  console.log('[DEBUG] Extension initialized', {isWatchPage:isWatchPage(), url:window.location.href});
  // #endregion
  if (isWatchPage()) setTimeout(handleVideoPage, 2000)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()
