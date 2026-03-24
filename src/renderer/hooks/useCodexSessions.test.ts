import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodexSessions } from './useCodexSessions'

// Track the PTY exit listener so tests can fire it
let ptyExitCallback: ((data: { sessionId: string }) => void) | null = null

const mockPtyCreate = vi.fn()
const mockPtyDestroy = vi.fn(async () => {})
const mockCleanupWorktree = vi.fn(async () => {})
const mockOnPtyExit = vi.fn((cb: (data: { sessionId: string }) => void) => {
  ptyExitCallback = cb
  return () => { ptyExitCallback = null }
})

Object.defineProperty(globalThis, 'window', {
  value: {
    api: {
      ptyCreate: mockPtyCreate,
      ptyDestroy: mockPtyDestroy,
      cleanupWorktree: mockCleanupWorktree,
      onPtyExit: mockOnPtyExit,
    },
  },
  writable: true,
})

// Suppress window.confirm (used in closeSession for worktrees)
Object.defineProperty(globalThis, 'confirm', {
  value: vi.fn(() => false),
  writable: true,
})

const folder = { name: 'my-app', path: '/code/my-app', modifiedAt: '', gitBranch: null, gitRemote: null }

describe('useCodexSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ptyExitCallback = null
  })

  it('startSession adds placeholder then updates on success', async () => {
    mockPtyCreate.mockResolvedValueOnce({
      success: true,
      folderName: 'my-app',
      worktreePath: null,
      branchName: 'main',
    })

    const { result } = renderHook(() => useCodexSessions())

    await act(async () => {
      await result.current.startSession(folder, false)
    })

    // After resolution, session is finalized
    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].initializing).toBe(false)
    expect(result.current.sessions[0].branchName).toBe('main')
    expect(result.current.sessions[0].folderName).toBe('my-app')
  })

  it('startSession removes placeholder on failure and calls onError', async () => {
    mockPtyCreate.mockResolvedValueOnce({ success: false, error: 'codex not found' })

    const onError = vi.fn()
    const { result } = renderHook(() => useCodexSessions({ onError }))

    await act(async () => {
      await result.current.startSession(folder, false)
    })

    expect(result.current.sessions).toHaveLength(0)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('codex not found'))
  })

  it('does not call onError when error is "Cancelled"', async () => {
    mockPtyCreate.mockResolvedValueOnce({ success: false, error: 'Cancelled' })

    const onError = vi.fn()
    const { result } = renderHook(() => useCodexSessions({ onError }))

    await act(async () => {
      await result.current.startSession(folder, false)
    })

    expect(result.current.sessions).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
  })

  it('PTY exit event marks session as exited', async () => {
    mockPtyCreate.mockResolvedValueOnce({
      success: true,
      folderName: 'my-app',
      worktreePath: null,
      branchName: null,
    })

    const { result } = renderHook(() => useCodexSessions())

    await act(async () => {
      await result.current.startSession(folder, false)
    })

    const sessionId = result.current.sessions[0].id

    act(() => {
      ptyExitCallback!({ sessionId })
    })

    expect(result.current.sessions[0].exited).toBe(true)
  })

  it('closeSession calls ptyDestroy and removes session', async () => {
    mockPtyCreate.mockResolvedValueOnce({
      success: true,
      folderName: 'my-app',
      worktreePath: null,
      branchName: null,
    })

    const { result } = renderHook(() => useCodexSessions())

    await act(async () => {
      await result.current.startSession(folder, false)
    })

    const sessionId = result.current.sessions[0].id

    await act(async () => {
      await result.current.closeSession(sessionId)
    })

    expect(mockPtyDestroy).toHaveBeenCalledWith(sessionId)
    expect(result.current.sessions).toHaveLength(0)
  })

  it('closeSession prompts worktree cleanup when session has worktreePath', async () => {
    mockPtyCreate.mockResolvedValueOnce({
      success: true,
      folderName: 'my-app',
      worktreePath: '/worktrees/my-app',
      branchName: 'devdock/claude-my-app-1',
    })

    // confirm returns false → delete worktree
    vi.mocked(globalThis.confirm).mockReturnValueOnce(false)

    const { result } = renderHook(() => useCodexSessions())

    await act(async () => {
      await result.current.startSession(folder, true)
    })

    const sessionId = result.current.sessions[0].id

    await act(async () => {
      await result.current.closeSession(sessionId)
    })

    expect(mockCleanupWorktree).toHaveBeenCalledWith('/worktrees/my-app', '/code/my-app')
    expect(result.current.sessions).toHaveLength(0)
  })
})
