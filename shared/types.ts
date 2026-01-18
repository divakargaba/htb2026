/**
 * Silenced by the Algorithm - Shared Type Definitions
 * Schema Version: 3.1.0
 *
 * MIGRATION NOTES:
 * - v3.0 → v3.1: Added explainReasons, biasSnapshot, whySurfaced
 * - All new fields are OPTIONAL for backward compatibility
 * - Frontend should use optional chaining (?.) for new fields
 */

export const SCHEMA_VERSION = '3.2.0' // Updated for perspective search

// ============================================
// EXPOSURE ADVANTAGE SCORE (replaces NoiseScore)
// ============================================

export interface ExposureTier {
  min: number
  max: number
  label: 'Under-represented' | 'Emerging' | 'Established' | 'Amplified' | 'Dominant'
  color: string
  description: string
}

export interface ExposureBreakdown {
  reach: { score: number; weight: number; metric: string }
  velocity: { score: number; weight: number; metric: string }
  frequency: { score: number; weight: number; metric: string }
  recency: { score: number; weight: number; metric: string }
}

export interface RawMetrics {
  subscriberCount: number
  viewCount: number
  likeCount: number
  commentCount: number
  engagementRatio: number
  avgViewsPerVideo: number
  viewsPerDay: number
  duration: number
  recentUploads: number
}

export interface ExposureAdvantageScore {
  totalScore: number
  exposureTier: ExposureTier
  /** @deprecated Use exposureTier instead */
  noiseLevel?: ExposureTier
  isAdvantaged: boolean
  /** New in v3.1 - human-readable reasons for the score */
  explainReasons?: string[]
  breakdown: ExposureBreakdown
  rawMetrics: RawMetrics
}

// ============================================
// SUSTAINABILITY AUDIT (KPMG-aligned)
// ============================================

export interface SustainabilityFlag {
  type: 'warning' | 'caution' | 'info' | 'positive'
  text: string
}

export interface SustainabilitySignals {
  evidence: string[]
  equity: string[]
  greenwash: string[]
  corporate: string[]
}

export interface SustainabilityAuditResult {
  transparencyScore: number
  tier: 'verified' | 'partial' | 'caution' | 'unverified'
  tierColor: string
  flags: SustainabilityFlag[]
  signals: SustainabilitySignals
  matchedKeywords: string[]
  category: string
}

export interface SustainabilityAudit {
  isSustainability: boolean
  auditResult: SustainabilityAuditResult | null
}

// ============================================
// BIAS SNAPSHOT (Topic-level metrics)
// New in v3.1
// ============================================

export interface BiasSnapshot {
  /** % of total reach held by top 10 channels */
  topicConcentration: number
  /** % of channels under 100K subs */
  underAmplifiedRate: number
  /** Count of channels over 1M subs */
  dominantCount: number
  /** Count of channels under 100K subs */
  silencedCount: number
  /** Total channels analyzed */
  totalChannels: number
  /** Average subscribers in topic */
  avgSubscribers: number
}

// ============================================
// VIDEO & CHANNEL
// ============================================

export interface VideoData {
  id: string
  title: string
  channel: string
  channelId: string
  thumbnail?: string
  categoryId?: string
  publishedAt?: string
}

export interface ChannelData {
  id?: string
  title?: string
  thumbnail?: string
  subscriberCount: number
  videoCount?: number
}

// ============================================
// UNMUTED VIDEO (Silenced alternative)
// ============================================

export interface UnmutedVideo {
  videoId: string
  title: string
  description?: string
  thumbnail: string
  channelId: string
  channelTitle: string
  publishedAt?: string
  subscriberCount: number
  isRisingSignal: boolean
  /** New in v3.1 - explains why this video was surfaced */
  whySurfaced?: string[]
  engagementRatio?: number
  /** @deprecated Use whySurfaced instead */
  silenceReason?: string
}

export interface ChannelToMute {
  id: string
  name: string
  subscribers: number
  tier: 'dominant' | 'amplified'
  /** @deprecated Use tier instead */
  noiseLevel?: string
}

// ============================================
// ANALYSIS RESPONSE (from background.js analyzeVideo)
// ============================================

export interface AnalyzeVideoResponse {
  video: VideoData
  channel: ChannelData
  noiseAnalysis: ExposureAdvantageScore
  sustainability: SustainabilityAudit
  quotaUsed: number
  /** Schema version for compatibility checking */
  _schemaVersion?: string
}

// ============================================
// NOISE CANCELLATION RESPONSE (from background.js runNoiseCancellation)
// ============================================

export interface NoiseCancellationResponse {
  query: string
  totalResults: number
  silencedVoicesFound: number
  risingSignalsCount: number
  unmutedVideos: UnmutedVideo[]
  channelsToMute: ChannelToMute[]
  noisyChannelIds: string[]
  /** New in v3.1 - aggregate topic metrics */
  biasSnapshot?: BiasSnapshot
  quotaCost: number
  timestamp: number
  /** Schema version for compatibility checking */
  _schemaVersion?: string
}

// ============================================
// SUPABASE EDGE FUNCTION RESPONSE
// (Currently not actively used, but documented for future)
// ============================================

export interface EdgeFunctionBiasBreakdownItem {
  factor: string
  points: number
  maxPoints: number
  explanation: string
  insight: string
}

export interface GeminiGreenwashingFlag {
  type: 'positive' | 'warning' | 'risk'
  text: string
  evidence?: string
}

export interface AIAnalysisResult {
  enabled: boolean
  transparencyScore?: number
  flags?: GeminiGreenwashingFlag[]
  reason?: string
}

export interface EdgeFunctionGreenwashing {
  score: number
  risk_level: 'low' | 'medium' | 'high'
  flags: string[]
  explanation: string
  /** New in v3.1: AI-powered analysis metadata */
  ai_analysis?: AIAnalysisResult
}

// ============================================
// DIVERSITY METADATA (Embedding-based diversification)
// ============================================

export interface DiversityMetadata {
  /** Algorithm used: 'greedy_cosine' or 'fallback_heuristic' */
  method: 'greedy_cosine' | 'fallback_heuristic'
  /** Cosine similarity threshold used for filtering */
  thresholdUsed: number
  /** Number of candidates that were embedded */
  candidatesEmbedded: number
  /** Original number of candidates before diversification */
  originalCount: number
  /** Final number of selected items */
  selectedCount: number
  /** Number of near-duplicates filtered out */
  duplicatesFiltered?: number
  /** Whether threshold was relaxed to fill quota */
  relaxedThreshold?: boolean
  /** Error message if diversification failed */
  error?: string
}

export interface SilencedAlternative {
  video_id: string
  title: string
  channel: string
  thumbnail: string
  view_count: number
  subscriber_count: number
  silence_score: number
  reasons: string[]
  /** Explanation of why this video was selected (diversification note) */
  diversityNote?: string
}

export interface EdgeFunctionResponse {
  video_data: {
    title: string
    channel: string
    views: number
    likes: number
    comments: number
  }
  bias_analysis: {
    total_score: number
    breakdown: EdgeFunctionBiasBreakdownItem[]
  }
  content_analysis: {
    topic: string
    content_type: string
    educational_value: number
    depth_score: number
    sensationalism: number
    clickbait_indicators: string[]
  }
  sustainability: {
    is_sustainability: boolean
    matched_keywords: string[]
    confidence: number
    greenwashing: EdgeFunctionGreenwashing | null
  }
  silenced_alternatives: SilencedAlternative[]
  /** New in v3.1: Embedding-based diversification metadata */
  diversity?: DiversityMetadata
  transcript_analysis: {
    claims_count: number
    sources_cited: number
    specificity_score: number
    key_claims: string[]
    topic_coverage: number
  } | null
  /** Error field if something went wrong */
  error?: string
  /** Schema version for compatibility checking */
  _schemaVersion?: string
}

// ============================================
// MESSAGE TYPES (Chrome extension IPC)
// ============================================

export type MessageAction =
  | 'analyze'
  | 'cancelNoise'
  | 'discover'
  | 'getChannel'
  | 'getChannelByHandle'
  | 'searchSilencedCreators'
  | 'checkNoiseLevel'
  | 'checkMonopoly'
  | 'getQuotaStatus'
  | 'setNoiseCancellation'
  | 'getNoiseCancellation'
  | 'toggleNoiseCancellation'

export interface AnalyzeMessage {
  action: 'analyze'
  videoId: string
  transcript?: string
}

export interface CancelNoiseMessage {
  action: 'cancelNoise' | 'discover'
  query: string
}

export interface MessageResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// ============================================
// HEALTH CHECK TYPES
// ============================================

export interface GeminiHealthStatus {
  available: boolean
  hasApiKey: boolean
  error?: string
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  version: string
  schemaVersion: string
  timestamp: string
  config: {
    hasYouTubeKey: boolean
    mlFeaturesEnabled: boolean
    demoMode: boolean
  }
  services: {
    gemini: GeminiHealthStatus
  }
}

// ============================================
// UTILITY TYPES
// ============================================

/** Helper to make all nested properties optional for partial updates */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

// ============================================
// PERSPECTIVE SEARCH (New in v3.2.0)
// ============================================

export interface PerspectiveBucket {
  label: 'Mainstream / Practical' | 'Critical / Contextual' | 'Alternative / Long-term'
  rationale: string
  videos: UnmutedVideo[]
}

export interface PerspectiveSearchResponse {
  perspectives: PerspectiveBucket[]
  debug?: {
    totalCandidates?: number
    classifiedCount?: number
    fallbackUsed?: boolean
  }
  _schemaVersion?: string
}

export interface PerspectiveSearchRequest {
  query: string
  mode: 'perspective_search'
  maxPerPerspective?: number
}

/** Helper for migrating old field names to new ones */
export function migrateResponse<T extends { _schemaVersion?: string }>(
  response: T,
  currentVersion: string = SCHEMA_VERSION
): T {
  return {
    ...response,
    _schemaVersion: response._schemaVersion || currentVersion
  }
}
