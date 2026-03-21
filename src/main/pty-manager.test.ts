/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'stream'
import { encodeMessage } from './pty-ipc-protocol'
import type { PtyHostMessage } from './pty-ipc-protocol'

// ─── Mock child_process.fork ──────────────────────────────────────

let mockStdin: PassThrough
let mockStdout: PassThrough
let mockStderr: PassThrough
let mockChild: ReturnType<typeof createMockChild>
let forkSpy: ReturnType<typeof vi.fn>

function createMockChild() {
  mockStdin = new PassThrough()
  mockStdout = new PassThrough()
  mockStderr = new PassThrough()
  const child = Object.assign(new (require('events').EventEmitter)(), {
    stdin: mockStdin,
    stdout: mockStdout,
    stderr: mockStderr,
    pid: 12345,
    kill: vi.fn(),
    connected: true,
  })
  return child
}

vi.mock('child_process', () => ({
  fork: vi.fn(() => {
    mockChild = createMockChild()
    return mockChild
  }),
}))

vi.mock('electron', () => {
  class MockBrowserWindow {
    isDestroyed = () => false
    webContents = { send: vi.fn() }
  }
  return { BrowserWindow: MockBrowserWindow }
})

vi.mock('./browser-bridge', () => ({
  getBridgePort: vi.fn().mockReturnValue(0),
}))

// ─── Import after mocks ──────────────────────────────────────────

import { BrowserWindow } from 'electron'
import { PtyManager } from './pty-manager'

// ─── Helper: send a host message to the proxy ────────────────────

function simulateHostMessage(msg: PtyHostMessage) {
  const frame = encodeMessage(msg)
  mockStdout.write(frame)
}

describe('PtyManager (proxy)', () => {
  let manager: PtyManager
  let mockWindow: InstanceType<typeof BrowserWindow>

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new PtyManager()
    mockWindow = new BrowserWindow()
    manager.setMainWindow(mockWindow)

    // Start host eagerly so mockStdin is stable for all tests
    manager.startHost()
  })

  afterEach(() => {
    manager.stopHost()
  })

  describe('1. Session lifecycle', () => {
    it('createSession returns success and tracks session locally', () => {
      const result = manager.createSession(
        's1', 'my-folder', '/path/to/folder', null, null, 'ls'
      )
      expect(result).toEqual({
        success: true,
        id: 's1',
        folderName: 'my-folder',
        worktreePath: null,
        branchName: null,
      })
    })

    it('getSessions returns created sessions', () => {
      manager.createSession('s1', 'my-folder', '/path/to/folder', null, null, 'ls')
      const sessions = manager.getSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toEqual({
        id: 's1',
        folderName: 'my-folder',
        worktreePath: null,
        branchName: null,
      })
    })

    it('destroySession removes from local map', () => {
      manager.createSession('s1', 'my-folder', '/path/to/folder', null, null, 'ls')
      expect(manager.getSessions()).toHaveLength(1)
      manager.destroySession('s1')
      expect(manager.getSessions()).toEqual([])
    })

    it('destroyAll clears all sessions', () => {
      manager.createSession('s1', 'f1', '/p1', null, null, 'ls')
      manager.createSession('s2', 'f2', '/p2', null, null, 'ls')
      expect(manager.getSessions()).toHaveLength(2)
      manager.destroyAll()
      expect(manager.getSessions()).toEqual([])
    })
  })

  describe('2. Duplicate session handling', () => {
    it('creating session with same ID destroys old session first', () => {
      manager.createSession('s1', 'folder1', '/path/1', null, null, 'cmd1')
      manager.createSession('s1', 'folder2', '/path/2', null, null, 'cmd2')
      expect(manager.getSessions()).toHaveLength(1)
      expect(manager.getSessions()[0].folderName).toBe('folder2')
    })
  })

  describe('3. IPC message sending', () => {
    it('createSession sends spawn message to host', () => {
      const stdinWriteSpy = vi.spyOn(mockStdin, 'write')
      manager.createSession('s1', 'f', '/p', null, null, 'ls')

      const calls = stdinWriteSpy.mock.calls
      expect(calls.length).toBeGreaterThan(0)

      // Decode the written frame to verify it contains a spawn message
      const lastFrame = calls[calls.length - 1][0] as Buffer
      const payloadLen = lastFrame.readUInt32BE(0)
      const json = JSON.parse(lastFrame.subarray(4, 4 + payloadLen).toString())
      expect(json.type).toBe('spawn')
      expect(json.sessionId).toBe('s1')
      expect(json.cwd).toBe('/p')
    })

    it('write() sends write message to host', () => {
      manager.createSession('s1', 'f', '/p', null, null, 'ls')
      const stdinWriteSpy = vi.spyOn(mockStdin, 'write')
      manager.write('s1', 'echo hi\n')

      const calls = stdinWriteSpy.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const frame = calls[calls.length - 1][0] as Buffer
      const payloadLen = frame.readUInt32BE(0)
      const json = JSON.parse(frame.subarray(4, 4 + payloadLen).toString())
      expect(json.type).toBe('write')
      expect(json.sessionId).toBe('s1')
      expect(json.data).toBe('echo hi\n')
    })

    it('resize() sends resize message to host', () => {
      manager.createSession('s1', 'f', '/p', null, null, 'ls')
      const stdinWriteSpy = vi.spyOn(mockStdin, 'write')
      manager.resize('s1', 120, 30)

      const calls = stdinWriteSpy.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const frame = calls[calls.length - 1][0] as Buffer
      const payloadLen = frame.readUInt32BE(0)
      const json = JSON.parse(frame.subarray(4, 4 + payloadLen).toString())
      expect(json.type).toBe('resize')
      expect(json.sessionId).toBe('s1')
      expect(json.cols).toBe(120)
      expect(json.rows).toBe(30)
    })

    it('destroySession sends kill message to host', () => {
      manager.createSession('s1', 'f', '/p', null, null, 'ls')
      const stdinWriteSpy = vi.spyOn(mockStdin, 'write')
      manager.destroySession('s1')

      const calls = stdinWriteSpy.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const frame = calls[calls.length - 1][0] as Buffer
      const payloadLen = frame.readUInt32BE(0)
      const json = JSON.parse(frame.subarray(4, 4 + payloadLen).toString())
      expect(json.type).toBe('kill')
      expect(json.sessionId).toBe('s1')
    })

    it('destroyAll sends destroy-all message to host', () => {
      manager.createSession('s1', 'f', '/p', null, null, 'ls')
      const stdinWriteSpy = vi.spyOn(mockStdin, 'write')
      manager.destroyAll()

      const calls = stdinWriteSpy.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const frame = calls[calls.length - 1][0] as Buffer
      const payloadLen = frame.readUInt32BE(0)
      const json = JSON.parse(frame.subarray(4, 4 + payloadLen).toString())
      expect(json.type).toBe('destroy-all')
    })
  })

  describe('4. Host message dispatch', () => {
    it('data from host forwarded to mainWindow.webContents.send and dataHooks', async () => {
      const hookFn = vi.fn()
      manager.onData(hookFn)
      manager.createSession('s1', 'f', '/p', null, null, 'ls')

      simulateHostMessage({ type: 'data', sessionId: 's1', data: 'hello world' })
      // Allow microtask/event loop tick for stream data handler
      await new Promise(r => setTimeout(r, 10))

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty-data', {
        sessionId: 's1',
        data: 'hello world',
      })
      expect(hookFn).toHaveBeenCalledWith('s1', 'hello world')
    })

    it('exit from host forwarded to mainWindow, exitHooks, removes session', async () => {
      const hookFn = vi.fn()
      manager.onExit(hookFn)
      manager.createSession('s1', 'f', '/p', null, null, 'ls')
      expect(manager.getSessions()).toHaveLength(1)

      simulateHostMessage({ type: 'exit', sessionId: 's1', exitCode: 0 })
      await new Promise(r => setTimeout(r, 10))

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty-exit', {
        sessionId: 's1',
        exitCode: 0,
      })
      expect(hookFn).toHaveBeenCalledWith('s1')
      expect(manager.getSessions()).toEqual([])
    })

    it('ready from host forwarded to mainWindow pty-ready', async () => {
      manager.createSession('s1', 'f', '/p', null, null, 'ls')

      simulateHostMessage({ type: 'ready', sessionId: 's1' })
      await new Promise(r => setTimeout(r, 10))

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty-ready', {
        sessionId: 's1',
      })
    })
  })

  describe('5. Write/Resize guard clauses', () => {
    it('write() does nothing when session does not exist', () => {
      // Should not throw
      expect(() => manager.write('nonexistent', 'ls\n')).not.toThrow()
    })

    it('resize() does nothing when session does not exist', () => {
      expect(() => manager.resize('nonexistent', 120, 30)).not.toThrow()
    })
  })

  describe('6. Environment', () => {
    it('sets TERM, deletes CLAUDECODE, sets DEVDOCK_SESSION_ID in spawn message', () => {
      const hadClaudecode = 'CLAUDECODE' in process.env
      process.env.CLAUDECODE = 'nested'
      try {
        const stdinWriteSpy = vi.spyOn(mockStdin, 'write')
        manager.createSession('my-session-id', 'f', '/p', null, null, 'ls')

        // Find spawn message
        const calls = stdinWriteSpy.mock.calls
        const frame = calls[calls.length - 1][0] as Buffer
        const payloadLen = frame.readUInt32BE(0)
        const json = JSON.parse(frame.subarray(4, 4 + payloadLen).toString())

        expect(json.type).toBe('spawn')
        expect(json.env.TERM).toBe('xterm-256color')
        expect(json.env.CLAUDECODE).toBeUndefined()
        expect(json.env.DEVDOCK_SESSION_ID).toBe('my-session-id')
        expect(json.env.DISABLE_AUTO_UPDATE).toBe('true')
      } finally {
        if (!hadClaudecode) delete process.env.CLAUDECODE
      }
    })
  })

  describe('7. Guard clauses', () => {
    it('getSessions() returns empty array initially', () => {
      expect(manager.getSessions()).toEqual([])
    })

    it('destroySession() does nothing when session does not exist', () => {
      expect(() => manager.destroySession('nonexistent')).not.toThrow()
    })
  })

  describe('8. Window destroyed safety', () => {
    it('onData does not throw when mainWindow.isDestroyed() returns true', async () => {
      mockWindow.isDestroyed = () => true
      manager.createSession('s1', 'f', '/p', null, null, 'ls')

      simulateHostMessage({ type: 'data', sessionId: 's1', data: 'data' })
      await new Promise(r => setTimeout(r, 10))

      // Should not have sent to webContents
      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    it('onExit does not throw when mainWindow.isDestroyed() returns true', async () => {
      mockWindow.isDestroyed = () => true
      manager.createSession('s1', 'f', '/p', null, null, 'ls')

      simulateHostMessage({ type: 'exit', sessionId: 's1', exitCode: 1 })
      await new Promise(r => setTimeout(r, 10))

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
      expect(manager.getSessions()).toEqual([])
    })
  })

  describe('9. getSnapshot', () => {
    it('sends snapshot request and resolves with host response', async () => {
      manager.createSession('s1', 'f', '/p', null, null, 'ls')

      const snapshotPromise = manager.getSnapshot('s1')

      // Simulate host responding with snapshot
      simulateHostMessage({
        type: 'snapshot',
        sessionId: 's1',
        lines: ['line1', 'line2'],
        cursorX: 5,
        cursorY: 1,
      })

      const result = await snapshotPromise
      expect(result).toEqual({
        lines: ['line1', 'line2'],
        cursorX: 5,
        cursorY: 1,
      })
    })

    it('rejects after timeout if host does not respond', async () => {
      vi.useFakeTimers()
      manager.createSession('s1', 'f', '/p', null, null, 'ls')

      const snapshotPromise = manager.getSnapshot('s1')

      vi.advanceTimersByTime(2000)

      await expect(snapshotPromise).rejects.toThrow('Snapshot timeout')
      vi.useRealTimers()
    })
  })

  describe('10. Host crash recovery', () => {
    it('notifies all sessions as exited when host process exits', async () => {
      const exitHook = vi.fn()
      manager.onExit(exitHook)
      manager.createSession('s1', 'f1', '/p1', null, null, 'ls')
      manager.createSession('s2', 'f2', '/p2', null, null, 'ls')
      expect(manager.getSessions()).toHaveLength(2)

      // Simulate host crash
      mockChild.emit('exit', 1, null)
      await new Promise(r => setTimeout(r, 10))

      expect(manager.getSessions()).toEqual([])
      expect(exitHook).toHaveBeenCalledWith('s1')
      expect(exitHook).toHaveBeenCalledWith('s2')
    })
  })

  describe('11. Worktree path handling', () => {
    it('uses worktreePath as cwd in spawn message when provided', () => {
      const stdinWriteSpy = vi.spyOn(mockStdin, 'write')
      manager.createSession('s1', 'f', '/project', '/wt/path', 'feature-branch', 'ls')

      const calls = stdinWriteSpy.mock.calls
      const frame = calls[calls.length - 1][0] as Buffer
      const payloadLen = frame.readUInt32BE(0)
      const json = JSON.parse(frame.subarray(4, 4 + payloadLen).toString())

      expect(json.type).toBe('spawn')
      expect(json.cwd).toBe('/wt/path')
    })
  })
})
