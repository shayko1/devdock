import { BrowserWindow } from 'electron'
import {
  CoachSuggestion,
  CoachAnalysis,
  CoachConfig,
  CoachSessionCost,
  MODEL_PRICING,
  DEFAULT_COACH_MODEL,
  DEFAULT_OPENAI_BASE_URL
} from '../shared/coach-types'

const SYSTEM_PROMPT = `You are a Prompt Coach — a lightweight assistant that watches Claude Code terminal sessions and provides actionable feedback AFTER each exchange.

Your job:
1. Analyze the user's prompt and Claude's response
2. Provide 1-3 suggestions to improve future interactions

Suggestion types (use the "type" field):
- "tip": A short actionable tip (e.g. "Be more specific about the file structure you want")
- "rewrite": Rewrite the user's prompt to be more effective. Include the rewritten prompt in "suggestion" field.
- "followup": Suggest a follow-up prompt the user should send next. Include the prompt in "suggestion" field.
- "command": Recommend a tool/command the user should try (e.g. "Use /octocode/research to explore unfamiliar code first")

Available commands the user can invoke in their IDE:
- /octocode/research — deep code discovery, pattern analysis, and bug investigation
- /octocode/plan — adaptive research & implementation planning
- /octocode/review_pull_request <prUrl> — defects-first PR review
- /brainstorming — explore user intent, requirements and design before implementation

Respond ONLY with a JSON array of suggestions. Each suggestion:
{
  "type": "tip" | "rewrite" | "followup" | "command",
  "title": "Short title (max 8 words)",
  "body": "Explanation (1-2 sentences)",
  "suggestion": "optional — the rewritten prompt or command"
}

Rules:
- Max 3 suggestions per analysis
- Be specific and actionable, not generic
- If the exchange was already great, return an empty array []
- Reference the actual content of the prompt/response
- Keep it concise — the user is busy coding`

interface SessionBuffer {
  chunks: string[]
  totalLength: number
  lastActivityMs: number
  analyzing: boolean
  debounceTimer: ReturnType<typeof setTimeout> | null
}

const MAX_BUFFER_CHARS = 8000
const SILENCE_THRESHOLD_MS = 5000
const SIMILARITY_THRESHOLD = 0.65

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function wordSet(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter(Boolean))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const w of a) if (b.has(w)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function isSimilarSuggestion(a: CoachSuggestion, b: CoachSuggestion): boolean {
  if (normalize(a.title) === normalize(b.title)) return true
  const bodyA = wordSet(a.body + ' ' + (a.suggestion || ''))
  const bodyB = wordSet(b.body + ' ' + (b.suggestion || ''))
  return jaccardSimilarity(bodyA, bodyB) >= SIMILARITY_THRESHOLD
}

class CoachManager {
  private mainWindow: BrowserWindow | null = null
  private buffers = new Map<string, SessionBuffer>()
  private costs = new Map<string, CoachSessionCost>()
  private config: CoachConfig = { enabled: false, apiKey: '', model: DEFAULT_COACH_MODEL, baseUrl: '' }
  private suggestions = new Map<string, CoachSuggestion[]>()

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win
  }

  setConfig(config: CoachConfig) {
    this.config = config
    if (!this.isEnabled()) {
      for (const [, buf] of this.buffers) {
        if (buf.debounceTimer) clearTimeout(buf.debounceTimer)
      }
      this.buffers.clear()
    }
  }

  getConfig(): CoachConfig {
    return { ...this.config }
  }

  isEnabled(): boolean {
    return this.config.enabled && this.config.apiKey.length > 0
  }

  /** Feed PTY output into the session buffer. Called on every pty-data event. */
  feedData(sessionId: string, data: string) {
    if (!this.isEnabled()) return

    let buf = this.buffers.get(sessionId)
    if (!buf) {
      buf = { chunks: [], totalLength: 0, lastActivityMs: Date.now(), analyzing: false, debounceTimer: null }
      this.buffers.set(sessionId, buf)
    }

    buf.chunks.push(data)
    buf.totalLength += data.length
    buf.lastActivityMs = Date.now()

    // Trim oldest chunks if buffer is too large
    while (buf.totalLength > MAX_BUFFER_CHARS && buf.chunks.length > 1) {
      const removed = buf.chunks.shift()!
      buf.totalLength -= removed.length
    }

    // Debounce: wait for silence before analyzing
    if (buf.debounceTimer) clearTimeout(buf.debounceTimer)
    buf.debounceTimer = setTimeout(() => {
      this.maybeAnalyze(sessionId)
    }, SILENCE_THRESHOLD_MS)
  }

  private async maybeAnalyze(sessionId: string) {
    const buf = this.buffers.get(sessionId)
    if (!buf || buf.analyzing || !this.isEnabled()) return

    const text = this.stripAnsi(buf.chunks.join(''))
    if (text.trim().length < 50) return

    buf.analyzing = true
    buf.chunks = []
    buf.totalLength = 0

    try {
      const analysis = await this.callOpenAI(sessionId, text)
      if (analysis && analysis.suggestions.length > 0) {
        const existing = this.suggestions.get(sessionId) || []
        const deduped = analysis.suggestions.filter(
          newSug => !existing.some(old => isSimilarSuggestion(old, newSug))
        )
        analysis.suggestions = deduped
        if (deduped.length === 0) return
        this.suggestions.set(sessionId, [...existing, ...deduped].slice(-20))

        // Track cost
        const cost = this.costs.get(sessionId) || { totalUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 }
        cost.totalUsd += analysis.costUsd
        cost.calls += 1
        cost.promptTokens += analysis.tokensUsed.prompt
        cost.completionTokens += analysis.tokensUsed.completion
        this.costs.set(sessionId, cost)

        // Notify renderer
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('coach-suggestion', analysis)
        }
      }
    } catch (err) {
      console.error('[Coach] Analysis failed:', err)
    } finally {
      buf.analyzing = false
    }
  }

  private async callOpenAI(sessionId: string, terminalContent: string): Promise<CoachAnalysis | null> {
    const truncated = terminalContent.slice(-4000)

    const existing = this.suggestions.get(sessionId) || []
    const recentTitles = existing.slice(-10).map(s => `- ${s.title}`).join('\n')
    const avoidClause = recentTitles
      ? `\n\nYou have ALREADY given these suggestions in this session — do NOT repeat or rephrase them:\n${recentTitles}\n\nOnly provide NEW, different insights.`
      : ''

    const body = {
      model: this.config.model || DEFAULT_COACH_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Here is the recent terminal output from a Claude Code session. Analyze the latest exchange and provide suggestions.${avoidClause}\n\n---\n${truncated}\n---` }
      ],
      temperature: 0.3,
      max_tokens: 600
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
      console.error(`[Coach] OpenAI API error ${res.status}: ${errText}`)
      return null
    }

    const json = await res.json()
    const choice = json.choices?.[0]
    if (!choice) return null

    const usage = json.usage || {}
    const promptTokens = usage.prompt_tokens || 0
    const completionTokens = usage.completion_tokens || 0

    const pricing = MODEL_PRICING[this.config.model] || MODEL_PRICING[DEFAULT_COACH_MODEL]
    const costUsd = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000

    let suggestions: CoachSuggestion[] = []
    try {
      const content = choice.message?.content?.trim() || '[]'
      // Handle markdown-wrapped JSON
      const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      const parsed = JSON.parse(cleaned)
      if (Array.isArray(parsed)) {
        suggestions = parsed.slice(0, 3).map((s: any, i: number) => ({
          id: `${sessionId}-${Date.now()}-${i}`,
          type: ['tip', 'rewrite', 'followup', 'command'].includes(s.type) ? s.type : 'tip',
          title: String(s.title || 'Suggestion').slice(0, 60),
          body: String(s.body || '').slice(0, 300),
          suggestion: s.suggestion ? String(s.suggestion).slice(0, 500) : undefined,
          timestamp: Date.now()
        }))
      }
    } catch {
      console.error('[Coach] Failed to parse suggestions from response')
      return null
    }

    return { sessionId, suggestions, costUsd, tokensUsed: { prompt: promptTokens, completion: completionTokens } }
  }

  getSuggestions(sessionId: string): CoachSuggestion[] {
    return this.suggestions.get(sessionId) || []
  }

  getCost(sessionId: string): CoachSessionCost {
    return this.costs.get(sessionId) || { totalUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 }
  }

  getTotalCost(): CoachSessionCost {
    const total: CoachSessionCost = { totalUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 }
    for (const cost of this.costs.values()) {
      total.totalUsd += cost.totalUsd
      total.calls += cost.calls
      total.promptTokens += cost.promptTokens
      total.completionTokens += cost.completionTokens
    }
    return total
  }

  clearSession(sessionId: string) {
    this.buffers.delete(sessionId)
    this.suggestions.delete(sessionId)
    // Keep costs for historical tracking
  }

  dismissSuggestion(sessionId: string, suggestionId: string) {
    const existing = this.suggestions.get(sessionId)
    if (existing) {
      this.suggestions.set(sessionId, existing.filter(s => s.id !== suggestionId))
    }
  }

  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
  }
}

export const coachManager = new CoachManager()
