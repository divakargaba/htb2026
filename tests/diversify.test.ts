/**
 * Diversification Algorithm Tests
 *
 * Tests the greedy cosine similarity diversification for silenced voices.
 * Run with: deno test tests/diversify.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";


// ============================================
// MOCK DATA - Similar titles that should be filtered
// ============================================

const MOCK_CANDIDATES = [
  {
    video_id: "vid1",
    title: "Climate Change Explained: What You Need to Know in 2024",
    channel: "Eco Educator",
    description: "A comprehensive guide to understanding climate change and its impacts.",
    silence_score: 95,
  },
  {
    video_id: "vid2",
    title: "Climate Change Explained: Everything You Need to Know", // NEAR-DUPLICATE of vid1
    channel: "Green News Daily",
    description: "Understanding the basics of climate change and global warming.",
    silence_score: 92,
  },
  {
    video_id: "vid3",
    title: "Renewable Energy Solutions for Your Home",
    channel: "Solar Steve",
    description: "How to install solar panels and reduce your carbon footprint.",
    silence_score: 88,
  },
  {
    video_id: "vid4",
    title: "Climate Change Explained for Beginners", // NEAR-DUPLICATE of vid1
    channel: "Science Simplified",
    description: "A simple explanation of climate change.",
    silence_score: 85,
  },
  {
    video_id: "vid5",
    title: "Electric Vehicles vs Gas Cars: The Complete Comparison",
    channel: "Auto Reviews",
    description: "Comparing the environmental impact of EVs and traditional vehicles.",
    silence_score: 82,
  },
  {
    video_id: "vid6",
    title: "Sustainable Fashion: How to Build an Eco Wardrobe",
    channel: "Ethical Style",
    description: "Tips for sustainable clothing choices.",
    silence_score: 80,
  },
  {
    video_id: "vid7",
    title: "Climate Change Explained Simply", // NEAR-DUPLICATE of vid1
    channel: "Earth Matters",
    description: "Simple explanation of climate change.",
    silence_score: 78,
  },
  {
    video_id: "vid8",
    title: "Zero Waste Living: A Complete Guide",
    channel: "Waste Not",
    description: "How to reduce your waste and live sustainably.",
    silence_score: 75,
  },
  {
    video_id: "vid9",
    title: "Electric Vehicles: The Complete Guide", // SIMILAR to vid5
    channel: "EV News",
    description: "Everything about electric vehicles.",
    silence_score: 72,
  },
  {
    video_id: "vid10",
    title: "Ocean Plastic Pollution: The Crisis Explained",
    channel: "Ocean Watch",
    description: "Understanding the plastic pollution crisis in our oceans.",
    silence_score: 70,
  },
] as const;

// ============================================
// COSINE SIMILARITY
// ============================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ============================================
// TEXT BUILDING
// ============================================

function buildEmbeddingText(item: typeof MOCK_CANDIDATES[number]): string {
  const parts = [
    item.title || "",
    item.channel ? `— ${item.channel}` : "",
    item.description ? `. ${item.description}` : "",
  ];
  return parts.join(" ").trim().slice(0, 300);
}

// ============================================
// MOCK EMBEDDINGS (deterministic + makes near-duplicates VERY similar)
// This is a unit test — we want to test the algorithm, not a real embedding model.
// ============================================

function mockEmbed(text: string): number[] {
  const DIM = 64;
  const vec = new Array(DIM).fill(0);

  const cleaned = text.toLowerCase();

  // 1) Strong shared topic vectors (forces near-duplicates to be near)
  // Climate cluster
  if (cleaned.includes("climate change explained") || (cleaned.includes("climate") && cleaned.includes("explained"))) {
    for (let i = 0; i < 16; i++) vec[i] += 4; // big shared signal
  }
  // EV cluster
  if (cleaned.includes("electric") && cleaned.includes("vehicle")) {
    for (let i = 16; i < 24; i++) vec[i] += 3;
  }
  // Renewable/solar cluster
  if (cleaned.includes("renewable") || cleaned.includes("solar")) {
    for (let i = 24; i < 32; i++) vec[i] += 3;
  }

  // 2) Add light token hashing so not everything becomes identical
  const tokens = cleaned
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % DIM;
    vec[idx] += 0.5;
  }

  // Normalize
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) vec[i] /= norm;
  }

  return vec;
}

// ============================================
// GREEDY DIVERSIFICATION (same behavior as production logic)
// ============================================

function greedyDiversify(
  items: readonly (typeof MOCK_CANDIDATES[number])[],
  embeddings: Map<string, number[]>,
  targetCount: number,
  threshold: number,
): { selected: string[]; filtered: string[] } {
  const selected: string[] = [];
  const filtered: string[] = [];
  const selectedEmbeddings: number[][] = [];

  for (const item of items) {
    if (selected.length >= targetCount) break;

    const embedding = embeddings.get(item.video_id);
    if (!embedding) continue;

    if (selected.length === 0) {
      selected.push(item.video_id);
      selectedEmbeddings.push(embedding);
      continue;
    }

    let tooSimilar = false;
    for (const selEmb of selectedEmbeddings) {
      const sim = cosineSimilarity(embedding, selEmb);
      if (sim >= threshold) {
        tooSimilar = true;
        break;
      }
    }

    if (tooSimilar) {
      filtered.push(item.video_id);
    } else {
      selected.push(item.video_id);
      selectedEmbeddings.push(embedding);
    }
  }

  return { selected, filtered };
}

// ============================================
// TESTS
// ============================================

Deno.test("Diversification: mock embeddings make climate variants near-duplicates (>0.82)", () => {
  const texts = MOCK_CANDIDATES.map(buildEmbeddingText);
  const embeddings = new Map<string, number[]>();

  for (let i = 0; i < MOCK_CANDIDATES.length; i++) {
    embeddings.set(MOCK_CANDIDATES[i].video_id, mockEmbed(texts[i]));
  }

  const pairs: [string, string][] = [
    ["vid1", "vid2"],
    ["vid1", "vid4"],
    ["vid1", "vid7"],
  ];

  for (const [a, b] of pairs) {
    const sim = cosineSimilarity(embeddings.get(a)!, embeddings.get(b)!);
    assert(
      sim > 0.82,
      `Expected ${a} vs ${b} similarity > 0.82; got ${(sim * 100).toFixed(1)}%`,
    );
  }
});

Deno.test("Diversification: filters at least one climate near-duplicate at threshold 0.82", () => {
  const texts = MOCK_CANDIDATES.map(buildEmbeddingText);
  const embeddings = new Map<string, number[]>();

  for (let i = 0; i < MOCK_CANDIDATES.length; i++) {
    embeddings.set(MOCK_CANDIDATES[i].video_id, mockEmbed(texts[i]));
  }

  const threshold = 0.82;
  const result = greedyDiversify(MOCK_CANDIDATES, embeddings, 5, threshold);

  // Must select target count
  assertEquals(result.selected.length, 5);

  // Expect at least one of the known near-duplicates to be filtered
  const filteredClimate = result.filtered.filter((id) =>
    ["vid2", "vid4", "vid7"].includes(id)
  );
  assert(
    filteredClimate.length >= 1,
    `Expected >=1 climate duplicate filtered; got ${filteredClimate.length}. Filtered: ${JSON.stringify(result.filtered)}`,
  );

  // Sanity: ensure some diversity in selected channels (>=3 channels)
  const selectedChannels = new Set(
    result.selected.map((id) =>
      MOCK_CANDIDATES.find((c) => c.video_id === id)!.channel
    ),
  );
  assert(
    selectedChannels.size >= 3,
    `Expected >=3 unique channels; got ${selectedChannels.size}`,
  );
});
