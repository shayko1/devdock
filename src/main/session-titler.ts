import { SessionTitleRequest, SessionTitleResponse } from '../shared/ipc-types'
import { chatCompletion, parseJsonContent } from './ai-client'
import { promptEnhancer } from './prompt-enhancer'
import { getSessionUserMessages } from './session-history'

/**
 * Names Claude sessions the way Claude Code names conversations: a few words
 * describing the task, so the board reads as a list of work items instead of a
 * list of repeated folder names.
 *
 * Primary source is the session's own transcript (the first user messages).
 * Terminal output is a fallback for sessions that have no transcript yet.
 * Without an API key configured we still beat the folder name by trimming the
 * first message down to a card-sized label.
 */

const SYSTEM_PROMPT = `You name coding sessions. Given the first messages a developer sent to an AI coding assistant, produce a short title describing the task.

Rules:
- 2 to 5 words. Never more.
- Title Case, no trailing punctuation, no quotes.
- Name the TASK, not the tool or the repo. "Fix Login Redirect", not "Claude Session" or "my-app".
- Be specific: prefer "Stripe Refund Webhooks" over "Backend Work".
- Do not include the project or folder name — it is displayed separately.
- If the messages are too vague to name, use the dominant topic word plus a verb.

Respond with ONLY a JSON object:
{"title": "Short Task Title"}`

const MAX_TITLE_CHARS = 42
const MAX_SOURCE_CHARS = 1500
const MIN_CONTENT_CHARS = 12

class SessionTitler {
  /** True when an API key is present and session naming has not been switched off. */
  isAiEnabled(): boolean {
    const config = promptEnhancer.getConfig()
    return config.apiKey.length > 0 && config.titlesEnabled !== false
  }

  /**
   * Returns null when there is nothing to name from yet — callers should keep
   * showing the folder name and try again later.
   */
  async generate(req: SessionTitleRequest): Promise<SessionTitleResponse | null> {
    const source = this.collectSource(req)
    if (source.trim().length < MIN_CONTENT_CHARS) return null

    if (this.isAiEnabled()) {
      const aiTitle = await this.generateWithAi(source, req.folderName)
      if (aiTitle) return aiTitle
    }

    const fallback = heuristicTitle(source)
    return fallback ? { title: fallback, source: 'heuristic', costUsd: 0 } : null
  }

  private collectSource(req: SessionTitleRequest): string {
    if (req.claudeSessionId) {
      const messages = getSessionUserMessages(req.claudeSessionId, req.cwd)
      if (messages.length > 0) return messages.join('\n---\n').slice(0, MAX_SOURCE_CHARS)
    }
    // No transcript yet — fall back to whatever the terminal has shown. Only
    // populated while the Prompt Enhancer is on, since that owns the buffer.
    return promptEnhancer.getContext(req.sessionId, MAX_SOURCE_CHARS)
  }

  private async generateWithAi(source: string, folderName: string): Promise<SessionTitleResponse | null> {
    const result = await chatCompletion({
      config: promptEnhancer.getConfig(),
      system: SYSTEM_PROMPT,
      user: `Project folder (do not use in the title): ${folderName}\n\nFirst messages:\n${source}`,
      temperature: 0.2,
      maxTokens: 40,
      label: 'SessionTitler',
    })
    if (!result) return null

    const parsed = parseJsonContent<{ title?: unknown }>(result.content)
    const title = cleanTitle(typeof parsed?.title === 'string' ? parsed.title : result.content)
    if (!title) return null

    return { title, source: 'ai', costUsd: result.costUsd }
  }
}

/** Normalize a model-produced title into something safe to render on a card. */
export function cleanTitle(raw: string): string {
  // Strip surrounding whitespace, quotes, and trailing punctuation in one pass —
  // anchoring on quotes alone misses `  "Title".  ` style responses.
  const collapsed = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`]+/, '')
    .replace(/[\s"'`.,;:!?]+$/, '')
  if (!collapsed) return ''
  if (collapsed.length <= MAX_TITLE_CHARS) return collapsed

  // Break on a word boundary so truncated fallback titles stay readable.
  const clipped = collapsed.slice(0, MAX_TITLE_CHARS - 1)
  const lastSpace = clipped.lastIndexOf(' ')
  const stem = lastSpace > MAX_TITLE_CHARS / 2 ? clipped.slice(0, lastSpace) : clipped
  return stem.replace(/[\s.,;:!?]+$/, '') + '…'
}

/**
 * Card-sized label from raw message text, for when no AI is configured.
 * Takes the first sentence or line, whichever is shorter.
 */
export function heuristicTitle(source: string): string {
  const firstLine = source.split('\n').map(l => l.trim()).find(l => l.length > 0) || ''
  if (!firstLine) return ''
  const firstSentence = firstLine.split(/[.!?](?:\s|$)/)[0].trim()
  const short = firstSentence.length > 0 && firstSentence.length < firstLine.length
    ? firstSentence
    : firstLine
  return cleanTitle(short)
}

export const sessionTitler = new SessionTitler()
