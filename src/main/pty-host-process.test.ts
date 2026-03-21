/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PtyHostMessage, PtyClientMessage } from './pty-ipc-protocol'
import * as nodePtyMock from './__mocks__/node-pty'

const { mockPtyProcess, mockSpawn } = nodePtyMock

// Inject mock before pty-host-process loads (it checks globalThis.__PTY_FOR_TEST__)
;(globalThis as any).__PTY_FOR_TEST__ = nodePtyMock

// Dynamic import so the mock is already injected
const { PtyHostProcess } = await import('./pty-host-process')

describe('PtyHostProcess', () => {
  let send: ReturnType<typeof vi.fn>
  let host: InstanceType<typeof PtyHostProcess>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    mockPtyProcess.onData.mockImplementation((cb: (d: string) => void) => {
      ;(mockPtyProcess as any)._onData = cb
    })
    mockPtyProcess.onExit.mockImplementation((cb: (e: { exitCode: number }) => void) => {
      ;(mockPtyProcess as any)._onExit = cb
    })

    send = vi.fn()
    host = new PtyHostProcess(send)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns a PTY session and emits spawned message', () => {
    const msg: PtyClientMessage = {
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: { HOME: '/home/user' },
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    }

    host.handleMessage(msg)

    expect(mockSpawn).toHaveBeenCalledWith('/bin/zsh', ['-i'], expect.objectContaining({
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
    }))

    expect(send).toHaveBeenCalledWith({
      type: 'spawned',
      sessionId: 's1',
    } satisfies PtyHostMessage)
  })

  it('forwards PTY data as data messages', () => {
    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })

    // Clear the 'spawned' message from send mock
    send.mockClear()

    // Trigger PTY data callback
    const onDataCb = (mockPtyProcess as any)._onData
    expect(onDataCb).toBeDefined()
    onDataCb('hello world')

    expect(send).toHaveBeenCalledWith({
      type: 'data',
      sessionId: 's1',
      data: 'hello world',
    } satisfies PtyHostMessage)
  })

  it('sends exit message when PTY exits', () => {
    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })
    send.mockClear()

    const onExitCb = (mockPtyProcess as any)._onExit
    expect(onExitCb).toBeDefined()
    onExitCb({ exitCode: 42 })

    expect(send).toHaveBeenCalledWith({
      type: 'exit',
      sessionId: 's1',
      exitCode: 42,
    } satisfies PtyHostMessage)
  })

  it('forwards write messages to the PTY', () => {
    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })

    host.handleMessage({
      type: 'write',
      sessionId: 's1',
      data: 'echo hi\n',
    })

    expect(mockPtyProcess.write).toHaveBeenCalledWith('echo hi\n')
  })

  it('forwards resize messages to the PTY', () => {
    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })

    host.handleMessage({
      type: 'resize',
      sessionId: 's1',
      cols: 120,
      rows: 40,
    })

    expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40)
  })

  it('kills PTY on kill message', () => {
    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })

    host.handleMessage({
      type: 'kill',
      sessionId: 's1',
    })

    expect(mockPtyProcess.kill).toHaveBeenCalled()
  })

  it('sends error message when spawn fails', () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error('spawn ENOENT')
    })

    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })

    expect(send).toHaveBeenCalledWith({
      type: 'error',
      sessionId: 's1',
      message: 'spawn ENOENT',
    } satisfies PtyHostMessage)

    // Should NOT have emitted 'spawned'
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'spawned' }))
  })

  it('destroy-all kills all sessions', () => {
    // Spawn two sessions
    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })
    host.handleMessage({
      type: 'spawn',
      sessionId: 's2',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })

    host.handleMessage({ type: 'destroy-all' })

    // Each session's pty.kill() should have been called
    expect(mockPtyProcess.kill).toHaveBeenCalledTimes(2)
  })

  it('sends command after 800ms delay when spawn includes command', () => {
    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
      command: 'cd /tmp',
    })

    expect(mockPtyProcess.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(799)
    expect(mockPtyProcess.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(mockPtyProcess.write).toHaveBeenCalledWith('cd /tmp\r')
  })

  it('emits placeholder snapshot response', () => {
    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {},
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })
    send.mockClear()

    host.handleMessage({
      type: 'snapshot',
      sessionId: 's1',
    })

    expect(send).toHaveBeenCalledWith({
      type: 'snapshot',
      sessionId: 's1',
      lines: [],
      cursorX: 0,
      cursorY: 0,
    } satisfies PtyHostMessage)
  })
})
