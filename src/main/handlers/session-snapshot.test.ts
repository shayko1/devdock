/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import type { PtySnapshotResult } from '../../shared/ipc-types'

// Mock electron ipcMain
vi.mock('electron', () => {
  const handlers = new Map<string, Function>()
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Function) => {
        handlers.set(channel, handler)
      }),
      on: vi.fn(),
      _handlers: handlers,
    },
    dialog: {
      showOpenDialog: vi.fn(),
    },
    BrowserWindow: vi.fn(),
  }
})

// Mock all dependencies of session.ts
vi.mock('../pty-manager', () => ({
  ptyManager: {
    createSession: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    destroySession: vi.fn(),
    getSessions: vi.fn().mockReturnValue([]),
    getSnapshot: vi.fn().mockResolvedValue({
      lines: ['$ echo hello', 'hello', '$ '],
      cursorX: 2,
      cursorY: 2,
    }),
  },
}))

vi.mock('../store', () => ({
  loadState: vi.fn().mockReturnValue({ dangerousMode: false, rtkEnabled: false }),
}))

vi.mock('../rtk-manager', () => ({
  cleanupSessionRtkFlag: vi.fn(),
}))

vi.mock('../coach-manager', () => ({
  coachManager: { clearSession: vi.fn() },
}))

vi.mock('../session-history', () => ({
  activeSessions: { set: vi.fn(), updateClaudeId: vi.fn(), remove: vi.fn(), getAll: vi.fn() },
  scanProjectSessions: vi.fn(),
  getSessionTitle: vi.fn(),
}))

vi.mock('../claude-md', () => ({
  ensureDevDockClaudeMd: vi.fn(),
}))

vi.mock('../statusline-watcher', () => ({
  statuslineWatcher: { watchSession: vi.fn(), unwatchSession: vi.fn() },
}))

// Import after mocks
import { registerSessionHandlers } from './session'
import { ptyManager } from '../pty-manager'

describe('pty-get-snapshot IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerSessionHandlers()
  })

  it('registers pty-get-snapshot handler', () => {
    const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
    const channels = handleCalls.map((call: any[]) => call[0])
    expect(channels).toContain('pty-get-snapshot')
  })

  it('handler calls ptyManager.getSnapshot and returns PtySnapshotResult', async () => {
    const handlers = (ipcMain as any)._handlers as Map<string, Function>
    const handler = handlers.get('pty-get-snapshot')
    expect(handler).toBeDefined()

    const result: PtySnapshotResult = await handler!({}, 'test-session-id')
    expect(ptyManager.getSnapshot).toHaveBeenCalledWith('test-session-id')
    expect(result).toEqual({
      lines: ['$ echo hello', 'hello', '$ '],
      cursorX: 2,
      cursorY: 2,
    })
  })

  it('PtySnapshotResult has correct shape', () => {
    const result: PtySnapshotResult = {
      lines: ['line1'],
      cursorX: 0,
      cursorY: 0,
    }
    expect(result.lines).toBeInstanceOf(Array)
    expect(typeof result.cursorX).toBe('number')
    expect(typeof result.cursorY).toBe('number')
  })
})
