/**
 * Thumbnail Analysis Module
 * 
 * Vision-based analysis of YouTube thumbnails to detect:
 * - Text density and all-caps usage
 * - Arrows, circles, and visual manipulation
 * - Face detection and emotion intensity
 * - Color saturation/contrast extremes
 * - Template similarity to viral patterns
 */

;(function() {
'use strict';

// ============================================
// CONSTANTS
// ============================================

const THUMBNAIL_ANALYSIS_CACHE = new Map()
const THUMBNAIL_CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

// Known viral thumbnail patterns (simplified detection)
const VIRAL_PATTERNS = {
  reactionFace: {
    description: 'Exaggerated reaction face',
    weight: 15
  },
  bigText: {
    description: 'Large text overlay',
    weight: 12
  },
  arrows: {
    description: 'Arrows pointing at something',
    weight: 10
  },
  circles: {
    description: 'Circles highlighting something',
    weight: 10
  },
  beforeAfter: {
    description: 'Before/after split',
    weight: 8
  },
  redBorder: {
    description: 'Red border or frame',
    weight: 8
  },
  moneyShot: {
    description: 'Money, cars, or luxury items',
    weight: 10
  }
}

// ============================================
// IMAGE LOADING
// ============================================

/**
 * Load image from URL into canvas
 */
async function loadImageToCanvas(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      resolve({ canvas, ctx, img })
    }
    
    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    
    // Use a proxy or direct URL
    img.src = imageUrl
  })
}

// ============================================
// COLOR ANALYSIS
// ============================================

/**
 * Analyze color properties of thumbnail
 */
function analyzeColors(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  
  let totalSaturation = 0
  let totalBrightness = 0
  let redPixels = 0
  let yellowPixels = 0
  let highContrastPixels = 0
  let pixelCount = 0
  
  // Sample every 4th pixel for performance
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    
    // Convert to HSL
    const max = Math.max(r, g, b) / 255
    const min = Math.min(r, g, b) / 255
    const l = (max + min) / 2
    
    let s = 0
    if (max !== min) {
      s = l > 0.5 
        ? (max - min) / (2 - max - min)
        : (max - min) / (max + min)
    }
    
    totalSaturation += s
    totalBrightness += l
    
    // Detect red-heavy pixels (common in clickbait)
    if (r > 200 && g < 100 && b < 100) {
      redPixels++
    }
    
    // Detect yellow pixels (attention-grabbing)
    if (r > 200 && g > 200 && b < 100) {
      yellowPixels++
    }
    
    // High contrast detection
    if ((max - min) > 0.5) {
      highContrastPixels++
    }
    
    pixelCount++
  }
  
  const avgSaturation = totalSaturation / pixelCount
  const avgBrightness = totalBrightness / pixelCount
  const redRatio = redPixels / pixelCount
  const yellowRatio = yellowPixels / pixelCount
  const contrastRatio = highContrastPixels / pixelCount
  
  return {
    saturation: avgSaturation,
    brightness: avgBrightness,
    redRatio,
    yellowRatio,
    contrastRatio,
    saturationExtreme: avgSaturation > 0.6,
    contrastExtreme: contrastRatio > 0.4,
    hasRedAccents: redRatio > 0.05,
    hasYellowAccents: yellowRatio > 0.03
  }
}

// ============================================
// TEXT DETECTION (Simplified)
// ============================================

/**
 * Detect text presence using edge detection heuristics
 * (Full OCR would require external API)
 */
function detectTextPresence(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  
  // Convert to grayscale and detect edges
  let edgeCount = 0
  let horizontalEdges = 0
  let verticalEdges = 0
  
  const threshold = 30
  
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = (y * width + x) * 4
      const idxLeft = (y * width + (x - 1)) * 4
      const idxRight = (y * width + (x + 1)) * 4
      const idxUp = ((y - 1) * width + x) * 4
      const idxDown = ((y + 1) * width + x) * 4
      
      const current = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      const left = (data[idxLeft] + data[idxLeft + 1] + data[idxLeft + 2]) / 3
      const right = (data[idxRight] + data[idxRight + 1] + data[idxRight + 2]) / 3
      const up = (data[idxUp] + data[idxUp + 1] + data[idxUp + 2]) / 3
      const down = (data[idxDown] + data[idxDown + 1] + data[idxDown + 2]) / 3
      
      const hDiff = Math.abs(left - right)
      const vDiff = Math.abs(up - down)
      
      if (hDiff > threshold) {
        horizontalEdges++
        edgeCount++
      }
      if (vDiff > threshold) {
        verticalEdges++
        edgeCount++
      }
    }
  }
  
  const totalPixels = (width * height) / 4
  const edgeDensity = edgeCount / totalPixels
  
  // Text typically has high edge density with balanced h/v edges
  const edgeBalance = Math.min(horizontalEdges, verticalEdges) / Math.max(horizontalEdges, verticalEdges, 1)
  
  // High edge density + balanced edges = likely text
  const textLikelihood = edgeDensity * edgeBalance * 100
  
  return {
    edgeDensity,
    edgeBalance,
    textLikelihood: Math.min(100, textLikelihood * 5),
    hasSignificantText: textLikelihood > 0.15
  }
}

// ============================================
// FACE DETECTION (Simplified)
// ============================================

/**
 * Simple skin tone detection as face proxy
 * (Full face detection would require ML model)
 */
function detectFaces(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  
  let skinPixels = 0
  let totalPixels = 0
  
  // Skin tone detection using RGB ranges
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    
    // Multiple skin tone ranges
    const isSkinTone = (
      // Light skin
      (r > 180 && g > 130 && b > 100 && r > g && g > b && r - b > 15) ||
      // Medium skin
      (r > 140 && g > 90 && b > 60 && r > g && g > b && r - b > 20) ||
      // Darker skin
      (r > 80 && g > 50 && b > 30 && r > g && g > b && r - b > 10 && r < 180)
    )
    
    if (isSkinTone) {
      skinPixels++
    }
    totalPixels++
  }
  
  const skinRatio = skinPixels / totalPixels
  
  // Estimate face presence based on skin ratio
  // Thumbnails with faces typically have 5-30% skin tones
  const hasFace = skinRatio > 0.05 && skinRatio < 0.4
  const faceProminence = hasFace ? Math.min(100, skinRatio * 300) : 0
  
  // Estimate face count (very rough)
  const estimatedFaces = skinRatio > 0.15 ? 2 : skinRatio > 0.05 ? 1 : 0
  
  return {
    skinRatio,
    hasFace,
    faceProminence,
    estimatedFaceCount: estimatedFaces,
    // Assume high emotion if large face presence
    emotionIntensity: hasFace ? Math.min(1, skinRatio * 5) : 0
  }
}

// ============================================
// SHAPE DETECTION (Arrows, Circles)
// ============================================

/**
 * Detect common clickbait shapes
 */
function detectShapes(ctx, width, height, colorAnalysis) {
  // Simplified detection based on color patterns
  // Red/yellow concentrated areas often indicate arrows/circles
  
  const hasArrows = colorAnalysis.redRatio > 0.02 || colorAnalysis.yellowRatio > 0.02
  const hasCircles = colorAnalysis.redRatio > 0.03 && colorAnalysis.contrastExtreme
  
  return {
    hasArrows,
    hasCircles,
    hasHighlightShapes: hasArrows || hasCircles
  }
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

/**
 * Analyze a thumbnail and return abuse score + features
 */
async function analyzeThumbnail(thumbnailUrl, videoId) {
  // Check cache first
  const cacheKey = videoId || thumbnailUrl
  const cached = THUMBNAIL_ANALYSIS_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < THUMBNAIL_CACHE_TTL) {
    return cached.data
  }
  
  try {
    const { canvas, ctx, img } = await loadImageToCanvas(thumbnailUrl)
    const width = canvas.width
    const height = canvas.height
    
    // Run all analyses
    const colorAnalysis = analyzeColors(ctx, width, height)
    const textAnalysis = detectTextPresence(ctx, width, height)
    const faceAnalysis = detectFaces(ctx, width, height)
    const shapeAnalysis = detectShapes(ctx, width, height, colorAnalysis)
    
    // Calculate abuse score
    let abuseScore = 0
    const tags = []
    
    // Text density contribution
    if (textAnalysis.hasSignificantText) {
      abuseScore += 15
      tags.push('Text Heavy')
    }
    if (textAnalysis.textLikelihood > 50) {
      abuseScore += 10
      tags.push('Large Text')
    }
    
    // Color manipulation
    if (colorAnalysis.saturationExtreme) {
      abuseScore += 12
      tags.push('High Saturation')
    }
    if (colorAnalysis.contrastExtreme) {
      abuseScore += 10
      tags.push('High Contrast')
    }
    if (colorAnalysis.hasRedAccents) {
      abuseScore += 8
      tags.push('Red Accents')
    }
    if (colorAnalysis.hasYellowAccents) {
      abuseScore += 5
      tags.push('Yellow Accents')
    }
    
    // Face/emotion
    if (faceAnalysis.hasFace) {
      abuseScore += 10
      if (faceAnalysis.emotionIntensity > 0.5) {
        abuseScore += 10
        tags.push('Shock Face')
      } else {
        tags.push('Face Present')
      }
    }
    if (faceAnalysis.estimatedFaceCount >= 2) {
      abuseScore += 5
      tags.push('Multiple Faces')
    }
    
    // Shapes
    if (shapeAnalysis.hasArrows) {
      abuseScore += 10
      tags.push('Arrows')
    }
    if (shapeAnalysis.hasCircles) {
      abuseScore += 8
      tags.push('Circles')
    }
    
    // Cap at 100
    abuseScore = Math.min(100, abuseScore)
    
    const result = {
      abuseScore,
      features: {
        textDensity: textAnalysis.textLikelihood / 100,
        textLikelihood: textAnalysis.textLikelihood,
        hasArrows: shapeAnalysis.hasArrows,
        hasCircles: shapeAnalysis.hasCircles,
        faceCount: faceAnalysis.estimatedFaceCount,
        emotionIntensity: faceAnalysis.emotionIntensity,
        saturationExtreme: colorAnalysis.saturationExtreme,
        contrastExtreme: colorAnalysis.contrastExtreme,
        hasRedAccents: colorAnalysis.hasRedAccents,
        saturation: colorAnalysis.saturation,
        brightness: colorAnalysis.brightness
      },
      tags,
      analyzed: true
    }
    
    // Cache result
    THUMBNAIL_ANALYSIS_CACHE.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    })
    
    return result
    
  } catch (error) {
    console.warn('[Thumbnail] Analysis failed:', error.message)
    
    // Return default values on error
    return {
      abuseScore: 50, // Neutral score
      features: {
        textDensity: 0,
        hasArrows: false,
        hasCircles: false,
        faceCount: 0,
        emotionIntensity: 0,
        saturationExtreme: false,
        contrastExtreme: false
      },
      tags: [],
      analyzed: false,
      error: error.message
    }
  }
}

/**
 * Quick thumbnail analysis without image loading
 * Uses URL patterns and heuristics
 */
function quickThumbnailAnalysis(thumbnailUrl) {
  let abuseScore = 40 // Base score
  const tags = []
  
  // Check for high-quality thumbnail (maxresdefault = more effort = likely more optimized)
  if (thumbnailUrl.includes('maxresdefault')) {
    abuseScore += 10
    tags.push('HD Thumbnail')
  }
  
  // Custom thumbnails often have specific patterns
  if (thumbnailUrl.includes('hqdefault') || thumbnailUrl.includes('mqdefault')) {
    abuseScore += 5
  }
  
  return {
    abuseScore: Math.min(100, abuseScore),
    features: {},
    tags,
    analyzed: false,
    quick: true
  }
}

/**
 * Batch analyze multiple thumbnails
 */
async function batchAnalyzeThumbnails(thumbnails, options = {}) {
  const { maxConcurrent = 3, quickOnly = false } = options
  const results = new Map()
  
  if (quickOnly) {
    // Quick analysis for all
    for (const { url, videoId } of thumbnails) {
      results.set(videoId, quickThumbnailAnalysis(url))
    }
    return results
  }
  
  // Full analysis with concurrency limit
  const queue = [...thumbnails]
  const inProgress = new Set()
  
  while (queue.length > 0 || inProgress.size > 0) {
    // Start new analyses up to limit
    while (queue.length > 0 && inProgress.size < maxConcurrent) {
      const item = queue.shift()
      const promise = analyzeThumbnail(item.url, item.videoId)
        .then(result => {
          results.set(item.videoId, result)
          inProgress.delete(promise)
        })
        .catch(err => {
          results.set(item.videoId, quickThumbnailAnalysis(item.url))
          inProgress.delete(promise)
        })
      inProgress.add(promise)
    }
    
    // Wait for at least one to complete
    if (inProgress.size > 0) {
      await Promise.race(inProgress)
    }
  }
  
  return results
}

// ============================================
// EXPORTS
// ============================================

if (typeof window !== 'undefined') {
  window.ThumbnailAnalyzer = {
    analyzeThumbnail,
    quickThumbnailAnalysis,
    batchAnalyzeThumbnails,
    VIRAL_PATTERNS
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    analyzeThumbnail,
    quickThumbnailAnalysis,
    batchAnalyzeThumbnails,
    VIRAL_PATTERNS
  }
}

})(); // End IIFE
