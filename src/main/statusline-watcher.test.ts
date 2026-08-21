/**
 * @vitest-environment node
 *
 * Covers the Claude-session-id harvest: the statusline payload Claude Code
 * writes is the only authoritative, per-DevDock-session source of the id, so
 * these tests pin down that it is persisted, deduplicated, and forwarded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  watchFile: vi.fn(),
  unwatchFile: vi.fn(),
}))

const updateClaudeId = vi.fn()
vi.mock('./session-history', () => ({
  activeSessions: {
    updateClaudeId: (...args: unknown[]) => updateClaudeId(...args),
  },
}))

import { statuslineWatcher } from './statusline-watcher'

const CLAUDE_ID = 'f718d22a-8661-4c5d-bd3c-506fb7806450'
const TRANSCRIPT = `/Users/shayk/.claude/projects/-Users-shayk-Workspace-Research/${CLAUDE_ID}.jsonl`

/** A trimmed-down copy of a real statusline payload. */
function payload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    session_id: CLAUDE_ID,
    transcript_path: TRANSCRIPT,
    cwd: '/Users/shayk/Workspace/Research',
    model: { id: 'claude-opus-5', display_name: 'Opus 5' },
    cost: { total_cost_usd: 0.42 },
    ...overrides,
  })
}

/** Drive one watch tick for `devdockId` and return what was sent to the renderer. */
function tick(devdockId: string, raw: string) {
  const sent: any[] = []
  const win = {
    isDestroyed: () => false,
    webContents: { send: (_channel: string, data: unknown) => sent.push(data) },
  }
  statuslineWatcher.setMainWindow(win as never)
  vi.mocked(fs.readFileSync).mockReturnValue(raw as never)

  // watchFile is mocked, so invoke the registered callback directly.
  statuslineWatcher.watchSession(devdockId)
  const call = vi.mocked(fs.watchFile).mock.calls.at(-1) as unknown as [unknown, unknown, () => void]
  call[2]()
  return sent
}

describe('statusline harvest', () => {
  beforeEach(() => {
    updateClaudeId.mockClear()
    vi.mocked(fs.watchFile).mockClear()
    statuslineWatcher.unwatchAll()
  })

  it('persists the Claude session id and transcript path against the DevDock session', () => {
    tick('claude-aaa', payload())

    expect(updateClaudeId).toHaveBeenCalledWith('claude-aaa', CLAUDE_ID, TRANSCRIPT)
  })

  it('forwards the id to the renderer alongside the usual statusline fields', () => {
    const [data] = tick('claude-bbb', payload())

    expect(data).toMatchObject({
      sessionId: 'claude-bbb',
      claudeSessionId: CLAUDE_ID,
      transcriptPath: TRANSCRIPT,
      model: 'Opus 5',
      costUsd: 0.42,
    })
  })

  it('writes to disk once per id, not on every statusline render', () => {
    tick('claude-ccc', payload())
    tick('claude-ccc', payload())
    tick('claude-ccc', payload())

    expect(updateClaudeId).toHaveBeenCalledTimes(1)
  })

  it('records the new id when the session changes identity, as /clear does', () => {
    const second = '11111111-2222-3333-4444-555555555555'
    tick('claude-ddd', payload())
    tick('claude-ddd', payload({ session_id: second, transcript_path: `/p/${second}.jsonl` }))

    expect(updateClaudeId).toHaveBeenCalledTimes(2)
    expect(updateClaudeId).toHaveBeenLastCalledWith('claude-ddd', second, `/p/${second}.jsonl`)
  })

  it('keeps the two sessions apart when the same folder is open twice', () => {
    const otherId = '22222222-3333-4444-5555-666666666666'
    tick('claude-tab1', payload())
    tick('claude-tab2', payload({ session_id: otherId, transcript_path: `/p/${otherId}.jsonl` }))

    expect(updateClaudeId).toHaveBeenNthCalledWith(1, 'claude-tab1', CLAUDE_ID, TRANSCRIPT)
    expect(updateClaudeId).toHaveBeenNthCalledWith(2, 'claude-tab2', otherId, `/p/${otherId}.jsonl`)
  })

  it('still emits statusline data when the payload carries no session id', () => {
    const [data] = tick('claude-eee', JSON.stringify({ model: { display_name: 'Opus 5' } }))

    expect(updateClaudeId).not.toHaveBeenCalled()
    expect(data).toMatchObject({ sessionId: 'claude-eee', model: 'Opus 5' })
    expect(data.claudeSessionId).toBeUndefined()
  })

  it('ignores a malformed payload instead of throwing', () => {
    expect(() => tick('claude-fff', '{ not json')).not.toThrow()
    expect(updateClaudeId).not.toHaveBeenCalled()
  })

  it('re-reports the id after a session is unwatched and watched again', () => {
    tick('claude-ggg', payload())
    statuslineWatcher.unwatchSession('claude-ggg')
    tick('claude-ggg', payload())

    expect(updateClaudeId).toHaveBeenCalledTimes(2)
  })
})
