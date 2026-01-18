/**
 * Noise/Silenced Tab Bar Component
 * 
 * A tab bar placed between YouTube's category chips and video grid.
 * Switches between Noise (current feed with bias analysis) and Silenced (alternative recommendations).
 */

;(function() {
'use strict';

// ============================================
// CONSTANTS
// ============================================

const TABBAR_ID = 'bias-tabs'
const TABS = {
  NOISE: 'noise',
  SILENCED: 'silenced'
}

// ============================================
// STATE
// ============================================

let activeTab = TABS.NOISE
let tabBarElement = null
let onTabChangeCallbacks = []

// ============================================
// TAB BAR CREATION
// ============================================

/**
 * Create the tab bar element
 */
function createTabBarElement() {
  const container = document.createElement('div')
  container.id = TABBAR_ID
  container.className = 'bias-tabs-container'
  
  container.innerHTML = `
    <div class="bias-tabs-inner">
      <button class="bias-tab active" data-tab="${TABS.NOISE}">
        <span class="bias-tab-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </span>
        <span class="bias-tab-label">Noise</span>
        <span class="bias-tab-count loading" id="noise-count">
          <span class="count-spinner"></span>
        </span>
      </button>
      <button class="bias-tab" data-tab="${TABS.SILENCED}">
        <span class="bias-tab-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
        </span>
        <span class="bias-tab-label">Silenced</span>
        <span class="bias-tab-count loading" id="silenced-count">
          <span class="count-spinner"></span>
        </span>
      </button>
      <div class="bias-tabs-info">
        <span class="bias-tabs-hint" id="tabs-hint">Analyzing feed...</span>
      </div>
    </div>
  `
  
  // Add click handlers
  const tabs = container.querySelectorAll('.bias-tab')
  tabs.forEach(tab => {
    tab.addEventListener('click', handleTabClick)
  })
  
  return container
}

/**
 * Get tab bar styles
 */
function getTabBarStyles() {
  return `
    .bias-tabs-container {
      display: none; /* Hidden until Bias Lens is enabled */
      width: 100%;
      padding: 12px 24px;
      background: var(--yt-spec-base-background, #0f0f0f);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      box-sizing: border-box;
    }
    
    .bias-tabs-container.visible {
      display: block;
    }
    
    .bias-tabs-inner {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
    }
    
    .bias-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      color: #aaa;
      font-family: "YouTube Sans", "Roboto", sans-serif;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
    }
    
    .bias-tab:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    
    .bias-tab.active {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    
    .bias-tab[data-tab="noise"].active {
      background: rgba(249, 115, 22, 0.15);
      color: #f97316;
    }
    
    .bias-tab[data-tab="silenced"].active {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
    }
    
    .bias-tab-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .bias-tab-icon svg {
      width: 16px;
      height: 16px;
    }
    
    .bias-tab-label {
      white-space: nowrap;
    }
    
    .bias-tab-count {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.1);
      min-width: 20px;
      text-align: center;
      transition: all 0.3s ease;
    }
    
    .bias-tab-count.loading {
      min-width: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .count-spinner {
      width: 10px;
      height: 10px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: countSpin 0.8s linear infinite;
    }
    
    @keyframes countSpin {
      to { transform: rotate(360deg); }
    }
    
    .bias-tab[data-tab="noise"].active .bias-tab-count {
      background: rgba(249, 115, 22, 0.3);
    }
    
    .bias-tab[data-tab="silenced"].active .bias-tab-count {
      background: rgba(16, 185, 129, 0.3);
    }
    
    /* Count animation */
    @keyframes countPop {
      0% { transform: scale(1); }
      50% { transform: scale(1.2); }
      100% { transform: scale(1); }
    }
    
    .bias-tab-count.updated {
      animation: countPop 0.3s ease;
    }
    
    .bias-tabs-info {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .bias-tabs-hint {
      font-size: 12px;
      color: #666;
      font-style: italic;
    }
    
    /* Active indicator line */
    .bias-tab::after {
      content: '';
      position: absolute;
      bottom: -9px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 2px;
      background: currentColor;
      transition: width 0.2s ease;
    }
    
    .bias-tab.active::after {
      width: 60%;
    }
    
    /* Responsive */
    @media (max-width: 700px) {
      .bias-tab {
        padding: 6px 12px;
        font-size: 13px;
      }
      
      .bias-tabs-hint {
        display: none;
      }
    }
    
    /* Animation for tab switch */
    @keyframes tabPulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.02); }
      100% { transform: scale(1); }
    }
    
    .bias-tab.switching {
      animation: tabPulse 0.3s ease;
    }
  `
}

// ============================================
// TAB BAR INJECTION
// ============================================

/**
 * Find the injection point (between chips and video grid)
 */
function findInjectionPoint() {
  // Find a spot ABOVE the video grid, not inside it
  // This way our tab bar won't be hidden when we hide the video grid
  
  // First, try to find the chip bar and insert after it
  const chipBar = document.querySelector('ytd-feed-filter-chip-bar-renderer')
  if (chipBar && chipBar.parentElement) {
    return { type: 'after', element: chipBar }
  }
  
  // Try the rich grid renderer and insert before it
  const richGrid = document.querySelector('ytd-rich-grid-renderer')
  if (richGrid && richGrid.parentElement) {
    return { type: 'before', element: richGrid }
  }
  
  // Fallback: find primary area
  const primary = document.querySelector('#primary')
  if (primary) {
    return { type: 'prepend', element: primary }
  }
  
  return null
}

/**
 * Inject the tab bar into the page
 */
function injectTabBar() {
  // Check if already injected
  if (document.getElementById(TABBAR_ID)) {
    tabBarElement = document.getElementById(TABBAR_ID)
    return tabBarElement
  }
  
  // Inject styles
  injectStyles()
  
  // Find the right injection point - OUTSIDE the video grid
  const injection = findInjectionPoint()
  
  // Create tab bar
  tabBarElement = createTabBarElement()
  
  if (injection) {
    const { type, element } = injection
    
    try {
      if (type === 'after') {
        element.parentNode.insertBefore(tabBarElement, element.nextSibling)
        console.log('[BiasLens] Tab bar injected after', element.tagName)
      } else if (type === 'before') {
        element.parentNode.insertBefore(tabBarElement, element)
        console.log('[BiasLens] Tab bar injected before', element.tagName)
      } else if (type === 'prepend') {
        element.insertBefore(tabBarElement, element.firstChild)
        console.log('[BiasLens] Tab bar prepended to', element.tagName)
      }
    } catch (e) {
      console.warn('[BiasLens] Tab bar injection failed, using fallback:', e)
      useFixedFallback()
    }
  } else {
    console.warn('[BiasLens] Could not find tab bar injection point')
    useFixedFallback()
  }
  
  function useFixedFallback() {
    tabBarElement.style.position = 'fixed'
    tabBarElement.style.top = '112px'
    tabBarElement.style.left = '240px'
    tabBarElement.style.right = '24px'
    tabBarElement.style.zIndex = '9997'
    tabBarElement.style.background = 'rgba(15, 15, 15, 0.98)'
    tabBarElement.style.borderRadius = '8px'
    tabBarElement.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)'
    document.body.appendChild(tabBarElement)
    console.log('[BiasLens] Tab bar using fixed positioning fallback')
  }
  
  return tabBarElement
}

/**
 * Inject tab bar styles
 */
function injectStyles() {
  const styleId = 'bias-tabs-styles'
  
  if (document.getElementById(styleId)) {
    return
  }
  
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = getTabBarStyles()
  document.head.appendChild(style)
}

// ============================================
// STATE MANAGEMENT
// ============================================

/**
 * Show the tab bar
 */
function show() {
  // If tab bar doesn't exist, inject it first
  if (!tabBarElement) {
    injectTabBar()
  }
  
  if (tabBarElement) {
    tabBarElement.classList.add('visible')
  }
}

/**
 * Hide the tab bar
 */
function hide() {
  if (tabBarElement) {
    tabBarElement.classList.remove('visible')
  }
}

/**
 * Set active tab
 */
function setActiveTab(tab) {
  if (tab !== TABS.NOISE && tab !== TABS.SILENCED) {
    console.warn('[BiasLens] Invalid tab:', tab)
    return
  }
  
  if (activeTab === tab) return
  
  activeTab = tab
  updateTabUI()
  notifyTabChange()
}

/**
 * Get active tab
 */
function getActiveTab() {
  return activeTab
}

/**
 * Update tab UI to match state
 */
function updateTabUI() {
  if (!tabBarElement) return
  
  const tabs = tabBarElement.querySelectorAll('.bias-tab')
  tabs.forEach(tab => {
    const tabId = tab.dataset.tab
    
    if (tabId === activeTab) {
      tab.classList.add('active')
      tab.classList.add('switching')
      setTimeout(() => tab.classList.remove('switching'), 300)
    } else {
      tab.classList.remove('active')
    }
  })
}

/**
 * Update tab counts with animation
 */
function updateCounts(noiseCount, silencedCount) {
  if (!tabBarElement) return
  
  const noiseCountEl = tabBarElement.querySelector('#noise-count')
  const silencedCountEl = tabBarElement.querySelector('#silenced-count')
  
  if (noiseCountEl && noiseCount !== undefined) {
    animateCount(noiseCountEl, noiseCount)
  }
  
  if (silencedCountEl && silencedCount !== undefined) {
    animateCount(silencedCountEl, silencedCount)
  }
}

/**
 * Animate a count element from 0 (or current) to target
 */
function animateCount(element, targetCount) {
  // Remove loading state
  element.classList.remove('loading')
  
  // Get current count (0 if was loading)
  const currentText = element.textContent.trim()
  const currentCount = parseInt(currentText) || 0
  
  // If same count, no animation needed
  if (currentCount === targetCount) {
    element.textContent = targetCount
    return
  }
  
  // Quick animation for count-up effect
  const duration = 400 // ms
  const steps = Math.min(targetCount - currentCount, 20)
  const stepDuration = duration / steps
  
  let current = currentCount
  const increment = Math.ceil((targetCount - currentCount) / steps)
  
  const interval = setInterval(() => {
    current = Math.min(current + increment, targetCount)
    element.textContent = current
    
    if (current >= targetCount) {
      clearInterval(interval)
      element.textContent = targetCount
      
      // Add pop animation
      element.classList.add('updated')
      setTimeout(() => element.classList.remove('updated'), 300)
    }
  }, stepDuration)
}

/**
 * Update hint text
 */
function updateHint(text) {
  if (!tabBarElement) return
  
  const hintEl = tabBarElement.querySelector('#tabs-hint')
  if (hintEl) {
    hintEl.textContent = text
  }
}

// ============================================
// EVENT HANDLING
// ============================================

/**
 * Handle tab click
 */
function handleTabClick(event) {
  event.preventDefault()
  event.stopPropagation()
  
  const tab = event.currentTarget.dataset.tab
  setActiveTab(tab)
}

/**
 * Register a callback for tab changes
 */
function onTabChange(callback) {
  if (typeof callback === 'function') {
    onTabChangeCallbacks.push(callback)
  }
}

/**
 * Remove a tab change callback
 */
function offTabChange(callback) {
  onTabChangeCallbacks = onTabChangeCallbacks.filter(cb => cb !== callback)
}

/**
 * Notify all registered callbacks
 */
function notifyTabChange() {
  for (const callback of onTabChangeCallbacks) {
    try {
      callback(activeTab)
    } catch (error) {
      console.error('[BiasLens] Tab change callback error:', error)
    }
  }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Remove the tab bar from DOM
 */
function removeTabBar() {
  if (tabBarElement) {
    tabBarElement.remove()
    tabBarElement = null
  }
}

/**
 * Initialize tab bar (call after Bias Lens is enabled)
 */
function init() {
  // Wait for the injection point to be available
  const observer = new MutationObserver((mutations, obs) => {
    const injectionPoint = findInjectionPoint()
    if (injectionPoint) {
      obs.disconnect()
      injectTabBar()
    }
  })
  
  // Check if already available
  if (findInjectionPoint()) {
    injectTabBar()
  } else {
    // Wait for it
    observer.observe(document.body, {
      childList: true,
      subtree: true
    })
    
    // Timeout after 10 seconds
    setTimeout(() => {
      observer.disconnect()
      if (!tabBarElement) {
        console.warn('[BiasLens] Injection point not found after timeout')
      }
    }, 10000)
  }
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.BiasTabBar = {
    init,
    injectTabBar,
    removeTabBar,
    show,
    hide,
    setActiveTab,
    getActiveTab,
    updateCounts,
    updateHint,
    onTabChange,
    offTabChange,
    TABS,
    TABBAR_ID
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    init,
    injectTabBar,
    removeTabBar,
    show,
    hide,
    setActiveTab,
    getActiveTab,
    updateCounts,
    updateHint,
    onTabChange,
    offTabChange,
    TABS,
    TABBAR_ID
  }
}

})(); // End IIFE
