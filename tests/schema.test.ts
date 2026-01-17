/**
 * Schema Validation Tests
 * Run with: deno test tests/schema.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AnalyzeVideoResponse, NoiseCancellationResponse } from "../shared/types.ts";

// ============================================
// TYPE VALIDATION TESTS (compile-time)
// ============================================

// Test AnalyzeVideoResponse shape
const mockAnalyzeResponse: AnalyzeVideoResponse = {
  video: {
    id: "test123",
    title: "Test Video",
    channel: "Test Channel",
    channelId: "UC123",
  },
  channel: {
    subscriberCount: 50000,
  },
  noiseAnalysis: {
    totalScore: 45,
    exposureTier: {
      min: 41,
      max: 60,
      label: "Established",
      color: "#f59e0b",
      description: "Moderate exposure advantage",
    },
    isAdvantaged: false,
    explainReasons: ["Under 100K subs in competitive topic"],
    breakdown: {
      reach: { score: 40, weight: 35, metric: "50K subs" },
      velocity: { score: 50, weight: 25, metric: "10K/day" },
      frequency: { score: 40, weight: 20, metric: "4 uploads/mo" },
      recency: { score: 30, weight: 20, metric: "0.2x sub reach" },
    },
    rawMetrics: {
      subscriberCount: 50000,
      viewCount: 100000,
      likeCount: 5000,
      commentCount: 500,
      engagementRatio: 5.5,
      avgViewsPerVideo: 10000,
      viewsPerDay: 10000,
      duration: 10,
      recentUploads: 4,
    },
  },
  sustainability: {
    isSustainability: false,
    auditResult: null,
  },
  quotaUsed: 5,
  _schemaVersion: "3.1.0",
};

// Test NoiseCancellationResponse shape
const mockNoiseCancellationResponse: NoiseCancellationResponse = {
  query: "climate change",
  totalResults: 50,
  silencedVoicesFound: 20,
  risingSignalsCount: 3,
  unmutedVideos: [
    {
      videoId: "abc123",
      title: "Climate Action Guide",
      thumbnail: "https://example.com/thumb.jpg",
      channelId: "UC456",
      channelTitle: "Eco Educator",
      subscriberCount: 25000,
      isRisingSignal: true,
      whySurfaced: [
        "85% smaller than topic average",
        "Strong engagement ratio (2.1x views per subscriber)",
      ],
    },
  ],
  channelsToMute: [
    {
      id: "UC789",
      name: "Big Climate Corp",
      subscribers: 2000000,
      tier: "dominant",
    },
  ],
  noisyChannelIds: ["UC789"],
  biasSnapshot: {
    topicConcentration: 75,
    underAmplifiedRate: 40,
    dominantCount: 5,
    silencedCount: 20,
    totalChannels: 50,
    avgSubscribers: 500000,
  },
  quotaCost: 102,
  timestamp: Date.now(),
  _schemaVersion: "3.1.0",
};

// Backward compatibility: old fields still work
const legacyCompatibleResponse: NoiseCancellationResponse = {
  query: "test",
  totalResults: 10,
  silencedVoicesFound: 5,
  risingSignalsCount: 1,
  unmutedVideos: [],
  channelsToMute: [],
  noisyChannelIds: [],
  // biasSnapshot optional
  quotaCost: 50,
  timestamp: Date.now(),
  // _schemaVersion optional
};

// ============================================
// RUNTIME VALIDATION HELPERS
// ============================================

function validateSchemaVersion(response: { _schemaVersion?: string }): boolean {
  if (!response._schemaVersion) return true; // legacy ok

  const [major, minor] = response._schemaVersion.split(".").map(Number);
  const [expectedMajor, expectedMinor] = "3.1.0".split(".").map(Number);

  if (major !== expectedMajor) return false;
  // older minor versions are acceptable (backward compat)
  if (minor < expectedMinor) return true;

  return true;
}

function validateAnalyzeResponse(data: unknown): data is AnalyzeVideoResponse {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  if (!obj.video || typeof obj.video !== "object") return false;
  if (!obj.channel || typeof obj.channel !== "object") return false;
  if (!obj.noiseAnalysis || typeof obj.noiseAnalysis !== "object") return false;

  const video = obj.video as Record<string, unknown>;
  if (typeof video.id !== "string" || typeof video.title !== "string") return false;

  const analysis = obj.noiseAnalysis as Record<string, unknown>;
  if (typeof analysis.totalScore !== "number") return false;

  return true;
}

// ============================================
// DENO TESTS
// ============================================

Deno.test("Schema: AnalyzeVideoResponse validates", () => {
  assert(validateSchemaVersion(mockAnalyzeResponse));
  assert(validateAnalyzeResponse(mockAnalyzeResponse));
});

Deno.test("Schema: NoiseCancellationResponse validates and legacy still passes", () => {
  assertEquals(typeof mockNoiseCancellationResponse.query, "string");
  assert(validateSchemaVersion(mockNoiseCancellationResponse));
  assert(validateSchemaVersion(legacyCompatibleResponse));
});
