// Silenced by the Algorithm - Popup Script
// Noise Cancellation Control Center

document.addEventListener('DOMContentLoaded', async () => {
  // Load stats and state from storage
  const data = await chrome.storage.local.get([
    'discoveredCount', 
    'hiddenCount', 
    'discoveryMode',
    'noiseCancellationActive'
  ])
  
  // Update stats display
  const voicesUnmuted = data.discoveredCount || 0
  const noiseMuted = data.hiddenCount || 0
  const isActive = data.noiseCancellationActive || data.discoveryMode || false
  
  document.getElementById('voices-unmuted').textContent = voicesUnmuted
  document.getElementById('noise-muted').textContent = noiseMuted
  
  // Update toggle state
  const toggleCard = document.getElementById('noise-toggle')
  if (isActive) {
    toggleCard.classList.add('active')
  }
  
  // Toggle click handler
  toggleCard.addEventListener('click', async () => {
    const newState = !toggleCard.classList.contains('active')
    toggleCard.classList.toggle('active', newState)
    
    // Save state
    await chrome.storage.local.set({ 
      discoveryMode: newState,
      noiseCancellationActive: newState 
    })
    
    // Send message to active YouTube tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    
    if (tab?.url?.includes('youtube.com')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'toggleNoiseCancellation' })
      } catch (err) {
        // Tab might not have content script loaded yet
        console.log('Could not send message to tab:', err)
      }
    }
  })
  
  // Keyboard support
  toggleCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleCard.click()
    }
  })
  
  // Update toggle aria state
  toggleCard.setAttribute('aria-checked', isActive)
})

// Animate stat numbers on load
function animateValue(elementId, endValue, duration = 1000) {
  const element = document.getElementById(elementId)
  const startValue = 0
  const startTime = performance.now()
  
  function update(currentTime) {
    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / duration, 1)
    const easeOut = 1 - Math.pow(1 - progress, 3)
    const currentValue = Math.round(startValue + (endValue - startValue) * easeOut)
    element.textContent = currentValue
    
    if (progress < 1) {
      requestAnimationFrame(update)
    }
  }
  
  if (endValue > 0) {
    requestAnimationFrame(update)
  }
}

// Run animations after DOM loads
document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get(['discoveredCount', 'hiddenCount'])
  
  setTimeout(() => {
    animateValue('voices-unmuted', data.discoveredCount || 0, 800)
    animateValue('noise-muted', data.hiddenCount || 0, 800)
  }, 200)
})
