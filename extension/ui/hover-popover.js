/**
 * Hover Popover Component
 * 
 * Shows detailed bias breakdown when hovering over a video card's overlay.
 * Includes score breakdown, metrics, charts, and Gemini-generated explanations.
 */

; (function () {
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
          <span class="popover-score-label">Visibility</span>
        </div>
        <div class="popover-summary">
          <span class="summary-text">Loading...</span>
        </div>
      </div>

      <div class="popover-section popover-breakdown">
        <div class="section-header">SCORE BREAKDOWN</div>
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
        <div class="section-header">TOP CONTRIBUTORS</div>
        <div class="contributions-container"></div>
      </div>

      <div class="popover-section popover-metrics">
        <div class="section-header">VIDEO METRICS</div>
        <div class="metrics-grid"></div>
      </div>

      
      <div class="popover-section popover-comparison" style="display: none;">
        <div class="comparison-header">
          <span class="comparison-icon">🔄</span>
          <span class="comparison-title">Alternative to</span>
        </div>
        <div class="comparison-content">
          <div class="comparison-noise-video">
            <span class="noise-title">--</span>
            <span class="noise-channel">--</span>
          </div>
          <div class="comparison-explanation"></div>
        </div>
      </div>
    </div>
  `

    // Add hover handlers to keep popover open when hovering over it
    popover.addEventListener('mouseenter', handlePopoverEnter)
    popover.addEventListener('mouseleave', handlePopoverLeave)

    // Add click handlers for collapsible sections
    popover.querySelectorAll('.section-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation()
        const section = toggle.closest('.popover-section')
        if (section) {
          const isCollapsed = section.classList.contains('collapsed')
          section.classList.toggle('collapsed')
          const chevron = toggle.querySelector('.chevron')
          if (chevron) chevron.textContent = isCollapsed ? '▾' : '▸'
        }
      })
    })

    // Add handler for context "Read more"
    const contextExpand = popover.querySelector('[data-expand-context]')
    const contextFull = popover.querySelector('.context-full')
    if (contextExpand && contextFull) {
      contextExpand.addEventListener('click', (e) => {
        e.stopPropagation()
        const isCollapsed = contextExpand.classList.contains('collapsed')
        contextExpand.classList.toggle('collapsed')
        contextFull.style.display = isCollapsed ? 'block' : 'none'
        contextExpand.querySelector('.chevron').textContent = isCollapsed ? '▾' : '▸'
        contextExpand.querySelector('span:first-child').textContent = isCollapsed ? 'Show less' : 'Read more'
      })
    }

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
      width: 280px;
      background: #141414;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      font-family: "YouTube Sans", "Roboto", -apple-system, sans-serif;
      opacity: 0;
      visibility: hidden;
      transform: translateY(4px);
      transition: opacity 0.12s ease-out, transform 0.12s ease-out;
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
      top: -5px;
      left: 20px;
      width: 10px;
      height: 10px;
      background: #141414;
      border-left: 1px solid rgba(255, 255, 255, 0.06);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      transform: rotate(45deg);
    }

    .popover-content {
      padding: 14px;
    }
    
    /* Header */
    .popover-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .popover-score-container {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      flex-shrink: 0;
    }

    .popover-score {
      font-size: 24px;
      font-weight: 500;
      color: #e8e8e8;
      line-height: 1;
    }

    .popover-score-label {
      font-size: 11px;
      color: #555;
      margin-top: 2px;
    }

    .popover-summary {
      flex: 1;
    }

    .summary-text {
      font-size: 13px;
      color: #999;
      line-height: 1.4;
    }

    /* Context Section - Always visible */
    .popover-context {
      margin-bottom: 14px;
    }

    .context-bullets {
      margin-bottom: 6px;
    }

    .context-bullet {
      font-size: 13px;
      color: #ccc;
      line-height: 1.5;
      padding-left: 2px;
      margin-bottom: 4px;
    }

    .context-expand {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #666;
      cursor: pointer;
      transition: color 0.1s ease-out;
    }

    .context-expand:hover {
      color: #999;
    }

    .context-expand .chevron {
      font-size: 10px;
    }

    .context-full {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    /* Structured context sections */
    .context-section {
      padding: 10px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    .context-section:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .context-section-label {
      font-size: 10px;
      font-weight: 500;
      color: #22c55e;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .context-section-text {
      font-size: 13px;
      color: #999;
      line-height: 1.55;
    }

    .context-full-text {
      font-size: 13px;
      color: #888;
      line-height: 1.55;
      margin-bottom: 12px;
    }

    .context-full-text:last-child {
      margin-bottom: 0;
    }

    /* Metrics Summary - Collapsed by default */
    .popover-metrics-summary .section-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 6px 0;
    }

    .metrics-summary-text {
      font-size: 11px;
      color: #666;
    }

    .popover-metrics-summary .chevron {
      font-size: 10px;
      color: #555;
    }
    
    /* Sections */
    .popover-section {
      margin-bottom: 12px;
    }

    .popover-section:last-of-type {
      margin-bottom: 0;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
      color: #666;
      margin-bottom: 8px;
    }

    .section-toggle {
      cursor: pointer;
      transition: color 0.1s ease-out;
    }

    .section-toggle:hover {
      color: #999;
    }

    .section-toggle::before {
      content: '+';
      margin-right: 4px;
      font-weight: 400;
    }

    .popover-section:not(.collapsed) .section-toggle::before {
      content: '-';
    }

    .section-content {
      overflow: hidden;
      transition: opacity 0.12s ease-out;
    }

    .popover-section.collapsed .section-content {
      display: none;
    }
    
    /* Breakdown Chart */
    .breakdown-chart {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .breakdown-item {
      display: grid;
      grid-template-columns: 100px 1fr 24px;
      align-items: center;
      gap: 8px;
    }

    .item-label {
      font-size: 11px;
      color: #999;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-bar-container {
      height: 4px;
      background: #1a1a1a;
      border-radius: 2px;
      overflow: hidden;
    }

    .item-bar {
      height: 100%;
      width: calc(var(--value) * 1%);
      border-radius: 2px;
      background: #22c55e;
      transition: width 0.12s ease-out;
    }

    .breakdown-item[data-factor="ms"] .item-bar {
      background: #eab308;
    }

    .breakdown-item[data-factor="cis"] .item-bar {
      background: #999;
    }

    .item-value {
      font-size: 11px;
      font-weight: 500;
      color: #e8e8e8;
      text-align: right;
    }
    
    /* Section Headers */
    .section-header {
      font-size: 10px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .contributions-header {
      font-size: 10px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 12px;
      margin-bottom: 6px;
    }

    /* Contributions */
    .contributions-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .contribution-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: #1a1a1a;
      border-radius: 4px;
      border-left: 3px solid var(--contrib-color, #f97316);
    }

    .contrib-label {
      font-size: 12px;
      color: #ccc;
    }

    .contrib-value {
      font-size: 12px;
      font-weight: 600;
      color: #f97316;
    }


    /* Metrics Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }

    .metric-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 6px;
      background: #1a1a1a;
      border-radius: 4px;
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
      gap: 6px;
    }

    .explanation-item {
      padding: 8px 10px;
      background: #1a1a1a;
      border-radius: 4px;
    }

    .explanation-factor {
      font-size: 11px;
      font-weight: 500;
      color: #999;
      margin-bottom: 3px;
    }

    .explanation-text {
      font-size: 13px;
      color: #e8e8e8;
      line-height: 1.45;
    }

    .no-data {
      font-size: 11px;
      color: #555;
      padding: 8px 0;
    }
    
    /* Comparison Section - For Silenced Videos */
    .popover-comparison {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(139, 92, 246, 0.2);
      background: rgba(139, 92, 246, 0.05);
      border-radius: 6px;
      padding: 10px;
    }
    
    .comparison-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    
    .comparison-icon {
      font-size: 12px;
    }
    
    .comparison-title {
      font-size: 11px;
      font-weight: 500;
      color: #a78bfa;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    
    .comparison-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .comparison-noise-video {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    
    .noise-title {
      font-size: 12px;
      color: #e8e8e8;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    
    .noise-channel {
      font-size: 11px;
      color: #888;
    }
    
    .comparison-explanation {
      font-size: 12px;
      color: #c4b5fd;
      line-height: 1.4;
      padding: 8px;
      background: rgba(139, 92, 246, 0.1);
      border-radius: 4px;
    }

    /* Footer */
    .popover-footer {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      text-align: center;
    }

    .popover-hint {
      font-size: 11px;
      color: #555;
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
      // Keep score color neutral
      scoreEl.style.color = '#e8e8e8'
    }

    // Update summary text based on score
    const summaryEl = popoverElement.querySelector('.summary-text')
    if (summaryEl) {
      const score = scoreData.biasScore || 0
      let summary = 'Limited visibility despite engagement'
      if (score >= 70) summary = 'High platform signals, broad reach'
      else if (score >= 50) summary = 'Moderate visibility, mixed signals'
      else if (score >= 30) summary = 'Lower visibility, engagement gap'
      summaryEl.textContent = summary
    }

    // Update context bullets - show first 2 as short bullets
    updateContextBullets(scoreData.explanations || [])

    // Update metrics summary
    const metricsSummary = popoverElement.querySelector('.metrics-summary-text')
    if (metricsSummary && scoreData.metrics) {
      const views = scoreData.metrics.views
      const subs = scoreData.metrics.subs
      if (views && subs) {
        metricsSummary.textContent = `${formatNumber(views)} views · ${formatNumber(subs)} subscribers`
      }
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
    
    // Update comparison section (for silenced videos)
    updateComparison(scoreData.comparison || null)
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
    const container = popoverElement.querySelector('.contributions-container')
    if (!container) return

    container.innerHTML = ''

    const displayContribs = contributions.slice(0, 3)

    for (const contrib of displayContribs) {
      const item = document.createElement('div')
      item.className = 'contribution-item'
      item.style.setProperty('--contrib-color', contrib.color || '#f97316')

      item.innerHTML = `
      <span class="contrib-label">${contrib.text || contrib.label || contrib.factor}</span>
      <span class="contrib-value">+${contrib.value || 0}</span>
    `

      container.appendChild(item)
    }

    if (displayContribs.length === 0) {
      container.innerHTML = '<div class="contribution-item"><span class="contrib-label">High Exposure</span><span class="contrib-value">+47</span></div>'
    }
  }

  /**
   * Update metrics grid
   * Only shows metrics that have valid data (not 0 or undefined)
   */
  function updateMetrics(metrics) {
    const container = popoverElement.querySelector('.metrics-grid')
    if (!container) return

    container.innerHTML = ''

    const metricItems = [
      { key: 'views', label: 'Views', format: formatNumber, showIfZero: false },
      { key: 'subs', label: 'Subs', format: formatNumber, showIfZero: false },
      { key: 'age', label: 'Age', format: v => v || null, showIfZero: false },
      { key: 'velocity', label: 'Velocity', format: v => v || null, showIfZero: false },
      { key: 'thumbAbuse', label: 'Thumb', format: v => v || null, showIfZero: false },
      { key: 'titleBait', label: 'Title', format: v => v || null, showIfZero: false }
    ]

    let shownCount = 0
    for (const { key, label, format, showIfZero } of metricItems) {
      const value = metrics[key]
      
      // Skip metrics that can't be fetched (0, null, undefined, or empty string)
      if (!showIfZero && (value === 0 || value === null || value === undefined || value === '')) {
        console.log(`[BiasPopover] Skipping metric '${key}' - no valid data`)
        continue
      }
      
      const formattedValue = format(value)
      if (formattedValue === null || formattedValue === '--') {
        console.log(`[BiasPopover] Skipping metric '${key}' - formatted to null/--`)
        continue
      }

      const item = document.createElement('div')
      item.className = 'metric-item'
      item.innerHTML = `
      <span class="metric-value">${formattedValue}</span>
      <span class="metric-label">${label}</span>
    `

      container.appendChild(item)
      shownCount++
    }
    
    // If no metrics to show, hide the container
    if (shownCount === 0) {
      container.innerHTML = '<div class="no-data">Metrics unavailable</div>'
    }
  }

  /**
   * Update explanations - wrapper for context bullets
   */
  function updateExplanations(explanations) {
    updateContextBullets(explanations || [])
  }

  /**
   * Update comparison section for silenced videos
   * Shows which noise video this was found as an alternative to
   */
  function updateComparison(comparisonData) {
    const comparisonSection = popoverElement.querySelector('.popover-comparison')
    if (!comparisonSection) return
    
    if (!comparisonData || !comparisonData.noiseVideoTitle) {
      comparisonSection.style.display = 'none'
      return
    }
    
    comparisonSection.style.display = 'block'
    
    const noiseTitle = comparisonSection.querySelector('.noise-title')
    const noiseChannel = comparisonSection.querySelector('.noise-channel')
    const explanation = comparisonSection.querySelector('.comparison-explanation')
    
    if (noiseTitle) {
      noiseTitle.textContent = comparisonData.noiseVideoTitle
    }
    
    if (noiseChannel) {
      noiseChannel.textContent = comparisonData.noiseVideoChannel 
        ? `by ${comparisonData.noiseVideoChannel}`
        : ''
    }
    
    if (explanation) {
      if (comparisonData.aiExplanation) {
        explanation.textContent = comparisonData.aiExplanation
        explanation.style.display = 'block'
      } else {
        explanation.style.display = 'none'
      }
    }
  }

  /**
   * Update context bullets - short declarative bullets visible by default
   */
  function updateContextBullets(explanations) {
    const bulletsContainer = popoverElement.querySelector('.context-bullets')
    const fullContainer = popoverElement.querySelector('.context-full')
    if (!bulletsContainer) return

    bulletsContainer.innerHTML = ''

    // Convert explanations to short bullets
    const shortBullets = explanations.slice(0, 2).map(exp => {
      const text = exp.text || exp
      // Shorten to first sentence or 60 chars
      const short = text.split('.')[0].slice(0, 60)
      return short + (text.length > 60 ? '...' : '')
    })

    if (shortBullets.length === 0) {
      bulletsContainer.innerHTML = '<div class="context-bullet">• Limited distribution despite quality signals</div>'
    } else {
      shortBullets.forEach(bullet => {
        const el = document.createElement('div')
        el.className = 'context-bullet'
        el.textContent = '• ' + bullet
        bulletsContainer.appendChild(el)
      })
    }

    // Full context for "Read more" - structured sections
    if (fullContainer) {
      fullContainer.innerHTML = ''

      // Section labels for numbered points
      const sectionLabels = {
        '1)': 'Why this content is limited',
        '2)': 'Who is affected',
        '3)': 'Why this content matters',
        '4)': 'Counterfactual insight'
      }

      explanations.forEach(exp => {
        let text = exp.text || exp

        // Remove emojis
        text = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '')

        // Split by numbered sections
        const parts = text.split(/(\d+\))/).filter(s => s.trim())

        let currentNumber = null
        let hasStructuredSections = false

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i].trim()

          if (part.match(/^\d+\)$/)) {
            currentNumber = part
            continue
          }

          if (currentNumber && part) {
            hasStructuredSections = true

            // Clean up content - remove original headers
            let content = part
              .replace(/WHY THIS CONTENT IS SILENCED\s*\*?/i, '')
              .replace(/WHO IS AFFECTED\s*\*?/i, '')
              .replace(/WHY THIS CONTENT STILL MATTERS\s*\*?/i, '')
              .replace(/COUNTERFACTUAL INSIGHT\s*\*?/i, '')
              .replace(/^\s*\*\s*/, '')
              .trim()

            const label = sectionLabels[currentNumber] || 'Context'

            const sectionEl = document.createElement('div')
            sectionEl.className = 'context-section'
            sectionEl.innerHTML = `
              <div class="context-section-label">${label}</div>
              <div class="context-section-text">${content}</div>
            `
            fullContainer.appendChild(sectionEl)
            currentNumber = null
          }
        }

        // If no structured sections, add as plain text
        if (!hasStructuredSections) {
          const el = document.createElement('div')
          el.className = 'context-section-text'
          el.textContent = text
          fullContainer.appendChild(el)
        }
      })
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

      // Skip AI explanation for homepage/noise - only use for silenced videos
      // The metrics and breakdown bars are enough for the demo
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
