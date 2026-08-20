import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
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
    vi.mocked(window.api.sessionTitleGenerate).mockReset().mockResolvedValue({
      title: 'Fix Refund Webhooks',
      source: 'ai',
      costUsd: 0.0001,
    })
  })

  it('names a live unnamed session', async () => {
    const setSessionTitle = vi.fn()
    renderHook(() => useSessionTitles({ sessions: [makeSession()], setSessionTitle }))

    await waitFor(() => {
      expect(setSessionTitle).toHaveBeenCalledWith('s1', 'Fix Refund Webhooks', false)
    })
  })

  it('passes the worktree path as the cwd when the session has one', async () => {
    const setSessionTitle = vi.fn()
    const session = makeSession({ worktreePath: '/Users/dev/.devdock/worktrees/dd/1/worktree' })
    renderHook(() => useSessionTitles({ sessions: [session], setSessionTitle }))

    await waitFor(() => expect(window.api.sessionTitleGenerate).toHaveBeenCalled())
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

    await Promise.resolve()
    expect(window.api.sessionTitleGenerate).not.toHaveBeenCalled()
  })

  it('leaves manually pinned sessions alone even with no title', async () => {
    const setSessionTitle = vi.fn()
    renderHook(() => useSessionTitles({
      sessions: [makeSession({ titleManual: true })],
      setSessionTitle,
    }))

    await Promise.resolve()
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

    await Promise.resolve()
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

    await waitFor(() => expect(result.current.generatingIds.has('s1')).toBe(true))
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

    await waitFor(() => expect(window.api.sessionTitleGenerate).toHaveBeenCalled())
    expect(setSessionTitle).not.toHaveBeenCalled()
    expect(result.current.generatingIds.size).toBe(0)
  })

  it('stops retrying after the attempt budget is spent', async () => {
    const setSessionTitle = vi.fn()
    vi.mocked(window.api.sessionTitleGenerate).mockResolvedValue(null)

    const { rerender } = renderHook(
      ({ sessions }) => useSessionTitles({ sessions, setSessionTitle }),
      { initialProps: { sessions: [makeSession()] } }
    )

    // Each session-list change is one attempt; the budget is 6.
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        rerender({ sessions: [makeSession({ branchName: `b${i}` })] })
      })
    }

    expect(vi.mocked(window.api.sessionTitleGenerate).mock.calls.length).toBeLessThanOrEqual(6)
  })
})
