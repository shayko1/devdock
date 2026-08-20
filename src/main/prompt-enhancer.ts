import {
  EnhancerConfig,
  EnhanceResult,
  EnhancerSessionCost,
  DEFAULT_ENHANCER_MODEL
} from '../shared/enhancer-types'
import { chatCompletion, parseJsonContent, stripAnsi } from './ai-client'

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

    const context = this.getContext(sessionId)

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

    const result = await chatCompletion({
      config: this.config,
      system: SYSTEM_PROMPT,
      user: userMessage,
      temperature: 0.3,
      maxTokens: 1000,
      label: 'Enhancer',
    })
    if (!result) return null

    this.trackCost(sessionId, result.costUsd)

    const parsed = parseJsonContent<{ enhanced?: unknown; explanation?: unknown }>(result.content)
    if (!parsed) {
      console.error('[Enhancer] Failed to parse response')
      return null
    }

    return {
      enhanced: String(parsed.enhanced || prompt),
      explanation: String(parsed.explanation || 'No changes needed'),
      costUsd: result.costUsd
    }
  }

  private trackCost(sessionId: string, costUsd: number) {
    const cost = this.costs.get(sessionId) || { totalUsd: 0, calls: 0 }
    cost.totalUsd += costUsd
    cost.calls += 1
    this.costs.set(sessionId, cost)
  }

  /**
   * Recent terminal output for a session, ANSI-stripped and capped.
   * Used by the session titler when a session has no Claude transcript yet.
   */
  getContext(sessionId: string, maxChars = MAX_CONTEXT_CHARS): string {
    const chunks = this.contextBuffers.get(sessionId)
    if (!chunks || chunks.length === 0) return ''
    return stripAnsi(chunks.join('')).slice(-maxChars)
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
}

export const promptEnhancer = new PromptEnhancer()
