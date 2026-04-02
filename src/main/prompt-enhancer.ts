import {
  EnhancerConfig,
  EnhanceResult,
  EnhancerSessionCost,
  MODEL_PRICING,
  DEFAULT_ENHANCER_MODEL,
  DEFAULT_OPENAI_BASE_URL
} from '../shared/enhancer-types'

const SYSTEM_PROMPT = `You are a Prompt Enhancer for Claude Code — an AI coding assistant that runs in a terminal.

The user is about to send a prompt to Claude. Your job is to improve the prompt so Claude produces better results.

You will receive:
1. The user's original prompt
2. Recent terminal context (what Claude and the user have been doing)

Improve the prompt by:
- Making vague requests specific and actionable
- Adding relevant context from the terminal history that the user might have forgotten to mention
- Structuring complex requests into clear steps
- Specifying expected output format when helpful
- Adding constraints or edge cases the user might have missed

Rules:
- If the prompt is already clear and specific, return it as-is (don't add fluff)
- Preserve the user's intent exactly — enhance, don't redirect
- Keep the same tone and style as the original
- Don't add unnecessary verbosity — brevity is valued
- For short commands or slash commands (like /compact, /model), return them unchanged
- The enhanced prompt should still feel like something the user would write, not an AI-generated essay

Respond with ONLY a JSON object:
{
  "enhanced": "the improved prompt text",
  "explanation": "1-2 sentence explanation of what you changed and why (or 'No changes needed' if the prompt was already good)"
}`

const MAX_CONTEXT_CHARS = 4000

class PromptEnhancer {
  private config: EnhancerConfig = { enabled: false, apiKey: '', model: DEFAULT_ENHANCER_MODEL, baseUrl: '' }
  private costs = new Map<string, EnhancerSessionCost>()

  // Terminal context buffers — accumulates PTY output per session for context
  private contextBuffers = new Map<string, string[]>()
  private contextLengths = new Map<string, number>()

  setConfig(config: EnhancerConfig) {
    this.config = config
  }

  getConfig(): EnhancerConfig {
    return { ...this.config }
  }

  isEnabled(): boolean {
    return this.config.enabled && this.config.apiKey.length > 0
  }

  /** Feed PTY output to build up context for enhancement. Called on every pty-data event. */
  feedContext(sessionId: string, data: string) {
    if (!this.isEnabled()) return

    let chunks = this.contextBuffers.get(sessionId)
    let length = this.contextLengths.get(sessionId) || 0
    if (!chunks) {
      chunks = []
      this.contextBuffers.set(sessionId, chunks)
    }

    chunks.push(data)
    length += data.length

    // Trim oldest chunks if buffer is too large
    while (length > MAX_CONTEXT_CHARS * 2 && chunks.length > 1) {
      const removed = chunks.shift()!
      length -= removed.length
    }
    this.contextLengths.set(sessionId, length)
  }

  /** Enhance a prompt before sending to Claude. Returns null if enhancement fails or is unavailable. */
  async enhance(sessionId: string, prompt: string): Promise<EnhanceResult | null> {
    if (!this.isEnabled()) return null

    // Don't enhance slash commands or very short prompts
    if (prompt.startsWith('/') || prompt.trim().length < 10) {
      return null
    }

    const contextChunks = this.contextBuffers.get(sessionId) || []
    const rawContext = contextChunks.join('')
    const context = this.stripAnsi(rawContext).slice(-MAX_CONTEXT_CHARS)

    try {
      return await this.callOpenAI(sessionId, prompt, context)
    } catch (err) {
      console.error('[Enhancer] Enhancement failed:', err)
      return null
    }
  }

  private async callOpenAI(sessionId: string, prompt: string, context: string): Promise<EnhanceResult | null> {
    const userMessage = context.trim().length > 50
      ? `## Recent terminal context:\n${context}\n\n## User's prompt to enhance:\n${prompt}`
      : `## User's prompt to enhance:\n${prompt}`

    const body = {
      model: this.config.model || DEFAULT_ENHANCER_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 1000
    }

    const baseUrl = (this.config.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '')
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown')
      console.error(`[Enhancer] OpenAI API error ${res.status}: ${errText}`)
      return null
    }

    const json = await res.json()
    const choice = json.choices?.[0]
    if (!choice) return null

    const usage = json.usage || {}
    const promptTokens = usage.prompt_tokens || 0
    const completionTokens = usage.completion_tokens || 0

    const pricing = MODEL_PRICING[this.config.model] || MODEL_PRICING[DEFAULT_ENHANCER_MODEL]
    const costUsd = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000

    // Track cost
    const cost = this.costs.get(sessionId) || { totalUsd: 0, calls: 0 }
    cost.totalUsd += costUsd
    cost.calls += 1
    this.costs.set(sessionId, cost)

    try {
      const content = choice.message?.content?.trim() || ''
      const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      const parsed = JSON.parse(cleaned)

      return {
        enhanced: String(parsed.enhanced || prompt),
        explanation: String(parsed.explanation || 'No changes needed'),
        costUsd
      }
    } catch {
      console.error('[Enhancer] Failed to parse response')
      return null
    }
  }

  getCost(sessionId: string): EnhancerSessionCost {
    return this.costs.get(sessionId) || { totalUsd: 0, calls: 0 }
  }

  getTotalCost(): EnhancerSessionCost {
    const total: EnhancerSessionCost = { totalUsd: 0, calls: 0 }
    for (const cost of this.costs.values()) {
      total.totalUsd += cost.totalUsd
      total.calls += cost.calls
    }
    return total
  }

  clearSession(sessionId: string) {
    this.contextBuffers.delete(sessionId)
    this.contextLengths.delete(sessionId)
  }

  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
  }
}

export const promptEnhancer = new PromptEnhancer()
