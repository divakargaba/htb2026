/**
 * ThumbnailAnalyzer - Analyze thumbnail images for clickbait signals
 * 
 * Runs in offscreen document for non-blocking image processing.
 * 
 * Features computed from pixels:
 * - saturation (0..1) - HSL saturation average
 * - contrast (0..1) - luminance variance
 * - redDominance (0..1) - red channel dominance
 * - edgeDensity (0..1) - proxy for text/busy images
 */

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_THUMBNAILS') {
    analyzeThumbnails(message.thumbnails)
      .then(results => sendResponse({ success: true, results }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }
});

/**
 * Analyze multiple thumbnails in parallel
 * @param {Array<{videoId: string, url: string}>} thumbnails
 * @returns {Promise<Object>} Map of videoId -> features
 */
async function analyzeThumbnails(thumbnails) {
  if (!thumbnails || thumbnails.length === 0) {
    return {};
  }

  console.log(`[ThumbnailAnalyzer] Analyzing ${thumbnails.length} thumbnails...`);
  const startTime = Date.now();

  // Process in parallel with error handling
  const results = await Promise.all(
    thumbnails.map(async ({ videoId, url }) => {
      try {
        const features = await analyzeImage(url);
        return { videoId, features };
      } catch (err) {
        console.warn(`[ThumbnailAnalyzer] Failed to analyze ${videoId}:`, err.message);
        return { videoId, features: getDefaultFeatures() };
      }
    })
  );

  // Convert to map
  const featureMap = {};
  for (const { videoId, features } of results) {
    featureMap[videoId] = features;
  }

  console.log(`[ThumbnailAnalyzer] Analysis complete in ${Date.now() - startTime}ms`);
  return featureMap;
}

/**
 * Analyze a single image URL
 * @param {string} url - Thumbnail URL
 * @returns {Promise<Object>} Features object
 */
async function analyzeImage(url) {
  // Fetch image as blob
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  // Create offscreen canvas
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);

  // Get pixel data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  // Compute features
  const saturation = computeSaturation(pixels);
  const contrast = computeContrast(pixels);
  const redDominance = computeRedDominance(pixels);
  const edgeDensity = computeEdgeDensity(imageData);

  return {
    saturation,
    contrast,
    redDominance,
    edgeDensity,
    width: bitmap.width,
    height: bitmap.height
  };
}

/**
 * Compute average saturation (0..1)
 * Uses HSL color model
 */
function computeSaturation(pixels) {
  let totalSaturation = 0;
  let pixelCount = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let s = 0;
    if (max !== min) {
      s = l > 0.5 
        ? (max - min) / (2 - max - min)
        : (max - min) / (max + min);
    }

    totalSaturation += s;
    pixelCount++;
  }

  return pixelCount > 0 ? totalSaturation / pixelCount : 0;
}

/**
 * Compute contrast score (0..1)
 * Based on luminance standard deviation
 */
function computeContrast(pixels) {
  const luminances = [];

  // Sample every 4th pixel for performance
  for (let i = 0; i < pixels.length; i += 16) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    // Standard luminance formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    luminances.push(luminance);
  }

  if (luminances.length === 0) return 0;

  // Compute standard deviation
  const mean = luminances.reduce((a, b) => a + b, 0) / luminances.length;
  const variance = luminances.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / luminances.length;
  const stdDev = Math.sqrt(variance);

  // Normalize to 0..1 (stdDev of 0.5 would be max contrast)
  return Math.min(1, stdDev * 2);
}

/**
 * Compute red channel dominance (0..1)
 * Red/yellow thumbnails are often clickbait
 */
function computeRedDominance(pixels) {
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let pixelCount = 0;

  // Sample every 4th pixel
  for (let i = 0; i < pixels.length; i += 16) {
    redSum += pixels[i];
    greenSum += pixels[i + 1];
    blueSum += pixels[i + 2];
    pixelCount++;
  }

  if (pixelCount === 0) return 0;

  const avgRed = redSum / pixelCount;
  const avgGreen = greenSum / pixelCount;
  const avgBlue = blueSum / pixelCount;
  const total = avgRed + avgGreen + avgBlue;

  if (total === 0) return 0;

  // Red dominance = how much more red than average
  const redRatio = avgRed / total;
  // Normalize: 0.33 (equal) -> 0, 0.5+ -> 1
  return Math.min(1, Math.max(0, (redRatio - 0.33) * 6));
}

/**
 * Compute edge density (0..1) as proxy for text/busy images
 * Uses simple Sobel-like edge detection
 */
function computeEdgeDensity(imageData) {
  const { width, height, data } = imageData;
  
  // Convert to grayscale array
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  let edgeCount = 0;
  const threshold = 30;

  // Simple edge detection: compare pixel to right and bottom neighbors
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = y * width + x;
      const current = gray[idx];
      const right = gray[idx + 1];
      const bottom = gray[idx + width];

      const gradX = Math.abs(current - right);
      const gradY = Math.abs(current - bottom);
      const gradient = gradX + gradY;

      if (gradient > threshold) {
        edgeCount++;
      }
    }
  }

  const totalPixels = (width - 1) * (height - 1);
  // Normalize: 10% edges -> 0.5, 20%+ -> 1
  return Math.min(1, (edgeCount / totalPixels) * 5);
}

/**
 * Default features when analysis fails
 */
function getDefaultFeatures() {
  return {
    saturation: 0.5,
    contrast: 0.5,
    redDominance: 0.3,
    edgeDensity: 0.3,
    width: 0,
    height: 0,
    error: true
  };
}

console.log('[ThumbnailAnalyzer] Offscreen document ready');
