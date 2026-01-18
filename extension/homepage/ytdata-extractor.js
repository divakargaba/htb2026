/**
 * ytdata-extractor.js - Web-accessible script for ytInitialData extraction
 * 
 * This script runs in YouTube's page context (MAIN world) to access ytInitialData.
 * It's loaded via script.src to bypass CSP restrictions on inline scripts.
 */

(function() {
  'use strict';

  // Debug logging helper - sends to our debug server
  function debugLog(location, message, data) {
    fetch('http://127.0.0.1:7242/ingest/070f4023-0b8b-470b-9892-fdda3f3c5039', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: 'ytdata-extractor.js:' + location,
        message,
        data,
        timestamp: Date.now(),
        sessionId: 'debug-session',
        hypothesisId: 'H6'
      })
    }).catch(() => {});
  }
  
  // Deep search for richGridRenderer contents (handles unknown structures)
  function findRichGridContents(obj, maxDepth = 3, currentDepth = 0) {
    if (!obj || typeof obj !== 'object' || currentDepth > maxDepth) return null;
    
    // Check if this object has richGridRenderer with contents
    if (obj.richGridRenderer?.contents && Array.isArray(obj.richGridRenderer.contents)) {
      return obj.richGridRenderer.contents;
    }
    
    // Check if this IS a richGridRenderer
    if (obj.contents && Array.isArray(obj.contents) && obj.contents[0]?.richItemRenderer) {
      return obj.contents;
    }
    
    // Recurse into object properties
    for (const key of Object.keys(obj)) {
      const result = findRichGridContents(obj[key], maxDepth, currentDepth + 1);
      if (result) return result;
    }
    
    return null;
  }

  function extractAndDispatch() {
    try {
      const data = window.ytInitialData;
      
      // #region agent log H6 - Check ytInitialData existence and structure
      debugLog('extractAndDispatch:start', 'Checking ytInitialData', {
        exists: !!data,
        type: typeof data,
        hasContents: !!data?.contents,
        topLevelKeys: data ? Object.keys(data).slice(0, 10) : []
      });
      // #endregion
      
      if (!data) {
        debugLog('extractAndDispatch:noData', 'ytInitialData is null/undefined', {});
        window.dispatchEvent(new CustomEvent('bias-lens-yt-data', { 
          detail: { error: 'ytInitialData not found', seeds: [] }
        }));
        return;
      }

      // Try multiple paths - YouTube uses different structures
      let contents = null;
      let structurePath = 'unknown';
      
      // Path 1: Traditional homepage structure
      const twoColumnRenderer = data?.contents?.twoColumnBrowseResultsRenderer;
      const tabs = twoColumnRenderer?.tabs;
      const firstTab = tabs?.[0];
      const tabContent = firstTab?.tabRenderer?.content;
      const richGridFromTabs = tabContent?.richGridRenderer?.contents;
      
      if (richGridFromTabs && Array.isArray(richGridFromTabs) && richGridFromTabs.length > 0) {
        contents = richGridFromTabs;
        structurePath = 'twoColumnBrowseResultsRenderer.tabs[0].richGridRenderer';
      }
      
      // Path 2: Direct richGridRenderer in contents (newer layout)
      if (!contents) {
        const directRichGrid = data?.contents?.richGridRenderer?.contents;
        if (directRichGrid && Array.isArray(directRichGrid) && directRichGrid.length > 0) {
          contents = directRichGrid;
          structurePath = 'contents.richGridRenderer';
        }
      }
      
      // Path 3: singleColumnBrowseResultsRenderer (mobile/alternate)
      if (!contents) {
        const singleColumn = data?.contents?.singleColumnBrowseResultsRenderer;
        const scTabs = singleColumn?.tabs;
        const scTabContent = scTabs?.[0]?.tabRenderer?.content;
        const scRichGrid = scTabContent?.richGridRenderer?.contents || scTabContent?.sectionListRenderer?.contents;
        if (scRichGrid && Array.isArray(scRichGrid) && scRichGrid.length > 0) {
          contents = scRichGrid;
          structurePath = 'singleColumnBrowseResultsRenderer';
        }
      }
      
      // Path 4: Deep search for any richGridRenderer (fallback)
      if (!contents) {
        const found = findRichGridContents(data?.contents, 3);
        if (found && found.length > 0) {
          contents = found;
          structurePath = 'deepSearch';
        }
      }
      
      // #region agent log H6 - Check structure paths  
      debugLog('extractAndDispatch:structure', 'Checking data paths', {
        hasTwoColumnRenderer: !!twoColumnRenderer,
        tabsCount: tabs?.length,
        hasFirstTab: !!firstTab,
        hasTabContent: !!tabContent,
        tabContentKeys: tabContent ? Object.keys(tabContent) : [],
        hasRichGrid: !!richGridFromTabs,
        richGridKeys: tabContent?.richGridRenderer ? Object.keys(tabContent.richGridRenderer) : [],
        contentsLength: contents?.length,
        firstContentKeys: contents?.[0] ? Object.keys(contents[0]) : [],
        structurePath,
        contentsTopLevelKeys: data?.contents ? Object.keys(data.contents) : []
      });
      // #endregion

      if (!contents || !Array.isArray(contents) || contents.length === 0) {
        // Log what's actually in contents for debugging
        debugLog('extractAndDispatch:noContents', 'No richGridRenderer contents', {
          contentsType: typeof contents,
          isArray: Array.isArray(contents),
          dataContentsKeys: data?.contents ? Object.keys(data.contents) : [],
          structurePath
        });
        window.dispatchEvent(new CustomEvent('bias-lens-yt-data', { 
          detail: { error: 'No richGridRenderer contents found', seeds: [] }
        }));
        return;
      }

      const seeds = [];
      let rank = 1;
      let skipped = { noRichItem: 0, noVideoRenderer: 0, noVideoId: 0, other: 0 };

      // #region agent log H6 - Log first 3 items structure
      debugLog('extractAndDispatch:firstItems', 'First 3 content items', {
        item0Keys: contents[0] ? Object.keys(contents[0]) : [],
        item1Keys: contents[1] ? Object.keys(contents[1]) : [],
        item2Keys: contents[2] ? Object.keys(contents[2]) : [],
        item0Sample: contents[0] ? JSON.stringify(contents[0]).slice(0, 500) : null
      });
      // #endregion

      for (const item of contents) {
        if (rank > 20) break;

        // Extract richItemRenderer
        const richItemRenderer = item?.richItemRenderer;
        if (!richItemRenderer) {
          skipped.noRichItem++;
          continue;
        }
        
        const content = richItemRenderer?.content;
        if (!content) {
          skipped.noVideoRenderer++;
          continue;
        }
        
        // Try BOTH old (videoRenderer) AND new (lockupViewModel) structures
        const videoRenderer = content.videoRenderer;
        const lockupViewModel = content.lockupViewModel;
        
        let videoId, title, channelName, channelId, viewCountText, publishedTimeText, durationText, thumbnailUrl;
        
        if (videoRenderer) {
          // OLD STRUCTURE: videoRenderer
          videoId = videoRenderer.videoId;
          title = videoRenderer.title?.runs?.[0]?.text || videoRenderer.title?.simpleText || '';
          channelName = videoRenderer.ownerText?.runs?.[0]?.text || videoRenderer.shortBylineText?.runs?.[0]?.text || '';
          channelId = videoRenderer.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
                     videoRenderer.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '';
          viewCountText = videoRenderer.viewCountText?.simpleText || videoRenderer.viewCountText?.runs?.[0]?.text || '';
          publishedTimeText = videoRenderer.publishedTimeText?.simpleText || '';
          durationText = videoRenderer.lengthText?.simpleText ||
                        videoRenderer.thumbnailOverlays?.find(o => o.thumbnailOverlayTimeStatusRenderer)
                          ?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '';
          const thumbnails = videoRenderer.thumbnail?.thumbnails || [];
          thumbnailUrl = thumbnails[thumbnails.length - 1]?.url || thumbnails[0]?.url || '';
          
        } else if (lockupViewModel) {
          // NEW STRUCTURE: lockupViewModel (YouTube 2025+)
          // Extract videoId from contentId or onTap endpoint
          videoId = lockupViewModel.contentId || 
                   lockupViewModel.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
                   lockupViewModel.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url?.match(/v=([^&]+)/)?.[1] || '';
          
          // Extract metadata from lockupViewModel.metadata
          const metadata = lockupViewModel.metadata?.lockupMetadataViewModel;
          title = metadata?.title?.content || '';
          
          // Extract channel info
          const byline = metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0];
          channelName = byline?.text?.content || '';
          channelId = byline?.enableTruncation ? '' : ''; // Channel ID harder to get in new format
          
          // Extract view count and time
          const metaRow = metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[1]?.metadataParts;
          viewCountText = metaRow?.[0]?.text?.content || '';
          publishedTimeText = metaRow?.[2]?.text?.content || '';
          
          // Duration from overlay
          const overlay = lockupViewModel.contentImage?.collectionThumbnailViewModel?.primaryThumbnail
                         ?.thumbnailViewModel?.overlays?.[0]?.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]
                         ?.thumbnailBadgeViewModel?.text || '';
          durationText = overlay || '';
          
          // Thumbnail URL
          const thumbSources = lockupViewModel.contentImage?.collectionThumbnailViewModel?.primaryThumbnail
                              ?.thumbnailViewModel?.image?.sources || [];
          thumbnailUrl = thumbSources[thumbSources.length - 1]?.url || thumbSources[0]?.url || '';
          
          // Log what we found from lockupViewModel
          if (rank <= 3) {
            debugLog('extractAndDispatch:lockupViewModel', 'Extracted from lockupViewModel', {
              rank, videoId, title: title?.slice(0, 30), channelName
            });
          }
        } else {
          // Unknown content type
          const contentKeys = Object.keys(content);
          if (rank <= 5) {
            debugLog('extractAndDispatch:unknownContent', 'Unknown content type', {
              rank, contentKeys
            });
          }
          skipped.noVideoRenderer++;
          continue;
        }

        // Skip if no videoId
        if (!videoId) {
          skipped.noVideoId++;
          continue;
        }

        const href = '/watch?v=' + videoId;

        seeds.push({
          videoId,
          title,
          channelId,
          channelName,
          viewCountText,
          publishedTimeText,
          durationText,
          thumbnailUrl,
          href,
          rank: rank++
        });
      }

      // #region agent log H6 - Final results
      debugLog('extractAndDispatch:result', 'Extraction complete', {
        seedCount: seeds.length,
        skipped,
        firstSeed: seeds[0] ? { videoId: seeds[0].videoId, title: seeds[0].title?.slice(0, 50) } : null
      });
      // #endregion

      window.dispatchEvent(new CustomEvent('bias-lens-yt-data', { 
        detail: { seeds, error: null }
      }));

    } catch (err) {
      debugLog('extractAndDispatch:error', 'Exception caught', { error: err.message, stack: err.stack?.slice(0, 300) });
      window.dispatchEvent(new CustomEvent('bias-lens-yt-data', { 
        detail: { error: err.message, seeds: [] }
      }));
    }
  }

  // Execute immediately
  extractAndDispatch();

  // Expose for manual trigger
  window.__biasLensExtract = extractAndDispatch;
})();
