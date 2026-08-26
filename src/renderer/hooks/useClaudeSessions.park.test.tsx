import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useClaudeSessions } from './useClaudeSessions'
import type { KanbanColumn } from '../../shared/ipc-types'

const COLUMNS: KanbanColumn[] = [
  { id: 'backlog', name: 'Backlog', order: 0 },
  { id: 'done', name: 'Done', order: 1, manualLoad: true },
]

function savedSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'claude-1',
    claudeSessionId: 'abc-123',
    folderName: 'devdock',
    folderPath: '/w/devdock',
    worktreePath: null,
    branchName: null,
    dangerousMode: false,
    columnId: 'backlog',
    ...overrides,
  }
}

/** Mount the hook with one restored session already running. */
async function mountWithLiveSession(overrides: Record<string, unknown> = {}) {
  vi.mocked(window.api.activeSessionsGetAll).mockResolvedValue([savedSession(overrides)] as never)
  vi.mocked(window.api.ptyCreate).mockResolvedValue({
    success: true, folderName: 'devdock', worktreePath: null, branchName: null,
  } as never)

  const hook = renderHook(() => useClaudeSessions({ dangerousMode: false }))
  await waitFor(() => expect(hook.result.current.sessions).toHaveLength(1))
  return hook
}

describe('useClaudeSessions — parking', () => {
  beforeEach(() => {
    vi.mocked(window.api.kanbanGetColumns).mockResolvedValue(COLUMNS as never)
    vi.mocked(window.api.ptyDestroy).mockReset().mockResolvedValue(undefined as never)
    vi.mocked(window.api.ptyCreate).mockReset()
    vi.mocked(window.api.activeSessionsSet).mockReset()
    vi.mocked(window.api.activeSessionsRemove).mockReset()
  })

  it('closes the PTY and marks the session dormant, keeping the card', async () => {
    const { result } = await mountWithLiveSession()
    expect(result.current.sessions[0].dormant).toBeFalsy()

    await act(async () => { await result.current.parkSession('claude-1') })

    expect(window.api.ptyDestroy).toHaveBeenCalledWith('claude-1')
    const session = result.current.sessions[0]
    expect(session.dormant).toBe(true)
    expect(session.exited).toBe(false)
    // The card must survive — parking is not closing.
    expect(result.current.sessions).toHaveLength(1)
    expect(session.claudeSessionId).toBe('abc-123')
    // The saved record must stay, so the session restores dormant next launch.
    expect(window.api.activeSessionsRemove).not.toHaveBeenCalled()
  })

  it('refuses to park a session with no transcript to resume', async () => {
    const { result } = await mountWithLiveSession({ claudeSessionId: null })

    let parked: boolean | undefined
    await act(async () => { parked = await result.current.parkSession('claude-1') })

    expect(parked).toBe(false)
    // Killing it would lose the conversation outright, so it stays running.
    expect(window.api.ptyDestroy).not.toHaveBeenCalled()
    expect(result.current.sessions[0].dormant).toBeFalsy()
  })

  it('does not re-park an already dormant session', async () => {
    const { result } = await mountWithLiveSession()
    await act(async () => { await result.current.parkSession('claude-1') })
    vi.mocked(window.api.ptyDestroy).mockClear()

    let parked: boolean | undefined
    await act(async () => { parked = await result.current.parkSession('claude-1') })

    expect(parked).toBe(false)
    expect(window.api.ptyDestroy).not.toHaveBeenCalled()
  })

  it('loads a parked session back, reusing its id and resuming the transcript', async () => {
    const { result } = await mountWithLiveSession()
    await act(async () => { await result.current.parkSession('claude-1') })

    vi.mocked(window.api.ptyCreate).mockResolvedValue({
      success: true, folderName: 'devdock', worktreePath: null, branchName: 'feat/x',
    } as never)
    await act(async () => { await result.current.loadSession('claude-1') })

    expect(window.api.ptyCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'claude-1', resumeClaudeId: 'abc-123' })
    )
    expect(result.current.sessions[0].dormant).toBe(false)
    expect(result.current.sessions[0].branchName).toBe('feat/x')
  })

  it('restores a session in a manual-load column without starting a PTY', async () => {
    vi.mocked(window.api.activeSessionsGetAll)
      .mockResolvedValue([savedSession({ columnId: 'done' })] as never)
    vi.mocked(window.api.ptyCreate).mockResolvedValue({ success: true } as never)

    const { result } = renderHook(() => useClaudeSessions({ dangerousMode: false }))
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    expect(result.current.sessions[0].dormant).toBe(true)
    expect(window.api.ptyCreate).not.toHaveBeenCalled()
  })
})
