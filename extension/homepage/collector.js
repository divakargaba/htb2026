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
    // #region agent log H1
    fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'collector.js:injectYtDataExtractor',message:'Attempting external script injection',data:{alreadyInjected:!!document.getElementById('bias-lens-yt-extractor')},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

    // Check if already injected
    if (document.getElementById('bias-lens-yt-extractor')) {
      return;
    }

    const script = document.createElement('script');
    script.id = 'bias-lens-yt-extractor';
    // Use external script file to bypass CSP - this is the key fix!
    script.src = chrome.runtime.getURL('homepage/ytdata-extractor.js');

    // #region agent log H1
    try {
      (document.head || document.documentElement).appendChild(script);
      fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'collector.js:injectYtDataExtractor:postAppend',message:'External script appended to DOM',data:{scriptInDOM:!!document.getElementById('bias-lens-yt-extractor'),scriptSrc:script.src},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
    } catch (err) {
      fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'collector.js:injectYtDataExtractor:error',message:'Script injection failed',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
    }
    // #endregion
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

    // #region agent log H3
    fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'collector.js:collectHomepageSeeds',message:'Starting collection, setting up listener',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion

    return new Promise((resolve) => {
      // Set up one-time listener for the extraction result
      const handler = (event) => {
        // #region agent log H3
        fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'collector.js:handler',message:'Event received!',data:{hasDetail:!!event.detail,seedCount:event.detail?.seeds?.length,error:event.detail?.error},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
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
        // #region agent log H5
        fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'collector.js:timeout',message:'Timeout triggered',data:{isStillCollecting:isCollecting},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        window.removeEventListener('bias-lens-yt-data', handler);
        if (isCollecting) {
          isCollecting = false;
          console.error('[HomepageCollector] Timeout');
          // #region agent log H4 - Try DOM extraction as last resort
          const ytDataScript = document.querySelector('script:not([src])');
          const hasYtInitialData = !!document.querySelector('script')?.textContent?.includes('ytInitialData');
          fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'collector.js:timeout:domCheck',message:'Checking DOM for ytInitialData',data:{hasYtInitialData,scriptTagCount:document.querySelectorAll('script').length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
          // #endregion
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
