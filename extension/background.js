// background.js - Service worker
// Extension auto-runs on YouTube watch pages, no manual trigger needed

// When extension icon is clicked, just open YouTube if not already there
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url?.includes('youtube.com/watch')) {
    // Already on a YouTube video - the content script auto-runs
    // Just log for debugging
    console.log('Extension active on:', tab.url)
  } else {
    // Open YouTube
    chrome.tabs.create({ url: 'https://www.youtube.com' })
  }
})

// Log when extension loads
console.log('Silenced by the Algorithm extension loaded')
