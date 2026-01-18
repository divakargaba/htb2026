---
name: Homepage Bias Lens Implementation
overview: ""
todos: []
---

# Homepage Bias Lens Implementation

A non-invasive bias analysis layer for YouTube's homepage. When enabled, it explains why videos are being amplified (Noise) and surfaces hidden gems (Silenced) from the same topics.

---

## Architecture Overview

```mermaid
flowchart TB
    subgraph ContentScript [Content Script - content.js]
        Toggle[Bias Lens Toggle]
        TabBar[Noise/Silenced Tab Bar]
        CardOverlay[Video Card Overlays]
        HoverPopover[Hover Breakdown Popover]
        BiasPanel[Feed Bias Panel]
        SilencedGrid[Silenced Feed Grid]
    end
    
    subgraph Background [Background Worker - background.js]
        BatchQueue[Request Queue]
        Cache[Chrome Storage Cache]
        ScoreAggregator[Score Aggregator]
    end
    
    subgraph Scoring [scoring.js - NEW]
        AAS[Algorithmic Advantage Score]
        MS[Manipulation Score]
        CIS[Commercial Influence Score]
        QS[Quality Score]
        VS[Visibility Score]
    end
    
    subgraph Analysis [analysis/ - NEW]
        ThumbnailAnalyzer[thumbnail.js]
        TitleAnalyzer[title.js]
        TranscriptAnalyzer[transcript.js]
        TopicClusterer[topics.js]
    end
    
    subgraph Backend [Supabase Edge Functions]
        AnalyzeEndpoint[/analyze-homepage]
        DiscoverEndpoint[/discover-silenced]
        GeminiExplain[Gemini Explanations]
    end
    
    ContentScript --> Background
    Background --> Scoring
    Background --> Analysis
    Background --> Backend
    Backend --> GeminiExplain
```

---

## File Structure

```
extension/
├── manifest.json           # Update permissions
├── content.js              # REWRITE: Homepage UI injection
├── background.js           # MODIFY: Add homepage analysis
├── overlay.css             # REWRITE: Native YouTube styling
├── scoring.js              # NEW: Three-tier scoring engine
├── analysis/
│   ├── thumbnail.js        # NEW: Vision-based thumbnail analysis
│   ├── title.js            # NEW: NLP title analysis
│   ├── transcript.js       # NEW: Transcript fetching + analysis
│   └── topics.js           # NEW: Topic clustering
└── ui/
    ├── toggle.js           # NEW: Bias Lens toggle
    ├── tabbar.js           # NEW: Noise/Silenced tabs
    ├── card-overlay.js     # NEW: Per-video tags + hover
    ├── bias-panel.js       # NEW: Feed analytics panel
    └── silenced-grid.js    # NEW: Alternative feed renderer

supabase/functions/
├── analyze-homepage/       # NEW: Batch video analysis
│   └── index.ts
└── discover-silenced/      # NEW: Hidden gem discovery
    └── index.ts
```

---

## Phase 1: Scoring Engine (`scoring.js`)

### 1.1 Bias Score Formula

```javascript
// Final Bias Score for Noise tab
BiasScore = 0.55 * AAS + 0.25 * MS + 0.20 * CIS

// Silenced Score for hidden gems
SilencedScore = clamp(0, 100, 0.7 * QualityScore + 0.3 * (QualityScore - VisibilityScore + 50))
```

### 1.2 Algorithmic Advantage Score (AAS) Components

| Component | Weight | Features |

|-----------|--------|----------|

| CTR Proxy | 26% | Thumbnail click magnet, title curiosity gaps, shock phrasing |

| Retention Proxy | 26% | Duration sweet spot, WPM, hook density, cliffhanger patterns |

| Personalization Fit | 18% | Similarity to today's feed topic profile |

| Engagement Strength | 12% | Like/view ratio, comment/view ratio, normalized by channel |

| Authority | 10% | log(subscribers), channel age, upload consistency |

| Recency/Trend | 8% | Age, velocity, topic repetition in feed |

### 1.3 Manipulation Score (MS) Components

| Component | Weight | Features |

|-----------|--------|----------|

| Thumbnail Abuse | 50% | Text density, arrows/circles, shock faces, saturation extremes |

| Title Bait | 35% | Bait phrases, punctuation intensity, ambiguity hooks |

| Title-Transcript Mismatch | 15% | Semantic similarity between promise and delivery |

### 1.4 Commercial Influence Score (CIS) Components

| Component | Weight | Features |

|-----------|--------|----------|

| Sponsor Detection | 40% | Description patterns, #ad, "paid promotion" label |

| Corporate Signals | 35% | Brand channel patterns, verified labels, institutional naming |

| Monetization Friendliness | 25% | Advertiser-safe style, product framing density |

### 1.5 Quality Score (for Silenced) Components

| Component | Weight | Features |

|-----------|--------|----------|

| Relevance to Noise Topics | 35% | Embedding similarity to feed topic profile |

| Depth and Substance | 20% | Concept density, source citations, structured explanations |

| Constructive Engagement | 15% | Question ratio, long comments, "underrated" signals |

| Production Quality | 10% | Transcript cleanliness, pacing consistency |

| Novelty | 10% | New creator cluster, different angle on topic |

| Low Manipulation | 10% | Inverse of thumbnail/title bait scores |

---

## Phase 2: Analysis Modules

### 2.1 Thumbnail Analysis (`analysis/thumbnail.js`)

**Input:** Thumbnail URL

**Output:** Abuse score 0-100 + feature breakdown

Features to detect:

- Text density (OCR or edge detection)
- All-caps ratio in detected text
- Arrow/circle presence (shape detection)
- Face detection + emotion intensity (expression classifier)
- Saturation/contrast extremes (color histogram)
- Template similarity to known viral patterns
```javascript
// Output structure
{
  abuseScore: 78,
  features: {
    textDensity: 0.42,
    hasArrows: true,
    hasCircles: false,
    faceCount: 2,
    emotionIntensity: 0.85,
    saturationExtreme: true,
    contrastExtreme: false
  },
  tags: ["Text Heavy", "Shock Face", "High Saturation"]
}
```


### 2.2 Title Analysis (`analysis/title.js`)

**Input:** Video title

**Output:** Bait score 0-100 + feature breakdown

Bait phrase patterns:

```javascript
const BAIT_PHRASES = [
  /you won't believe/i, /i tried/i, /shocking/i, /exposed/i,
  /insane/i, /this happened/i, /they did what/i, /gone wrong/i,
  /must see/i, /can't believe/i, /finally revealed/i
]
```

Features:

- Punctuation intensity (!!!, ???)
- Caps ratio
- Ambiguity hooks ("this", "they", "what happened")
- Curiosity gap detection
- Extreme language density

### 2.3 Transcript Analysis (`analysis/transcript.js`)

**Fetching:** Use YouTube timedtext endpoint (no quota)

```javascript
async function fetchTranscript(videoId) {
  // Try multiple language codes
  const langs = ['en', 'en-US', 'en-GB', '']
  for (const lang of langs) {
    const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      if (data.events?.length) {
        return extractText(data.events)
      }
    }
  }
  return null // Transcript unavailable
}
```

**Analysis outputs:**

- WPM (words per minute)
- Hook density in first 120 seconds
- Cliffhanger frequency
- Concept density (unique nouns per minute)
- Source citation count ("according to", "study shows", URLs)
- Structured explanation markers ("first", "next", "here's why")

### 2.4 Topic Clustering (`analysis/topics.js`)

**Input:** List of video titles + transcripts

**Output:** Topic map with 6-10 clusters

```javascript
// Build today's interest profile from Noise feed
{
  topics: [
    { name: "AI tools", weight: 0.28, videos: [1, 5, 12] },
    { name: "coding tutorials", weight: 0.22, videos: [3, 8] },
    { name: "tech news", weight: 0.18, videos: [2, 9, 14] }
  ],
  channelLoop: ["MKBHD", "Fireship", "TechLinked"],
  styleProfile: {
    avgDuration: 612,
    avgManipulation: 45
  }
}
```

---

## Phase 3: Content Script UI

### 3.1 Bias Lens Toggle (`ui/toggle.js`)

**Placement:** Top-right masthead, near user avatar

```html
<button id="bias-lens-toggle" class="bias-lens-off">
  <span class="bias-lens-icon">◉</span>
  <span class="bias-lens-label">Bias Lens</span>
</button>
```

States:

- OFF: Subtle outline pill, gray icon
- ON: Filled pill, green dot indicator

Behavior:

- Click toggles state
- Persist to `chrome.storage.local`
- ON triggers immediate homepage instrumentation

### 3.2 Noise/Silenced Tab Bar (`ui/tabbar.js`)

**Placement:** Between category chips and first video row

```html
<div id="bias-tabs" class="bias-tabs-container">
  <button class="bias-tab active" data-tab="noise">Noise</button>
  <button class="bias-tab" data-tab="silenced">Silenced</button>
</div>
```

Styling:

- Same font as YouTube (Roboto)
- Same dark theme colors (#0f0f0f, #272727)
- Slim rectangles, not full width
- Active tab has subtle bottom border accent

### 3.3 Card Overlay (`ui/card-overlay.js`)

**Per-video elements:**

```html
<div class="bias-overlay" data-video-id="abc123">
  <div class="bias-score-pill">Bias 78</div>
  <div class="bias-tags">
    <span class="bias-tag" style="--tag-color: #f97316">Click Magnet +18</span>
    <span class="bias-tag" style="--tag-color: #ef4444">Retention Trap +15</span>
    <span class="bias-tag" style="--tag-color: #8b5cf6">Authority Boost +10</span>
  </div>
</div>
```

**Tag generation (dynamic per user choice):**

```javascript
function generateTags(contributions) {
  // Sort by contribution value, take top 3-4
  return contributions
    .sort((a, b) => b.value - a.value)
    .slice(0, 4)
    .map(c => ({
      text: `${c.label} +${c.value}`,
      color: c.color
    }))
}
```

### 3.4 Hover Popover

**Trigger:** Mouseenter with 300ms debounce

**Position:** Anchored to card, smart positioning to avoid overflow

```html
<div class="bias-popover">
  <div class="popover-header">
    <span class="popover-score">Bias 78</span>
    <span class="popover-confidence">Confidence 0.82</span>
  </div>
  
  <div class="popover-breakdown">
    <div class="breakdown-title">Score Breakdown</div>
    <div class="breakdown-item">
      <span class="item-label">CTR Proxy</span>
      <div class="item-bar" style="--value: 72"></div>
      <span class="item-value">+18</span>
    </div>
    <!-- More items... -->
  </div>
  
  <div class="popover-metrics">
    <div class="metric">Views: 1.8M</div>
    <div class="metric">Subs: 8.3M</div>
    <div class="metric">Age: 2d</div>
    <div class="metric">Velocity: High</div>
    <div class="metric">Thumb Abuse: 84</div>
    <div class="metric">Sponsor: Detected</div>
  </div>
  
  <div class="popover-explanations">
    <div class="explanation">
      <span class="exp-label">CTR Proxy +18:</span>
      <span class="exp-text">Thumbnail shows 2 high-emotion faces with 42% text coverage, matching patterns that achieve 3.2x higher click rates.</span>
    </div>
    <!-- More explanations from Gemini... -->
  </div>
</div>
```

### 3.5 Feed Bias Panel (`ui/bias-panel.js`)

**Placement:** Fixed top-right, collapsible

```html
<div id="bias-panel" class="bias-panel collapsed">
  <div class="panel-header" onclick="togglePanel()">
    <span class="panel-title">Feed Analysis</span>
    <span class="panel-toggle">▼</span>
  </div>
  
  <div class="panel-summary">
    <div class="summary-stat">
      <span class="stat-value">68</span>
      <span class="stat-label">Avg Bias</span>
    </div>
    <div class="summary-stat">
      <span class="stat-value">72%</span>
      <span class="stat-label">High Bias</span>
    </div>
    <div class="summary-stat">
      <span class="stat-value">4</span>
      <span class="stat-label">Channels</span>
    </div>
  </div>
  
  <div class="panel-details">
    <!-- Expanded view with full analytics -->
    <div class="detail-section">
      <div class="section-title">Topic Dominance</div>
      <div class="topic-bar" data-topic="AI Tools" data-pct="28"></div>
      <div class="topic-bar" data-topic="Tech News" data-pct="22"></div>
      <!-- More topics... -->
    </div>
    
    <div class="detail-section">
      <div class="section-title">Channel Concentration</div>
      <div class="concentration-chart"><!-- D3 or CSS chart --></div>
      <div class="concentration-text">Top 5 channels: 62% of feed</div>
    </div>
    
    <!-- More sections: Manipulation prevalence, Commercial prevalence, etc. -->
  </div>
</div>
```

### 3.6 Silenced Grid (`ui/silenced-grid.js`)

When Silenced tab is active:

- Hide YouTube's native video grid (display: none)
- Render alternative grid in same container
- Same card styling as YouTube
```html
<div id="silenced-feed" class="silenced-grid">
  <div class="silenced-card" data-video-id="xyz789">
    <div class="card-thumbnail">
      <img src="..." />
      <span class="card-duration">12:34</span>
    </div>
    <div class="card-details">
      <div class="card-title">Understanding Neural Networks - Deep Dive</div>
      <div class="card-channel">3Blue1Brown</div>
      <div class="card-meta">45K views · 2 months ago</div>
    </div>
    <div class="silenced-scores">
      <span class="quality-pill">Quality 86</span>
      <span class="silenced-pill">Silenced 72</span>
      <span class="gap-pill">Gap +34</span>
    </div>
    <div class="silenced-tags">
      <span class="silenced-tag positive">High depth, 12 sources cited</span>
      <span class="silenced-tag positive">Strong engagement ratio</span>
    </div>
    <div class="silenced-reason">
      <span class="reason-label">Why buried:</span>
      <span class="reason-text">Weak click packaging despite strong depth signals</span>
    </div>
  </div>
</div>
```


---

## Phase 4: Background Worker Updates

### 4.1 Homepage Analysis Flow

```javascript
// In background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeHomepage') {
    analyzeHomepageVideos(request.videoIds, request.feedContext)
      .then(results => sendResponse({ success: true, data: results }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }
  
  if (request.action === 'discoverSilenced') {
    discoverSilencedVideos(request.topicMap, request.excludedChannels)
      .then(results => sendResponse({ success: true, data: results }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true
  }
})
```

### 4.2 Progressive Enrichment Strategy

```javascript
async function analyzeHomepageVideos(videoIds, feedContext) {
  // Layer 1: Instant (DOM-only)
  const instantResults = await computeInstantScores(videoIds)
  
  // Layer 2: Fast (API stats, 24 videos max)
  const fastResults = await enrichWithStats(instantResults.slice(0, 24))
  
  // Layer 3: Deep (transcripts for top videos only)
  const deepCandidates = fastResults
    .filter(v => v.biasScore > 60 || v.isHovered)
    .slice(0, 12)
  const deepResults = await enrichWithTranscripts(deepCandidates)
  
  return mergeResults(instantResults, fastResults, deepResults)
}
```

### 4.3 Caching Strategy

```javascript
const CACHE_TTL = {
  channelStats: 24 * 60 * 60 * 1000,  // 24 hours
  videoStats: 6 * 60 * 60 * 1000,      // 6 hours
  transcripts: 7 * 24 * 60 * 60 * 1000, // 7 days
  thumbnailAnalysis: 7 * 24 * 60 * 60 * 1000, // 7 days
  silencedPool: 6 * 60 * 60 * 1000     // 6 hours
}
```

---

## Phase 5: Backend Endpoints

### 5.1 `/analyze-homepage` Endpoint

**Input:**

```json
{
  "videoIds": ["abc123", "def456", ...],
  "feedContext": {
    "topicProfile": [...],
    "channelLoop": [...]
  }
}
```

**Output:**

```json
{
  "videos": [
    {
      "videoId": "abc123",
      "biasScore": 78,
      "confidence": 0.82,
      "scores": {
        "aas": 72,
        "ms": 84,
        "cis": 45
      },
      "contributions": [
        { "factor": "CTR Proxy", "value": 18, "color": "#f97316" },
        { "factor": "Retention Proxy", "value": 15, "color": "#ef4444" }
      ],
      "metrics": {
        "views": 1800000,
        "subs": 8300000,
        "age": "2d",
        "velocity": "high",
        "thumbAbuse": 84,
        "sponsorDetected": true
      },
      "explanations": [
        {
          "factor": "CTR Proxy",
          "text": "Thumbnail shows 2 high-emotion faces with 42% text coverage..."
        }
      ],
      "tags": ["Click Magnet +18", "Retention Trap +15", "Authority Boost +10"]
    }
  ],
  "feedAnalysis": {
    "avgBias": 68,
    "distribution": { "high": 0.72, "medium": 0.20, "low": 0.08 },
    "topicDominance": [...],
    "channelConcentration": 0.62,
    "manipulationPrevalence": 0.45,
    "commercialPrevalence": 0.28
  }
}
```

### 5.2 `/discover-silenced` Endpoint

**Input:**

```json
{
  "topicMap": [
    { "name": "AI tools", "weight": 0.28, "keywords": [...] }
  ],
  "excludedChannels": ["UCxyz", "UCabc"],
  "filters": {
    "minViews": 10000,
    "minSubs": 10000,
    "requireTranscript": true
  }
}
```

**Output:**

```json
{
  "videos": [
    {
      "videoId": "xyz789",
      "title": "Understanding Neural Networks - Deep Dive",
      "channel": "3Blue1Brown",
      "thumbnail": "...",
      "qualityScore": 86,
      "silencedScore": 72,
      "exposureGap": 34,
      "whyGood": [
        "High depth score: 12 sources cited",
        "Strong engagement ratio: 4.2% vs 1.8% avg"
      ],
      "whyBuried": [
        "Weak click packaging (thumb abuse 22 vs avg 58)",
        "Lower velocity despite quality signals"
      ]
    }
  ]
}
```

---

## Phase 6: Gemini Integration for Explanations

### 6.1 Explanation Generation Prompt

```javascript
const EXPLANATION_PROMPT = `
You are explaining why a YouTube video has algorithmic advantages. 
Generate ONE sentence per factor that:
- References specific numbers provided
- Explains WHY this helps amplification
- Uses no generic adjectives
- Is under 25 words

Video: "${title}"
Factor: ${factor}
Value: ${value}
Metrics: ${JSON.stringify(metrics)}

Write the explanation sentence:
`
```

### 6.2 Rate Limiting

- Only generate explanations for hovered videos
- Cache explanations for 7 days
- Batch explanations for top 6 videos in background
- Fallback to template if Gemini fails

---

## Styling Guidelines

### Color Palette (YouTube-native dark theme)

```css
:root {
  --bg-primary: #0f0f0f;
  --bg-secondary: #272727;
  --bg-hover: #3f3f3f;
  --text-primary: #f1f1f1;
  --text-secondary: #aaa;
  --accent-noise: #f97316;    /* Orange for bias */
  --accent-silenced: #10b981; /* Green for quality */
  --accent-warning: #ef4444;  /* Red for high manipulation */
}
```

### Typography (Match YouTube)

```css
.bias-element {
  font-family: "YouTube Sans", "Roboto", sans-serif;
  font-size: 12px;
  line-height: 1.4;
}
```

---

## Performance Targets

| Metric | Target |

|--------|--------|

| Toggle response | < 50ms |

| Initial tags render | < 200ms |

|