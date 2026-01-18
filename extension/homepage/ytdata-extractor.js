/**
 * ytdata-extractor.js - Web-accessible script for ytInitialData extraction
 * 
 * This script runs in YouTube's page context (MAIN world) to access ytInitialData.
 * It's loaded via script.src to bypass CSP restrictions on inline scripts.
 */

(function() {
  'use strict';

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
      
      if (!data) {
        console.warn('[YtDataExtractor] ytInitialData not found');
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

      if (!contents || !Array.isArray(contents) || contents.length === 0) {
        console.warn('[YtDataExtractor] No richGridRenderer contents found via path:', structurePath);
        window.dispatchEvent(new CustomEvent('bias-lens-yt-data', { 
          detail: { error: 'No richGridRenderer contents found', seeds: [] }
        }));
        return;
      }

      const seeds = [];
      let rank = 1;

      for (const item of contents) {
        if (rank > 20) break;

        // Extract richItemRenderer
        const richItemRenderer = item?.richItemRenderer;
        if (!richItemRenderer) continue;
        
        const content = richItemRenderer?.content;
        if (!content) continue;
        
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
          channelId = ''; // Channel ID harder to get in new format - will be fetched via API
          
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
          
        } else {
          // Unknown content type, skip
          continue;
        }

        // Skip if no videoId
        if (!videoId) continue;

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

      console.log(`[YtDataExtractor] Extracted ${seeds.length} videos via ${structurePath}`);

      window.dispatchEvent(new CustomEvent('bias-lens-yt-data', { 
        detail: { seeds, error: null }
      }));

    } catch (err) {
      console.error('[YtDataExtractor] Exception:', err.message);
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
