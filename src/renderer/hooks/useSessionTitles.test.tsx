import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionTitles } from './useSessionTitles'
import type { ClaudeSession } from './useClaudeSessions'

function makeSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: 's1',
    folderName: 'deckdrop-pro',
    folderPath: '/Users/dev/Workspace/deckdrop-pro',
    worktreePath: null,
    branchName: null,
    claudeSessionId: 'claude-abc',
    ...overrides,
  }
}

describe('useSessionTitles', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(window.api.sessionTitleGenerate).mockReset().mockResolvedValue({
      title: 'Fix Refund Webhooks',
      source: 'ai',
      costUsd: 0.0001,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('names a live unnamed session after the initial delay', async () => {
    const setSessionTitle = vi.fn()
    renderHook(() => useSessionTitles({ sessions: [makeSession()], setSessionTitle }))

    // Should NOT generate immediately.
    await act(async () => {})
    expect(window.api.sessionTitleGenerate).not.toHaveBeenCalled()

    // Advance past initial delay (90s) + one retry interval (30s).
    await act(async () => { vi.advanceTimersByTime(120_000) })

    expect(setSessionTitle).toHaveBeenCalledWith('s1', 'Fix Refund Webhooks', false)
  })

  it('passes the worktree path as the cwd when the session has one', async () => {
    const setSessionTitle = vi.fn()
    const session = makeSession({ worktreePath: '/Users/dev/.devdock/worktrees/dd/1/worktree' })
    renderHook(() => useSessionTitles({ sessions: [session], setSessionTitle }))

    await act(async () => { vi.advanceTimersByTime(120_000) })

    expect(window.api.sessionTitleGenerate).toHaveBeenCalled()
    expect(vi.mocked(window.api.sessionTitleGenerate).mock.calls[0][0]).toMatchObject({
      sessionId: 's1',
      cwd: '/Users/dev/.devdock/worktrees/dd/1/worktree',
      claudeSessionId: 'claude-abc',
    })
  })

  it('leaves already-named sessions alone', async () => {
    const setSessionTitle = vi.fn()
    renderHook(() => useSessionTitles({
      sessions: [makeSession({ title: 'Existing Name' })],
      setSessionTitle,
    }))

    await act(async () => { vi.advanceTimersByTime(200_000) })
    expect(window.api.sessionTitleGenerate).not.toHaveBeenCalled()
  })

  it('leaves manually pinned sessions alone even with no title', async () => {
    const setSessionTitle = vi.fn()
    renderHook(() => useSessionTitles({
      sessions: [makeSession({ titleManual: true })],
      setSessionTitle,
    }))

    await act(async () => { vi.advanceTimersByTime(200_000) })
    expect(window.api.sessionTitleGenerate).not.toHaveBeenCalled()
  })

  it('does not name exited or initializing sessions', async () => {
    const setSessionTitle = vi.fn()
    renderHook(() => useSessionTitles({
      sessions: [
        makeSession({ id: 'gone', exited: true }),
        makeSession({ id: 'booting', initializing: true }),
      ],
      setSessionTitle,
    }))

    await act(async () => { vi.advanceTimersByTime(200_000) })
    expect(window.api.sessionTitleGenerate).not.toHaveBeenCalled()
  })

  it('does not commit a title if the user renamed the session while naming ran', async () => {
    const setSessionTitle = vi.fn()
    let resolveGenerate: (v: unknown) => void = () => {}
    vi.mocked(window.api.sessionTitleGenerate).mockReturnValue(
      new Promise(resolve => { resolveGenerate = resolve }) as never
    )

    const { rerender } = renderHook(
      ({ sessions }) => useSessionTitles({ sessions, setSessionTitle }),
      { initialProps: { sessions: [makeSession()] } }
    )

    // Advance past the initial delay so it fires.
    await act(async () => { vi.advanceTimersByTime(120_000) })
    expect(window.api.sessionTitleGenerate).toHaveBeenCalled()

    // User renames by hand before the model answers.
    rerender({ sessions: [makeSession({ title: 'My Name', titleManual: true })] })
    await act(async () => {
      resolveGenerate({ title: 'Model Name', source: 'ai', costUsd: 0 })
    })

    expect(setSessionTitle).not.toHaveBeenCalled()
  })

  it('regenerateTitle overrides a manually pinned session', async () => {
    const setSessionTitle = vi.fn()
    const { result } = renderHook(() => useSessionTitles({
      sessions: [makeSession({ title: 'My Name', titleManual: true })],
      setSessionTitle,
    }))

    await act(async () => { result.current.regenerateTitle('s1') })

    expect(setSessionTitle).toHaveBeenCalledWith('s1', 'Fix Refund Webhooks', false)
  })

  it('reports which sessions are being named', async () => {
    const setSessionTitle = vi.fn()
    let resolveGenerate: (v: unknown) => void = () => {}
    vi.mocked(window.api.sessionTitleGenerate).mockReturnValue(
      new Promise(resolve => { resolveGenerate = resolve }) as never
    )

    const { result } = renderHook(() => useSessionTitles({
      sessions: [makeSession()],
      setSessionTitle,
    }))

    await act(async () => { vi.advanceTimersByTime(120_000) })

    expect(result.current.generatingIds.has('s1')).toBe(true)
    await act(async () => { resolveGenerate(null) })
    expect(result.current.generatingIds.has('s1')).toBe(false)
  })

  it('survives a failing generate call', async () => {
    const setSessionTitle = vi.fn()
    vi.mocked(window.api.sessionTitleGenerate).mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useSessionTitles({
      sessions: [makeSession()],
      setSessionTitle,
    }))

    await act(async () => { vi.advanceTimersByTime(120_000) })

    expect(window.api.sessionTitleGenerate).toHaveBeenCalled()
    expect(setSessionTitle).not.toHaveBeenCalled()
    expect(result.current.generatingIds.size).toBe(0)
  })

  it('stops retrying after the attempt budget is spent', async () => {
    const setSessionTitle = vi.fn()
    vi.mocked(window.api.sessionTitleGenerate).mockResolvedValue(null)

    renderHook(
      ({ sessions }) => useSessionTitles({ sessions, setSessionTitle }),
      { initialProps: { sessions: [makeSession()] } }
    )

    // Advance well past the initial delay and through many retry intervals.
    await act(async () => { vi.advanceTimersByTime(90_000 + 12 * 30_000) })

    expect(vi.mocked(window.api.sessionTitleGenerate).mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('does not attempt before the initial delay has passed', async () => {
    const setSessionTitle = vi.fn()
    renderHook(() => useSessionTitles({ sessions: [makeSession()], setSessionTitle }))

    // At 60 seconds — still within the 90s initial delay.
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(window.api.sessionTitleGenerate).not.toHaveBeenCalled()

    // At 120s total — past initial delay + one retry tick.
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(window.api.sessionTitleGenerate).toHaveBeenCalled()
  })
})
