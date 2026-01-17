/**
 * Embedding-based Diversification for Silenced Voices
 *
 * Uses Gemini embeddings + greedy cosine similarity to ensure
 * recommended videos represent diverse perspectives.
 *
 * CORRECTNESS:
 * - Diversifies AFTER ranking (preserves existing score logic)
 * - Greedy selection: start with top-ranked, add if cosine sim < threshold
 * - Relaxes threshold if needed to fill quota
 *
 * SAFETY:
 * - Hard cap: MAX 30 embeddings per request (credit-safe)
 * - Cache: 6hr TTL by videoId (avoid re-embedding)
 * - Fallback: returns original list if embeddings fail
 */

import { embedTexts } from "./gemini_client.ts"

// ============================================
// CONFIGURATION
// ============================================

const MAX_CANDIDATES_TO_EMBED = 30
const EMBEDDING_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
const PRIMARY_SIMILARITY_THRESHOLD = 0.82
const RELAXED_SIMILARITY_THRESHOLD = 0.87

// ============================================
// TYPES
// ============================================

export interface DiversifiableItem {
  video_id: string
  title: string
  channel: string
  description?: string
  [key: string]: unknown // Allow other fields to pass through
}

export interface DiversifiedItem extends DiversifiableItem {
  diversityNote?: string
}

export interface DiversityMetadata {
  method: 'greedy_cosine' | 'fallback_heuristic'
  thresholdUsed: number
  candidatesEmbedded: number
  originalCount: number
  selectedCount: number
  duplicatesFiltered?: number
  relaxedThreshold?: boolean
  error?: string
}

export interface DiversificationResult {
  items: DiversifiedItem[]
  diversity: DiversityMetadata
}

// ============================================
// EMBEDDING CACHE (In-memory with TTL)
// ============================================

interface CacheEntry {
  embedding: number[]
  timestamp: number
}

const embeddingCache = new Map<string, CacheEntry>()

function getCachedEmbedding(videoId: string): number[] | null {
  const entry = embeddingCache.get(videoId)
  if (!entry) return null

  // Check TTL
  if (Date.now() - entry.timestamp > EMBEDDING_CACHE_TTL_MS) {
    embeddingCache.delete(videoId)
    return null
  }

  return entry.embedding
}

function setCachedEmbedding(videoId: string, embedding: number[]): void {
  embeddingCache.set(videoId, {
    embedding,
    timestamp: Date.now()
  })
}

// Cleanup old entries periodically
function cleanupCache(): void {
  const now = Date.now()
  for (const [key, entry] of embeddingCache.entries()) {
    if (now - entry.timestamp > EMBEDDING_CACHE_TTL_MS) {
      embeddingCache.delete(key)
    }
  }
}

// ============================================
// MATH UTILITIES
// ============================================

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/**
 * Check if a candidate is too similar to any already selected item
 */
function isTooSimilar(
  candidateEmbedding: number[],
  selectedEmbeddings: number[][],
  threshold: number
): boolean {
  for (const selected of selectedEmbeddings) {
    const sim = cosineSimilarity(candidateEmbedding, selected)
    if (sim >= threshold) {
      return true
    }
  }
  return false
}

// ============================================
// TEXT PREPARATION
// ============================================

/**
 * Build embedding text from item fields
 * Format: "${title} — ${channel}. ${description}" truncated to 300 chars
 */
function buildEmbeddingText(item: DiversifiableItem): string {
  const parts = [
    item.title || '',
    item.channel ? `— ${item.channel}` : '',
    item.description ? `. ${item.description}` : ''
  ]

  const text = parts.join(' ').trim()
  return text.slice(0, 300)
}

// ============================================
// GREEDY DIVERSIFICATION ALGORITHM
// ============================================

/**
 * Greedy diversification with cosine similarity
 *
 * Algorithm:
 * 1. Start with top-ranked video
 * 2. For each subsequent candidate (in rank order):
 *    - If cosine similarity to ALL selected items < threshold: add it
 * 3. If we can't fill quota with primary threshold, relax to secondary
 */
function greedyDiversify(
  items: DiversifiableItem[],
  embeddings: Map<string, number[]>,
  targetCount: number,
  primaryThreshold: number,
  relaxedThreshold: number
): { selected: DiversifiedItem[]; thresholdUsed: number; duplicatesFiltered: number; relaxed: boolean } {
  const selected: DiversifiedItem[] = []
  const selectedEmbeddings: number[][] = []
  let duplicatesFiltered = 0
  let thresholdUsed = primaryThreshold
  let relaxed = false

  // First pass with primary threshold
  for (const item of items) {
    if (selected.length >= targetCount) break

    const embedding = embeddings.get(item.video_id)
    if (!embedding) {
      // No embedding available, include by default (shouldn't happen)
      selected.push({
        ...item,
        diversityNote: 'Included (no embedding available)'
      })
      continue
    }

    if (selected.length === 0) {
      // Always include the first (top-ranked) item
      selected.push({
        ...item,
        diversityNote: 'Top-ranked recommendation'
      })
      selectedEmbeddings.push(embedding)
      continue
    }

    if (!isTooSimilar(embedding, selectedEmbeddings, primaryThreshold)) {
      selected.push({
        ...item,
        diversityNote: 'Chosen to reduce duplicates and surface different perspectives.'
      })
      selectedEmbeddings.push(embedding)
    } else {
      duplicatesFiltered++
      console.log(`[Diversify] Filtered similar item: "${item.title?.slice(0, 50)}..."`)
    }
  }

  // Second pass with relaxed threshold if needed
  if (selected.length < targetCount) {
    relaxed = true
    thresholdUsed = relaxedThreshold

    for (const item of items) {
      if (selected.length >= targetCount) break

      // Skip already selected
      if (selected.some(s => s.video_id === item.video_id)) continue

      const embedding = embeddings.get(item.video_id)
      if (!embedding) continue

      if (!isTooSimilar(embedding, selectedEmbeddings, relaxedThreshold)) {
        selected.push({
          ...item,
          diversityNote: 'Included with relaxed similarity threshold.'
        })
        selectedEmbeddings.push(embedding)
      }
    }
  }

  return { selected, thresholdUsed, duplicatesFiltered, relaxed }
}

// ============================================
// MAIN DIVERSIFICATION FUNCTION
// ============================================

/**
 * Diversify a ranked list of video recommendations using embeddings
 *
 * @param rankedItems - Pre-ranked list of candidates (ranking preserved)
 * @param targetCount - Desired number of results (default 10)
 * @param enableML - Whether to use ML features (false = fallback)
 * @returns Diversified items with metadata
 */
export async function diversifySilencedVoices(
  rankedItems: DiversifiableItem[],
  targetCount: number = 10,
  enableML: boolean = true
): Promise<DiversificationResult> {
  // Cleanup old cache entries
  cleanupCache()

  const originalCount = rankedItems.length

  // Edge case: not enough items
  if (rankedItems.length <= 1) {
    return {
      items: rankedItems.map(item => ({
        ...item,
        diversityNote: 'Single result, no diversification needed.'
      })),
      diversity: {
        method: 'fallback_heuristic',
        thresholdUsed: 0,
        candidatesEmbedded: 0,
        originalCount,
        selectedCount: rankedItems.length
      }
    }
  }

  // Fallback if ML disabled
  if (!enableML) {
    console.log('[Diversify] ML features disabled, using fallback')
    return {
      items: rankedItems.slice(0, targetCount).map((item, i) => ({
        ...item,
        diversityNote: i === 0 ? 'Top-ranked recommendation' : 'Ranked by algorithm score.'
      })),
      diversity: {
        method: 'fallback_heuristic',
        thresholdUsed: 0,
        candidatesEmbedded: 0,
        originalCount,
        selectedCount: Math.min(targetCount, rankedItems.length),
        error: 'ML features disabled'
      }
    }
  }

  // Limit candidates to embed (credit-safe)
  const candidatesToEmbed = rankedItems.slice(0, MAX_CANDIDATES_TO_EMBED)

  // Check cache and identify items needing embedding
  const embeddings = new Map<string, number[]>()
  const textsToEmbed: string[] = []
  const idsToEmbed: string[] = []

  for (const item of candidatesToEmbed) {
    const cached = getCachedEmbedding(item.video_id)
    if (cached) {
      embeddings.set(item.video_id, cached)
    } else {
      textsToEmbed.push(buildEmbeddingText(item))
      idsToEmbed.push(item.video_id)
    }
  }

  console.log(`[Diversify] Cache hits: ${embeddings.size}, need to embed: ${textsToEmbed.length}`)

  // Fetch missing embeddings
  if (textsToEmbed.length > 0) {
    try {
      const newEmbeddings = await embedTexts(textsToEmbed)

      if (newEmbeddings && newEmbeddings.length === textsToEmbed.length) {
        for (let i = 0; i < newEmbeddings.length; i++) {
          embeddings.set(idsToEmbed[i], newEmbeddings[i])
          setCachedEmbedding(idsToEmbed[i], newEmbeddings[i])
        }
        console.log(`[Diversify] Successfully embedded ${newEmbeddings.length} items`)
      } else {
        throw new Error('Embedding count mismatch or null result')
      }
    } catch (error) {
      console.error('[Diversify] Embedding failed, using fallback:', error)

      // Fallback: return original ranked list
      return {
        items: rankedItems.slice(0, targetCount).map((item, i) => ({
          ...item,
          diversityNote: i === 0 ? 'Top-ranked recommendation' : 'Ranked by algorithm score.'
        })),
        diversity: {
          method: 'fallback_heuristic',
          thresholdUsed: 0,
          candidatesEmbedded: embeddings.size, // Partial from cache
          originalCount,
          selectedCount: Math.min(targetCount, rankedItems.length),
          error: error instanceof Error ? error.message : 'Embedding failed'
        }
      }
    }
  }

  // Run greedy diversification
  const { selected, thresholdUsed, duplicatesFiltered, relaxed } = greedyDiversify(
    candidatesToEmbed,
    embeddings,
    targetCount,
    PRIMARY_SIMILARITY_THRESHOLD,
    RELAXED_SIMILARITY_THRESHOLD
  )

  // Log filtering results
  if (duplicatesFiltered > 0) {
    console.log(`[Diversify] DEBUG: Filtered ${duplicatesFiltered} near-duplicate items (threshold: ${thresholdUsed})`)
  }

  return {
    items: selected,
    diversity: {
      method: 'greedy_cosine',
      thresholdUsed,
      candidatesEmbedded: embeddings.size,
      originalCount,
      selectedCount: selected.length,
      duplicatesFiltered,
      relaxedThreshold: relaxed
    }
  }
}

// ============================================
// EXPORTS
// ============================================

export {
  cosineSimilarity,
  buildEmbeddingText,
  getCachedEmbedding,
  MAX_CANDIDATES_TO_EMBED,
  PRIMARY_SIMILARITY_THRESHOLD,
  RELAXED_SIMILARITY_THRESHOLD
}
