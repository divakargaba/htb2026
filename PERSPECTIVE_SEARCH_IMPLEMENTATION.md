# Perspective Search Implementation Summary

## Overview
Added "Perspective Search" feature that groups high-quality videos by perspective/framing on YouTube search results pages. Reuses existing scoring pipeline (quality, engagement, exposure advantage) and adds DeepSeek-based perspective classification.

## Files Changed

### 1. **shared/types.ts**
- Added `PerspectiveBucket` interface
- Added `PerspectiveSearchResponse` interface  
- Added `PerspectiveSearchRequest` interface
- Updated schema version to 3.2.0

### 2. **supabase/functions/_shared/deepseek_prompts.ts** (NEW FILE)
- Created `PERSPECTIVE_CLASSIFIER_PROMPT` constant
- Implemented `classifyPerspective()` function
- Handles DeepSeek API calls with error handling
- Returns perspective bucket classification with confidence and rationale

### 3. **supabase/functions/recommend/index.ts**
- Added import for `classifyPerspective` from deepseek_prompts.ts
- Updated schema version to 3.2.0
- Added `perspective_search` mode handling:
  - Searches YouTube for candidates
  - Calculates quality scores
  - Classifies top 12 candidates using DeepSeek
  - Groups into 3 perspective buckets
  - Returns `PerspectiveSearchResponse`

### 4. **extension/background.js**
- Added feature flag: `ENABLE_PERSPECTIVE_SEARCH = true`
- Added `classifyPerspective()` function (local implementation)
- Added `runPerspectiveSearch()` function:
  - Reuses `runNoiseCancellation()` for candidate retrieval
  - Reuses existing quality scoring pipeline
  - Classifies top 12 candidates (hard cap for cost control)
  - Groups into perspective buckets
  - Handles fallback if DeepSeek unavailable
- Added message handler: `perspectiveSearch` action

### 5. **extension/content.js**
- Added `runSearchPage()` function:
  - Detects search results pages
  - Extracts search query from URL
  - Calls perspective search API
  - Injects UI
- Added `injectPerspectiveSearchUI()` function:
  - Creates collapsed section with header
  - Renders 2-3 perspective buckets
  - Each bucket shows 1-2 video cards
- Added `createPerspectiveVideoCard()` function:
  - Reuses existing card styling
  - Shows thumbnail, title, channel, subs
  - Displays Strength + Limited Reach chips
  - Shows perspective rationale
  - Includes collapsible Bias Receipt
- Added URL change detection for search pages
- Updated `init()` to route to `runSearchPage()` on `/results` pages

## Key Features

### ✅ Reuses Existing Pipeline
- Uses `runNoiseCancellation()` for candidate retrieval
- Uses existing quality scoring (`computeQualityScore`, `twoPassQualityScoring`)
- Uses existing exposure advantage scoring
- Uses existing filters (spam, shorts, reaction videos)
- Uses existing bias receipt generation

### ✅ Perspective Classification
- DeepSeek classifies videos into 3 buckets:
  - **Mainstream / Practical**: Conventional, solution-focused
  - **Critical / Contextual**: Questioning assumptions, analyzing systems
  - **Alternative / Long-term**: Alternative viewpoints, long-term thinking
- Hard cap: Max 12 candidates classified per search (cost control)
- Fallback: If DeepSeek fails, videos go to "Mainstream / Practical" bucket

### ✅ UI Implementation
- Collapsed section on search results page
- Title: "Perspective Search"
- Subtitle: "Multiple high-quality takes on this topic"
- 2-3 buckets displayed
- Each bucket shows 1-2 video cards
- Cards show: thumbnail, title, channel, subs, quality/underexposure chips, perspective rationale, bias receipt

### ✅ Reliability
- Feature flag: `ENABLE_PERSPECTIVE_SEARCH` (default: true)
- Hard cap on DeepSeek calls (12 max)
- Fallback handling if AI unavailable
- URL change detection for search navigation
- Error handling throughout

## Testing

To test:
1. Navigate to YouTube search results page (e.g., `/results?search_query=climate+change`)
2. Extension should detect search page
3. Perspective Search section should appear above search results
4. Should show 2-3 buckets with 1-2 videos each
5. Each video should have quality score, underexposure score, and perspective rationale

## Notes

- The edge function (`recommend/index.ts`) uses simplified scoring since it doesn't have access to the full background.js pipeline
- The main implementation in `background.js` fully reuses the existing scoring pipeline via `runNoiseCancellation()`
- DeepSeek classification is deterministic (temperature: 0.2) for consistent results
- Perspective classification does NOT affect video selection - videos are selected by quality score first, then classified
