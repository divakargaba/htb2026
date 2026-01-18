/**
 * DeepSeek Prompt Templates
 * 
 * Centralized prompt templates for consistent AI behavior across edge functions.
 * All prompts are designed to be deterministic, safe, and focused.
 */

export const PERSPECTIVE_CLASSIFIER_PROMPT = `You are a content classifier. Classify a YouTube video into ONE perspective bucket based on its framing and approach.

Base Query: "{baseQuery}"
Video Title: "{videoTitle}"
Video Description: "{videoDescription}"
Channel Title: "{channelTitle}"

Perspective Buckets:
1. "mainstream_practical" - Conventional, solution-focused, actionable, mainstream approach
2. "critical_contextual" - Questioning assumptions, providing context, analyzing systems/causes
3. "alternative_longterm" - Alternative viewpoints, long-term thinking, different paradigms

Rules:
- Classify based on FRAMING and APPROACH, not topic keywords
- Do NOT infer sensitive attributes (political, demographic, etc.)
- Do NOT make accusations about suppression/censorship
- Only describe the content's framing perspective
- Be deterministic - same input should produce same output

Output STRICT JSON ONLY (no markdown, no extra text):
{
  "bucket": "mainstream_practical" | "critical_contextual" | "alternative_longterm",
  "confidence": 0.0-1.0,
  "oneSentenceRationale": "Brief explanation of why this fits the bucket (max 20 words)"
}`

/**
 * Classify a video into a perspective bucket using DeepSeek
 */
export async function classifyPerspective(
  baseQuery: string,
  videoTitle: string,
  videoDescription: string,
  channelTitle: string,
  deepseekApiKey: string
): Promise<{
  bucket: 'mainstream_practical' | 'critical_contextual' | 'alternative_longterm'
  confidence: number
  oneSentenceRationale: string
} | null> {
  const prompt = PERSPECTIVE_CLASSIFIER_PROMPT
    .replace('{baseQuery}', baseQuery)
    .replace('{videoTitle}', videoTitle)
    .replace('{videoDescription}', (videoDescription || '').slice(0, 500))
    .replace('{channelTitle}', channelTitle)

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekApiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.2, // Low temperature for deterministic classification
        max_tokens: 150
      })
    })

    if (!response.ok) {
      console.error(`[Perspective] DeepSeek API error: ${response.status}`)
      return null
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content || ''

    // Extract JSON from response (handle markdown code blocks if present)
    let jsonText = text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    }

    const result = JSON.parse(jsonText)

    // Validate bucket
    const validBuckets = ['mainstream_practical', 'critical_contextual', 'alternative_longterm']
    if (!validBuckets.includes(result.bucket)) {
      console.warn(`[Perspective] Invalid bucket: ${result.bucket}, defaulting to mainstream_practical`)
      result.bucket = 'mainstream_practical'
    }

    return {
      bucket: result.bucket,
      confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
      oneSentenceRationale: result.oneSentenceRationale || 'Standard approach to the topic'
    }
  } catch (error) {
    console.error('[Perspective] Classification error:', error)
    return null
  }
}
