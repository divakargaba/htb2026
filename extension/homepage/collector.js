/**
 * HomepageCollector - Extract exactly 20 homepage videos from window.ytInitialData
 * 
 * Strategy: Inject a script into page context to access ytInitialData,
 * extract videos, and post back via CustomEvent.
 */

(function() {
  'use strict';

  // Run gating - prevent duplicate runs
  let isCollecting = false;
  let lastCollectionTime = 0;
  const DEBOUNCE_MS = 500;

  /**
   * HomepageSeed schema:
   * {
   *   videoId: string,
   *   title: string,
   *   channelId: string,
   *   channelName: string,
   *   viewCountText: string,      // "1.2M views"
   *   publishedTimeText: string,  // "2 days ago"
   *   durationText: string,       // "12:34"
   *   thumbnailUrl: string,
   *   href: string,
   *   rank: number                // 1..20
   * }
   */

  /**
   * Inject script into page context to extract ytInitialData
   * Uses external script file to bypass CSP restrictions on inline scripts
   */
  function injectYtDataExtractor() {
    // Check if already injected
    if (document.getElementById('bias-lens-yt-extractor')) {
      return;
    }

    const script = document.createElement('script');
    script.id = 'bias-lens-yt-extractor';
    // Use external script file to bypass CSP - this is the key fix!
    script.src = chrome.runtime.getURL('homepage/ytdata-extractor.js');

    try {
      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      console.error('[HomepageCollector] Script injection failed:', err);
    }
  }

  /**
   * Wait for ytInitialData to be populated (poll with timeout)
   */
  function waitForYtInitialData(maxWaitMs = 5000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      function check() {
        // Try to trigger extraction
        if (window.__biasLensExtract) {
          window.__biasLensExtract();
        } else {
          injectYtDataExtractor();
        }

        // Check if we've waited too long
        if (Date.now() - startTime > maxWaitMs) {
          resolve({ seeds: [], error: 'Timeout waiting for ytInitialData' });
        } else {
          // Re-inject and wait a bit more
          setTimeout(check, 200);
        }
      }

      check();
    });
  }

  /**
   * Main collection function - extracts 20 homepage videos
   * Returns Promise<{ seeds: HomepageSeed[], error: string | null }>
   */
  async function collectHomepageSeeds() {
    // Run gating
    const now = Date.now();
    if (isCollecting) {
      console.log('[HomepageCollector] Collection already in progress, skipping');
      return { seeds: [], error: 'Collection in progress' };
    }
    if (now - lastCollectionTime < DEBOUNCE_MS) {
      console.log('[HomepageCollector] Debounced, skipping');
      return { seeds: [], error: 'Debounced' };
    }

    isCollecting = true;
    lastCollectionTime = now;
    console.log('[HomepageCollector] Starting collection...');

    return new Promise((resolve) => {
      // Set up one-time listener for the extraction result
      const handler = (event) => {
        window.removeEventListener('bias-lens-yt-data', handler);
        isCollecting = false;

        const { seeds, error } = event.detail || {};
        
        if (error) {
          console.error('[HomepageCollector] Extraction error:', error);
          resolve({ seeds: [], error });
          return;
        }

        if (!seeds || seeds.length === 0) {
          console.warn('[HomepageCollector] No seeds extracted');
          resolve({ seeds: [], error: 'No videos found' });
          return;
        }

        // Ensure exactly 20 (or less if not available)
        const finalSeeds = seeds.slice(0, 20);
        console.log(`[HomepageCollector] Collected ${finalSeeds.length} seeds`);
        
        resolve({ seeds: finalSeeds, error: null });
      };

      window.addEventListener('bias-lens-yt-data', handler);

      // Inject extractor script
      injectYtDataExtractor();

      // Timeout fallback
      setTimeout(() => {
        window.removeEventListener('bias-lens-yt-data', handler);
        if (isCollecting) {
          isCollecting = false;
          console.error('[HomepageCollector] Timeout');
          resolve({ seeds: [], error: 'Extraction timeout' });
        }
      }, 5000);
    });
  }

  /**
   * Send seeds to background script
   */
  async function sendSeedsToBackground(seeds) {
    if (!seeds || seeds.length === 0) {
      console.warn('[HomepageCollector] No seeds to send');
      return null;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'HOMEPAGE_SEEDS',
        seeds: seeds
      });
      return response;
    } catch (err) {
      console.error('[HomepageCollector] Failed to send seeds:', err);
      return null;
    }
  }

  /**
   * Full collection pipeline
   */
  async function runCollection() {
    const { seeds, error } = await collectHomepageSeeds();
    
    if (error || seeds.length === 0) {
      return { success: false, error: error || 'No seeds collected', seeds: [] };
    }

    // Send to background for enrichment
    const response = await sendSeedsToBackground(seeds);
    
    return { 
      success: true, 
      seeds,
      backgroundResponse: response 
    };
  }

  // Expose to window for content.js to use
  window.HomepageCollector = {
    collect: collectHomepageSeeds,
    sendToBackground: sendSeedsToBackground,
    run: runCollection,
    isCollecting: () => isCollecting
  };

  console.log('[HomepageCollector] Module loaded');
})();
