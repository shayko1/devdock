import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getSessionUserMessages = vi.fn<(id: string, cwd: string, limit?: number) => string[]>()
const getConfig = vi.fn()
const getContext = vi.fn<(id: string, max?: number) => string>()

vi.mock('./session-history', () => ({
  getSessionUserMessages: (...args: [string, string, number?]) => getSessionUserMessages(...args),
}))

vi.mock('./prompt-enhancer', () => ({
  promptEnhancer: {
    getConfig: () => getConfig(),
    getContext: (...args: [string, number?]) => getContext(...args),
  },
}))

import { sessionTitler, cleanTitle, heuristicTitle } from './session-titler'

const NO_AI = { enabled: false, apiKey: '', model: 'gpt-4.1-nano', baseUrl: '' }
const WITH_AI = { enabled: true, apiKey: 'sk-test', model: 'gpt-4.1-nano', baseUrl: '' }

const request = {
  sessionId: 'pty-1',
  folderName: 'deckdrop-pro',
  cwd: '/Users/dev/Workspace/deckdrop-pro',
  claudeSessionId: 'claude-abc',
}

function mockAiResponse(title: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ title }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 8 },
    }),
  } as unknown as Response
}

describe('sessionTitler', () => {
  beforeEach(() => {
    getSessionUserMessages.mockReset().mockReturnValue([])
    getContext.mockReset().mockReturnValue('')
    getConfig.mockReset().mockReturnValue(NO_AI)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when there is nothing to name from yet', async () => {
    expect(await sessionTitler.generate(request)).toBeNull()
  })

  it('returns null when the transcript holds only a trivial message', async () => {
    getSessionUserMessages.mockReturnValue(['hi'])
    expect(await sessionTitler.generate(request)).toBeNull()
  })

  it('falls back to a trimmed first message when no API key is configured', async () => {
    getSessionUserMessages.mockReturnValue(['Fix the intermittent login failure for invited viewers. It happens on reload.'])

    const result = await sessionTitler.generate(request)

    expect(result).toEqual({
      title: 'Fix the intermittent login failure for…',
      source: 'heuristic',
      costUsd: 0,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names the session with the AI when a key is configured', async () => {
    getConfig.mockReturnValue(WITH_AI)
    getSessionUserMessages.mockReturnValue(['Add Stripe refund webhook handlers and wire up DI'])
    vi.mocked(fetch).mockResolvedValue(mockAiResponse('Stripe Refund Webhooks'))

    const result = await sessionTitler.generate(request)

    expect(result?.title).toBe('Stripe Refund Webhooks')
    expect(result?.source).toBe('ai')
    expect(result?.costUsd).toBeGreaterThan(0)
  })

  it('does not call the AI when session naming is switched off', async () => {
    getConfig.mockReturnValue({ ...WITH_AI, titlesEnabled: false })
    getSessionUserMessages.mockReturnValue(['Add Stripe refund webhook handlers'])

    const result = await sessionTitler.generate(request)

    expect(fetch).not.toHaveBeenCalled()
    expect(result?.source).toBe('heuristic')
  })

  it('falls back to the heuristic when the AI call fails', async () => {
    getConfig.mockReturnValue(WITH_AI)
    getSessionUserMessages.mockReturnValue(['Investigate the dunning retry burst'])
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as unknown as Response)

    const result = await sessionTitler.generate(request)

    expect(result?.source).toBe('heuristic')
    expect(result?.title).toBe('Investigate the dunning retry burst')
  })

  it('uses terminal context when the session has no transcript', async () => {
    getSessionUserMessages.mockReturnValue([])
    getContext.mockReturnValue('rerun the failing migration for the orders table')

    const result = await sessionTitler.generate(request)

    expect(result?.title).toBe('rerun the failing migration for the…')
  })

  it('skips the transcript lookup entirely when there is no Claude session id', async () => {
    getContext.mockReturnValue('some terminal output that is long enough')

    await sessionTitler.generate({ ...request, claudeSessionId: null })

    expect(getSessionUserMessages).not.toHaveBeenCalled()
  })
})

describe('cleanTitle', () => {
  it('strips quotes, trailing punctuation, and collapses whitespace', () => {
    expect(cleanTitle('  "Fix   Login\nRedirect".  ')).toBe('Fix Login Redirect')
  })

  it('truncates long titles with an ellipsis', () => {
    const result = cleanTitle('A'.repeat(80))
    expect(result).toHaveLength(42)
    expect(result.endsWith('…')).toBe(true)
  })

  it('returns empty string for blank input', () => {
    expect(cleanTitle('   ')).toBe('')
  })
})

describe('heuristicTitle', () => {
  it('prefers the first sentence when shorter than the line', () => {
    expect(heuristicTitle('Fix the login bug. Then deploy it.')).toBe('Fix the login bug')
  })

  it('uses the whole first line when it has no sentence break', () => {
    expect(heuristicTitle('Add refund webhooks\nand tests')).toBe('Add refund webhooks')
  })

  it('skips leading blank lines', () => {
    expect(heuristicTitle('\n\n  Rename the sessions panel')).toBe('Rename the sessions panel')
  })
})
