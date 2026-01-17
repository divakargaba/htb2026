// background.js - Service worker for Silenced by the Algorithm

// Listen for extension icon click
chrome.action.onClicked.addListener((tab) => {
  // Send message to content script to toggle overlay
  chrome.tabs.sendMessage(tab.id, { action: 'toggle_overlay' })
})

// Optional: Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'log') {
    console.log('Content script:', request.message)
  }
  return true
})
