/**
 * Bias Lens Toggle Component
 * 
 * A toggle button in YouTube's masthead that enables/disables the bias analysis layer.
 * Persists state to chrome.storage and triggers homepage instrumentation.
 */

;(function() {
'use strict';

// ============================================
// CONSTANTS
// ============================================

const TOGGLE_ID = 'bias-lens-toggle'
const STORAGE_KEY = 'biasLensEnabled'

// ============================================
// STATE
// ============================================

let isEnabled = false
let toggleElement = null
let onToggleCallbacks = []

// ============================================
// TOGGLE CREATION
// ============================================

/**
 * Create the toggle button element
 */
function createToggleElement() {
  const button = document.createElement('button')
  button.id = TOGGLE_ID
  button.className = 'bias-lens-toggle bias-lens-off'
  button.setAttribute('aria-label', 'Toggle Bias Lens')
  button.setAttribute('title', 'Toggle Bias Lens - Analyze algorithmic bias in your feed')
  
  button.innerHTML = `
    <span class="bias-lens-icon">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="4"/>
        <line x1="12" y1="2" x2="12" y2="6"/>
        <line x1="12" y1="18" x2="12" y2="22"/>
        <line x1="2" y1="12" x2="6" y2="12"/>
        <line x1="18" y1="12" x2="22" y2="12"/>
      </svg>
    </span>
    <span class="bias-lens-label">Bias Lens</span>
    <span class="bias-lens-indicator"></span>
  `
  
  button.addEventListener('click', handleToggleClick)
  
  return button
}

/**
 * Get toggle styles
 */
function getToggleStyles() {
  return `
    .bias-lens-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 18px;
      background: transparent;
      color: #aaa;
      font-family: "YouTube Sans", "Roboto", sans-serif;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-right: 8px;
      position: relative;
    }
    
    .bias-lens-toggle:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.3);
      color: #fff;
    }
    
    .bias-lens-toggle.bias-lens-on {
      background: rgba(16, 185, 129, 0.15);
      border-color: rgba(16, 185, 129, 0.5);
      color: #10b981;
    }
    
    .bias-lens-toggle.bias-lens-on:hover {
      background: rgba(16, 185, 129, 0.25);
      border-color: rgba(16, 185, 129, 0.7);
    }
    
    .bias-lens-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease;
    }
    
    .bias-lens-toggle.bias-lens-on .bias-lens-icon {
      transform: rotate(90deg);
    }
    
    .bias-lens-icon svg {
      width: 16px;
      height: 16px;
    }
    
    .bias-lens-label {
      white-space: nowrap;
    }
    
    .bias-lens-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: transparent;
      transition: all 0.2s ease;
    }
    
    .bias-lens-toggle.bias-lens-on .bias-lens-indicator {
      background: #10b981;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
    }
    
    /* Responsive - hide label on smaller screens */
    @media (max-width: 800px) {
      .bias-lens-label {
        display: none;
      }
      
      .bias-lens-toggle {
        padding: 8px;
        border-radius: 50%;
      }
    }
    
    /* Animation for activation */
    @keyframes biasLensPulse {
      0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
      70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
      100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    
    .bias-lens-toggle.bias-lens-activating {
      animation: biasLensPulse 0.6s ease-out;
    }
  `
}

// ============================================
// TOGGLE INJECTION
// ============================================

/**
 * Find the best injection point in YouTube's masthead
 */
function findInjectionPoint() {
  // Try different selectors for YouTube's masthead
  const selectors = [
    '#end #buttons',                           // Main buttons container
    'ytd-masthead #end',                       // End section of masthead
    '#container.ytd-masthead #end',            // Container end
    'ytd-topbar-menu-button-renderer',         // Before menu buttons
    '#buttons.ytd-masthead'                    // Buttons area
  ]
  
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) {
      return element
    }
  }
  
  return null
}

/**
 * Inject the toggle into YouTube's masthead
 */
function injectToggle() {
  // Check if already injected
  if (document.getElementById(TOGGLE_ID)) {
    toggleElement = document.getElementById(TOGGLE_ID)
    return toggleElement
  }
  
  // Inject styles
  injectStyles()
  
  // Find injection point
  const injectionPoint = findInjectionPoint()
  
  if (!injectionPoint) {
    console.warn('[BiasLens] Could not find masthead injection point')
    return null
  }
  
  // Create and inject toggle
  toggleElement = createToggleElement()
  
  // Insert at the beginning of the buttons area
  injectionPoint.insertBefore(toggleElement, injectionPoint.firstChild)
  
  // Load saved state
  loadState()
  
  console.log('[BiasLens] Toggle injected successfully')
  
  return toggleElement
}

/**
 * Inject toggle styles
 */
function injectStyles() {
  const styleId = 'bias-lens-toggle-styles'
  
  if (document.getElementById(styleId)) {
    return
  }
  
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = getToggleStyles()
  document.head.appendChild(style)
}

// ============================================
// STATE MANAGEMENT
// ============================================

/**
 * Load toggle state from storage
 */
async function loadState() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    isEnabled = result[STORAGE_KEY] || false
    updateToggleUI()
  } catch (error) {
    console.warn('[BiasLens] Failed to load state:', error)
    isEnabled = false
  }
}

/**
 * Save toggle state to storage
 */
async function saveState() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: isEnabled })
  } catch (error) {
    console.warn('[BiasLens] Failed to save state:', error)
  }
}

/**
 * Update toggle UI to match state
 */
function updateToggleUI() {
  if (!toggleElement) return
  
  if (isEnabled) {
    toggleElement.classList.remove('bias-lens-off')
    toggleElement.classList.add('bias-lens-on')
    toggleElement.setAttribute('aria-pressed', 'true')
    toggleElement.title = 'Bias Lens ON - Click to disable'
  } else {
    toggleElement.classList.remove('bias-lens-on')
    toggleElement.classList.add('bias-lens-off')
    toggleElement.setAttribute('aria-pressed', 'false')
    toggleElement.title = 'Bias Lens OFF - Click to enable'
  }
}

// ============================================
// EVENT HANDLING
// ============================================

/**
 * Handle toggle click
 */
function handleToggleClick(event) {
  event.preventDefault()
  event.stopPropagation()
  
  // Toggle state
  isEnabled = !isEnabled
  
  // Add activation animation
  if (isEnabled && toggleElement) {
    toggleElement.classList.add('bias-lens-activating')
    setTimeout(() => {
      toggleElement.classList.remove('bias-lens-activating')
    }, 600)
  }
  
  // Update UI
  updateToggleUI()
  
  // Save state
  saveState()
  
  // Notify callbacks
  notifyToggle()
  
  console.log('[BiasLens] Toggle:', isEnabled ? 'ON' : 'OFF')
}

/**
 * Register a callback for toggle changes
 */
function onToggle(callback) {
  if (typeof callback === 'function') {
    onToggleCallbacks.push(callback)
  }
}

/**
 * Remove a toggle callback
 */
function offToggle(callback) {
  onToggleCallbacks = onToggleCallbacks.filter(cb => cb !== callback)
}

/**
 * Notify all registered callbacks
 */
function notifyToggle() {
  for (const callback of onToggleCallbacks) {
    try {
      callback(isEnabled)
    } catch (error) {
      console.error('[BiasLens] Toggle callback error:', error)
    }
  }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Get current toggle state
 */
function getState() {
  return isEnabled
}

/**
 * Set toggle state programmatically
 */
function setState(enabled) {
  if (isEnabled !== enabled) {
    isEnabled = enabled
    updateToggleUI()
    saveState()
    notifyToggle()
  }
}

/**
 * Remove the toggle from DOM
 */
function removeToggle() {
  if (toggleElement) {
    toggleElement.remove()
    toggleElement = null
  }
}

/**
 * Initialize toggle (call on page load)
 */
function init() {
  // Wait for masthead to be available
  const observer = new MutationObserver((mutations, obs) => {
    const injectionPoint = findInjectionPoint()
    if (injectionPoint) {
      obs.disconnect()
      injectToggle()
    }
  })
  
  // Check if already available
  if (findInjectionPoint()) {
    injectToggle()
  } else {
    // Wait for it
    observer.observe(document.body, {
      childList: true,
      subtree: true
    })
    
    // Timeout after 10 seconds
    setTimeout(() => {
      observer.disconnect()
      if (!toggleElement) {
        console.warn('[BiasLens] Masthead not found after timeout')
      }
    }, 10000)
  }
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.BiasLensToggle = {
    init,
    injectToggle,
    removeToggle,
    getState,
    setState,
    onToggle,
    offToggle,
    TOGGLE_ID,
    STORAGE_KEY
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    init,
    injectToggle,
    removeToggle,
    getState,
    setState,
    onToggle,
    offToggle,
    TOGGLE_ID,
    STORAGE_KEY
  }
}

})(); // End IIFE
