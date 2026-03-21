/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PtyHostMessage, PtyClientMessage } from './pty-ipc-protocol'
import * as nodePtyMock from './__mocks__/node-pty'

const { mockPtyProcess, mockSpawn } = nodePtyMock

// Inject mock before pty-host-process loads (it checks globalThis.__PTY_FOR_TEST__)
;(globalThis as any).__PTY_FOR_TEST__ = nodePtyMock

// Mock @xterm/headless for HeadlessEmulator (imported by pty-host-process)
vi.mock('@xterm/headless', () => import('./__mocks__/@xterm/headless'))

// Dynamic import so the mock is already injected
const { PtyHostProcess } = await import('./pty-host-process')

/** Helper: spawn a session and return the PTY data callback */
function spawnSession(
  host: InstanceType<typeof PtyHostProcess>,
  overrides: Partial<Extract<PtyClientMessage, { type: 'spawn' }>> = {},
) {
  const msg: PtyClientMessage = {
    type: 'spawn',
    sessionId: 's1',
    cols: 80,
    rows: 24,
    cwd: '/tmp',
    env: {},
    shell: '/bin/zsh',
    shellArgs: ['-i'],
    ...overrides,
  }
  host.handleMessage(msg)
  return {
    onData: (mockPtyProcess as any)._onData as (d: string) => void,
    onExit: (mockPtyProcess as any)._onExit as (e: { exitCode: number }) => void,
  }
}

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

  it('injects readiness env vars into PTY spawn', () => {
    host.handleMessage({
      type: 'spawn',
      sessionId: 's1',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: { HOME: '/home/user' },
      shell: '/bin/zsh',
      shellArgs: ['-i'],
    })

    // The env passed to pty.spawn should contain DEVDOCK_READY_MARKER
    const spawnEnv = mockSpawn.mock.calls[0][2].env
    expect(spawnEnv).toHaveProperty('DEVDOCK_READY_MARKER')
    expect(spawnEnv.DEVDOCK_READY_MARKER).toMatch(/^__DEVDOCK_READY_/)
    // Original env vars should still be present
    expect(spawnEnv.HOME).toBe('/home/user')
  })

  it('injects DEVDOCK_SHELL_INIT env var into PTY spawn', () => {
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

    const spawnEnv = mockSpawn.mock.calls[0][2].env
    expect(spawnEnv).toHaveProperty('DEVDOCK_SHELL_INIT')
    expect(spawnEnv.DEVDOCK_SHELL_INIT).toContain('echo')
  })

  it('forwards PTY data as data messages (after readiness filtering)', () => {
    const { onData } = spawnSession(host)
    send.mockClear()

    // Simulate readiness marker in first output to make shell ready
    const marker = mockSpawn.mock.calls[0][2].env.DEVDOCK_READY_MARKER
    onData(`init\n${marker}\n`)

    // Clear again to ignore the ready and data messages from init
    send.mockClear()

    // Now send normal data — should pass through
    onData('hello world')

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'data',
      sessionId: 's1',
      data: 'hello world',
    }))
  })

  it('sends exit message when PTY exits', () => {
    const { onExit } = spawnSession(host)
    send.mockClear()

    onExit({ exitCode: 42 })

    expect(send).toHaveBeenCalledWith({
      type: 'exit',
      sessionId: 's1',
      exitCode: 42,
    } satisfies PtyHostMessage)
  })

  it('buffers write messages before shell is ready', () => {
    spawnSession(host)

    // Write before the shell is ready — should be buffered, NOT written to PTY
    host.handleMessage({
      type: 'write',
      sessionId: 's1',
      data: 'echo hi\n',
    })

    expect(mockPtyProcess.write).not.toHaveBeenCalledWith('echo hi\n')
  })

  it('forwards write messages to PTY after shell is ready', () => {
    const { onData } = spawnSession(host)

    // Trigger readiness
    const marker = mockSpawn.mock.calls[0][2].env.DEVDOCK_READY_MARKER
    onData(`${marker}\n`)
    mockPtyProcess.write.mockClear()

    // Write after ready — should pass through to PTY
    host.handleMessage({
      type: 'write',
      sessionId: 's1',
      data: 'echo hi\n',
    })

    expect(mockPtyProcess.write).toHaveBeenCalledWith('echo hi\n')
  })

  it('forwards resize messages to the PTY', () => {
    spawnSession(host)

    host.handleMessage({
      type: 'resize',
      sessionId: 's1',
      cols: 120,
      rows: 40,
    })

    expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40)
  })

  it('kills PTY on kill message', () => {
    spawnSession(host)

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

  // ── Shell readiness integration ──────────────────────────────────

  it('sends command via readiness callback (no setTimeout)', () => {
    const { onData } = spawnSession(host, { command: 'cd /tmp' })

    // Before readiness fires, command should NOT have been written
    expect(mockPtyProcess.write).not.toHaveBeenCalled()

    // Even after 800ms, command should NOT be written (no setTimeout anymore)
    vi.advanceTimersByTime(1000)
    expect(mockPtyProcess.write).not.toHaveBeenCalledWith('cd /tmp\r')

    // Trigger readiness by simulating marker in PTY output
    const marker = mockSpawn.mock.calls[0][2].env.DEVDOCK_READY_MARKER
    onData(`${marker}\n`)

    // Now command should have been written
    expect(mockPtyProcess.write).toHaveBeenCalledWith('cd /tmp\r')
  })

  it('emits ready message when shell becomes ready', () => {
    const { onData } = spawnSession(host)
    send.mockClear()

    // Trigger readiness
    const marker = mockSpawn.mock.calls[0][2].env.DEVDOCK_READY_MARKER
    onData(`${marker}\n`)

    expect(send).toHaveBeenCalledWith({
      type: 'ready',
      sessionId: 's1',
    } satisfies PtyHostMessage)
  })

  it('flushes buffered user writes when shell becomes ready', () => {
    const { onData } = spawnSession(host)

    // Buffer some user input
    host.handleMessage({ type: 'write', sessionId: 's1', data: 'ls\n' })
    host.handleMessage({ type: 'write', sessionId: 's1', data: 'pwd\n' })
    expect(mockPtyProcess.write).not.toHaveBeenCalledWith('ls\n')

    // Trigger readiness
    const marker = mockSpawn.mock.calls[0][2].env.DEVDOCK_READY_MARKER
    onData(`${marker}\n`)

    // Buffered writes should have been flushed
    expect(mockPtyProcess.write).toHaveBeenCalledWith('ls\n')
    expect(mockPtyProcess.write).toHaveBeenCalledWith('pwd\n')
  })

  it('strips readiness marker from data messages', () => {
    const { onData } = spawnSession(host)
    send.mockClear()

    const marker = mockSpawn.mock.calls[0][2].env.DEVDOCK_READY_MARKER
    onData(`init output\n${marker}\nprompt$ `)

    // Collect all data messages
    const dataMessages = send.mock.calls
      .map(c => c[0])
      .filter((m: PtyHostMessage) => m.type === 'data')
    const allData = dataMessages.map((m: any) => m.data).join('')

    // Marker should not appear in data sent to client
    expect(allData).not.toContain(marker)
    // But surrounding output should be present
    expect(allData).toContain('init output')
    expect(allData).toContain('prompt$ ')
  })

  // ── Snapshot integration ────────────────────────────────────────

  it('returns real snapshot data from headless emulator', () => {
    const { onData } = spawnSession(host)
    send.mockClear()

    // Feed some data through the PTY
    const marker = mockSpawn.mock.calls[0][2].env.DEVDOCK_READY_MARKER
    onData(`${marker}\nhello from terminal`)

    // Clear messages from data feeding
    send.mockClear()

    // Request snapshot
    host.handleMessage({ type: 'snapshot', sessionId: 's1' })

    const snapshotMsg = send.mock.calls[0][0] as PtyHostMessage
    expect(snapshotMsg.type).toBe('snapshot')
    expect(snapshotMsg).toHaveProperty('lines')
    // Snapshot should have non-empty content (not empty placeholder)
    const lines = (snapshotMsg as any).lines as string[]
    const nonEmpty = lines.filter((l: string) => l.length > 0)
    expect(nonEmpty.length).toBeGreaterThan(0)
    expect(nonEmpty.some((l: string) => l.includes('hello from terminal'))).toBe(true)
  })

  // ── Resize updates emulator ─────────────────────────────────────

  it('resize updates the headless emulator dimensions', () => {
    const { onData } = spawnSession(host)

    // Trigger readiness first
    const marker = mockSpawn.mock.calls[0][2].env.DEVDOCK_READY_MARKER
    onData(`${marker}\n`)
    send.mockClear()

    // Resize
    host.handleMessage({ type: 'resize', sessionId: 's1', cols: 120, rows: 40 })

    // Feed data and take snapshot to verify emulator knows the new size
    onData('after resize')
    send.mockClear()

    host.handleMessage({ type: 'snapshot', sessionId: 's1' })

    const snapshotMsg = send.mock.calls[0][0] as PtyHostMessage
    expect(snapshotMsg.type).toBe('snapshot')
    // The emulator should have resized — snapshot should contain the new data
    const lines = (snapshotMsg as any).lines as string[]
    const nonEmpty = lines.filter((l: string) => l.length > 0)
    expect(nonEmpty.some((l: string) => l.includes('after resize'))).toBe(true)
  })
})
