export interface CoachSuggestion {
  id: string
  type: 'tip' | 'rewrite' | 'followup' | 'command'
  title: string
  body: string
  /** The rewritten prompt (for type='rewrite') or suggested command */
  suggestion?: string
  timestamp: number
}

export interface CoachAnalysis {
  sessionId: string
  suggestions: CoachSuggestion[]
  costUsd: number
  tokensUsed: { prompt: number; completion: number }
}

export interface CoachConfig {
  enabled: boolean
  apiKey: string
  model: string
  /** Override the OpenAI-compatible API base URL (e.g. company proxy). Empty = default. */
  baseUrl: string
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

export interface CoachSessionCost {
  totalUsd: number
  calls: number
  promptTokens: number
  completionTokens: number
}

/** Pricing per 1M tokens (USD) */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
}

export const DEFAULT_COACH_MODEL = 'gpt-4.1-nano'
