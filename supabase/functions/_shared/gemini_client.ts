/**
 * Gemini API Client for Silenced by the Algorithm
 *
 * Provides:
 * - embedTexts(): Generate embeddings for semantic search
 * - classifyGreenwashing(): AI-powered greenwashing detection
 *
 * Engineering constraints:
 * - Max 2 retries with exponential backoff
 * - 10s timeout per request
 * - Graceful degradation: returns null on failure (caller uses heuristics)
 * - API key read from env, never exposed to extension
 */

// ============================================
// CONFIGURATION
// ============================================

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || ''
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

// Models
const EMBEDDING_MODEL = 'models/text-embedding-004'
const CHAT_MODEL = 'models/gemini-1.5-flash'

// Retry configuration
const MAX_RETRIES = 2
const INITIAL_RETRY_DELAY_MS = 1000
const REQUEST_TIMEOUT_MS = 10000

// ============================================
// TYPES
// ============================================

export interface GreenwashingFlag {
  type: 'positive' | 'warning' | 'risk'
  text: string
  evidence?: string
}

export interface GreenwashingResult {
  transparencyScore: number
  flags: GreenwashingFlag[]
}

export interface GeminiHealthStatus {
  available: boolean
  hasApiKey: boolean
  error?: string
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Execute with retries and exponential backoff
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T | null> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry on abort (timeout) or 4xx errors
      if (lastError.name === 'AbortError') {
        console.error(`[Gemini] ${operationName} timed out after ${REQUEST_TIMEOUT_MS}ms`)
        break
      }

      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)
        console.warn(`[Gemini] ${operationName} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`)
        await sleep(delay)
      }
    }
  }

  console.error(`[Gemini] ${operationName} failed after ${MAX_RETRIES + 1} attempts:`, lastError?.message)
  return null
}

// ============================================
// HEALTH CHECK
// ============================================

/**
 * Check if Gemini API is available (key exists, doesn't call API)
 */
export function checkGeminiHealth(): GeminiHealthStatus {
  const hasApiKey = !!GEMINI_API_KEY && GEMINI_API_KEY.length > 0

  return {
    available: hasApiKey,
    hasApiKey,
    error: hasApiKey ? undefined : 'GEMINI_API_KEY not set in environment'
  }
}

// ============================================
// EMBEDDING FUNCTION
// ============================================

/**
 * Generate embeddings for multiple texts using Gemini embedding model
 *
 * @param texts - Array of texts to embed
 * @returns Array of embedding vectors, or null if failed
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!GEMINI_API_KEY) {
    console.warn('[Gemini] embedTexts: No API key configured')
    return null
  }

  if (!texts || texts.length === 0) {
    return []
  }

  return withRetry(async () => {
    const url = `${GEMINI_BASE_URL}/${EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`

    const requests = texts.map(text => ({
      model: EMBEDDING_MODEL,
      content: {
        parts: [{ text }]
      }
    }))

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    if (!data.embeddings || !Array.isArray(data.embeddings)) {
      throw new Error('Invalid embedding response format')
    }

    return data.embeddings.map((e: { values: number[] }) => e.values)
  }, 'embedTexts')
}

// ============================================
// GREENWASHING CLASSIFICATION
// ============================================

const GREENWASHING_SYSTEM_PROMPT = `You are an expert sustainability analyst specializing in detecting greenwashing in environmental claims. Analyze the provided text for greenwashing indicators.

IMPORTANT: Respond ONLY with valid JSON matching this exact schema:
{
  "transparencyScore": <number 0-100>,
  "flags": [
    {
      "type": "<'positive'|'warning'|'risk'>",
      "text": "<short description>",
      "evidence": "<optional quote from text>"
    }
  ]
}

Scoring guidelines:
- 80-100: Highly transparent with verified claims, data sources cited
- 60-79: Mostly transparent with some vague claims
- 40-59: Mixed - some transparency but notable greenwashing indicators
- 20-39: Significant greenwashing concerns
- 0-19: Severe greenwashing or misleading claims

Flag types:
- "positive": Evidence-based claims, specific data, third-party verification
- "warning": Vague claims, missing context, unsubstantiated statements
- "risk": Misleading claims, hidden trade-offs, false impressions

Analyze for:
1. Vague terms without specifics ("eco-friendly", "green", "natural")
2. Hidden trade-offs (highlighting one benefit while ignoring harms)
3. No proof / missing evidence for claims
4. Irrelevant claims (true but unimportant)
5. Lesser of two evils framing
6. False labels or certifications
7. Lack of transparency about methodology`

/**
 * Classify greenwashing in sustainability-related text using Gemini
 *
 * @param text - Text content to analyze (title + description + transcript excerpt)
 * @returns GreenwashingResult or null if failed
 */
export async function classifyGreenwashing(text: string): Promise<GreenwashingResult | null> {
  if (!GEMINI_API_KEY) {
    console.warn('[Gemini] classifyGreenwashing: No API key configured')
    return null
  }

  if (!text || text.trim().length === 0) {
    return null
  }

  // Truncate text to avoid token limits (roughly 4 chars per token, keep under 8k tokens)
  const truncatedText = text.slice(0, 30000)

  return withRetry(async () => {
    const url = `${GEMINI_BASE_URL}/${CHAT_MODEL}:generateContent?key=${GEMINI_API_KEY}`

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${GREENWASHING_SYSTEM_PROMPT}\n\n---\n\nAnalyze this content for greenwashing:\n\n${truncatedText}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json'
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    }

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    // Extract text from Gemini response
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!responseText) {
      throw new Error('Empty response from Gemini')
    }

    // Parse JSON response
    let parsed: GreenwashingResult

    try {
      // Clean potential markdown code blocks
      const cleanedJson = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()

      parsed = JSON.parse(cleanedJson)
    } catch (parseError) {
      console.error('[Gemini] Failed to parse JSON response:', responseText)
      throw new Error('Invalid JSON in Gemini response')
    }

    // Validate response structure
    if (typeof parsed.transparencyScore !== 'number' || !Array.isArray(parsed.flags)) {
      throw new Error('Invalid response structure from Gemini')
    }

    // Clamp score to valid range
    parsed.transparencyScore = Math.max(0, Math.min(100, Math.round(parsed.transparencyScore)))

    // Validate flag types
    parsed.flags = parsed.flags
      .filter(f => f && typeof f.text === 'string')
      .map(f => ({
        type: ['positive', 'warning', 'risk'].includes(f.type) ? f.type : 'warning',
        text: f.text.slice(0, 200), // Limit flag text length
        evidence: f.evidence ? f.evidence.slice(0, 300) : undefined
      }))
      .slice(0, 10) // Max 10 flags

    return parsed
  }, 'classifyGreenwashing')
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export const gemini = {
  embedTexts,
  classifyGreenwashing,
  checkHealth: checkGeminiHealth,
  isAvailable: () => !!GEMINI_API_KEY
}

export default gemini
