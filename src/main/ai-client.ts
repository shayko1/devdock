import {
  EnhancerConfig,
  MODEL_PRICING,
  DEFAULT_ENHANCER_MODEL,
  DEFAULT_OPENAI_BASE_URL
} from '../shared/enhancer-types'

/**
 * Minimal OpenAI-compatible chat client shared by the Prompt Enhancer and the
 * session titler. Both features talk to the same endpoint with the same key, so
 * the request/pricing plumbing lives here rather than being copied per feature.
 */

export interface ChatCompletionOptions {
  config: EnhancerConfig
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  /** Label used in error logs so callers are distinguishable. */
  label: string
}

export interface ChatCompletionResult {
  content: string
  costUsd: number
}

/** Returns null on any transport, auth, or shape failure — callers fall back. */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult | null> {
  const { config, system, user, temperature = 0.3, maxTokens = 1000, label } = opts

  const model = config.model || DEFAULT_ENHANCER_MODEL
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature,
    max_tokens: maxTokens
  }

  const baseUrl = (config.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '')

  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body)
    })
  } catch (err) {
    console.error(`[${label}] request failed:`, err)
    return null
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown')
    console.error(`[${label}] API error ${res.status}: ${errText}`)
    return null
  }

  let json: any
  try {
    json = await res.json()
  } catch (err) {
    console.error(`[${label}] malformed JSON response:`, err)
    return null
  }

  const content = json.choices?.[0]?.message?.content
  if (typeof content !== 'string') return null

  return { content: content.trim(), costUsd: estimateCost(model, json.usage) }
}

/** Cost in USD for a completion, using the pricing table. Unknown models bill as the default. */
export function estimateCost(model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  const promptTokens = usage?.prompt_tokens || 0
  const completionTokens = usage?.completion_tokens || 0
  const pricing = MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_ENHANCER_MODEL]
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000
}

/** Parse a JSON object out of a model response, tolerating ```json fences. */
export function parseJsonContent<T>(content: string): T | null {
  const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  try {
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}

/** Strip ANSI escape sequences so terminal output is usable as model context. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}
