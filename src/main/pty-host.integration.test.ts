/**
 * @vitest-environment node
 *
 * Integration test for PtyHostProcess — verifies the full lifecycle:
 *   spawn -> shell outputs init + marker -> readiness detected ->
 *   command sent -> user writes -> data flows -> snapshot works -> exit
 *
 * Uses the mocked node-pty (via __PTY_FOR_TEST__) and @xterm/headless mock.
 * Creates PtyHostProcess directly (not via fork).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PtyHostMessage, PtyClientMessage } from './pty-ipc-protocol'

// ── Mock factory: creates an independent mock PTY process per spawn call ──

function createMockPtyProcess() {
  const proc: any = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _onData: null as ((data: string) => void) | null,
    _onExit: null as ((ev: { exitCode: number }) => void) | null,
    onData: vi.fn((cb: (data: string) => void) => {
      proc._onData = cb
    }),
    onExit: vi.fn((cb: (ev: { exitCode: number }) => void) => {
      proc._onExit = cb
    }),
  }
  return proc
}

/** Tracks spawned processes in order for multi-session tests. */
const spawnedProcesses: ReturnType<typeof createMockPtyProcess>[] = []
const integrationMockSpawn = vi.fn((..._args: unknown[]) => {
  const proc = createMockPtyProcess()
  spawnedProcesses.push(proc)
  return proc
})

// Inject the mock before pty-host-process loads
;(globalThis as any).__PTY_FOR_TEST__ = {
  spawn: integrationMockSpawn,
}

// Mock @xterm/headless for HeadlessEmulator
vi.mock('@xterm/headless', () => import('./__mocks__/@xterm/headless'))

const { PtyHostProcess } = await import('./pty-host-process')

// ── Helpers ──────────────────────────────────────────────────────

function makeSpawnMsg(
  overrides: Partial<Extract<PtyClientMessage, { type: 'spawn' }>> = {},
): Extract<PtyClientMessage, { type: 'spawn' }> {
  return {
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
}

/** Extract the readiness marker from the spawn call's env. */
function getMarker(procIndex: number): string {
  const env = integrationMockSpawn.mock.calls[procIndex][2].env
  return env.DEVDOCK_READY_MARKER
}

/** Collect all messages of a given type from the send spy. */
function messagesOfType<T extends PtyHostMessage['type']>(
  send: ReturnType<typeof vi.fn>,
  type: T,
): Extract<PtyHostMessage, { type: T }>[] {
  return send.mock.calls
    .map((c: any[]) => c[0] as PtyHostMessage)
    .filter((m: PtyHostMessage): m is Extract<PtyHostMessage, { type: T }> => m.type === type)
}

// ── Tests ────────────────────────────────────────────────────────

describe('PtyHostProcess integration', () => {
  let send: ReturnType<typeof vi.fn>
  let host: InstanceType<typeof PtyHostProcess>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    spawnedProcesses.length = 0
    send = vi.fn()
    host = new PtyHostProcess(send)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Scenario 1: Full lifecycle ──────────────────────────────────

  it('full lifecycle: spawn -> readiness -> buffered input flush -> command -> data -> snapshot -> exit', () => {
    // Step 1: Spawn a session with a command
    host.handleMessage(makeSpawnMsg({ sessionId: 'integ-1', command: 'npm test' }))
    const proc = spawnedProcesses[0]
    expect(proc).toBeDefined()

    // Verify: spawned message emitted
    expect(messagesOfType(send, 'spawned')).toHaveLength(1)
    expect(messagesOfType(send, 'spawned')[0].sessionId).toBe('integ-1')

    // Step 2: User types "early input" BEFORE shell is ready (should be buffered)
    host.handleMessage({ type: 'write', sessionId: 'integ-1', data: 'early input' })
    expect(proc.write).not.toHaveBeenCalledWith('early input')

    // Step 3: Simulate shell outputting init text + readiness marker
    const marker = getMarker(0)
    proc._onData!(`Welcome to zsh\n${marker}\nprompt$ `)

    // Step 4: Verify buffered "early input" was flushed to PTY
    expect(proc.write).toHaveBeenCalledWith('early input')

    // Step 5: Verify command was sent to PTY (via readiness callback)
    expect(proc.write).toHaveBeenCalledWith('npm test\r')

    // Step 6: Verify the order — early input flushed BEFORE command
    const writeCalls = proc.write.mock.calls.map((c: any[]) => c[0])
    const earlyIdx = writeCalls.indexOf('early input')
    const cmdIdx = writeCalls.indexOf('npm test\r')
    expect(earlyIdx).toBeLessThan(cmdIdx)

    // Step 7: Verify ready message emitted
    expect(messagesOfType(send, 'ready')).toHaveLength(1)
    expect(messagesOfType(send, 'ready')[0].sessionId).toBe('integ-1')

    // Step 8: Verify marker stripped from data messages
    const dataMessagesBeforeMore = messagesOfType(send, 'data')
    const allDataStr = dataMessagesBeforeMore.map((m) => m.data).join('')
    expect(allDataStr).not.toContain(marker)
    expect(allDataStr).toContain('Welcome to zsh')
    expect(allDataStr).toContain('prompt$ ')

    // Step 9: Simulate more PTY output -> verify data message sent
    send.mockClear()
    proc._onData!('command output\r\n')
    const postData = messagesOfType(send, 'data')
    expect(postData).toHaveLength(1)
    expect(postData[0].data).toBe('command output\r\n')
    expect(postData[0].sessionId).toBe('integ-1')

    // Step 10: Request snapshot -> verify non-empty snapshot returned
    send.mockClear()
    host.handleMessage({ type: 'snapshot', sessionId: 'integ-1' })
    const snapshots = messagesOfType(send, 'snapshot')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].sessionId).toBe('integ-1')
    expect(snapshots[0].lines.length).toBeGreaterThan(0)
    // Snapshot should contain terminal content (at least part of what was written)
    const nonEmptyLines = snapshots[0].lines.filter((l: string) => l.length > 0)
    expect(nonEmptyLines.length).toBeGreaterThan(0)

    // Step 11: Simulate PTY exit -> verify exit message
    send.mockClear()
    proc._onExit!({ exitCode: 0 })
    const exits = messagesOfType(send, 'exit')
    expect(exits).toHaveLength(1)
    expect(exits[0]).toEqual({ type: 'exit', sessionId: 'integ-1', exitCode: 0 })

    // After exit, snapshot should return empty (session cleaned up)
    send.mockClear()
    host.handleMessage({ type: 'snapshot', sessionId: 'integ-1' })
    const postExitSnap = messagesOfType(send, 'snapshot')
    expect(postExitSnap[0].lines).toEqual([])
  })

  // ── Scenario 2: Timeout fallback ────────────────────────────────

  it('timeout fallback: shell never emits marker, readiness fires after 15s', () => {
    // Spawn session without command
    host.handleMessage(makeSpawnMsg({ sessionId: 'timeout-1' }))
    const proc = spawnedProcesses[0]

    // User types before ready — should be buffered
    host.handleMessage({ type: 'write', sessionId: 'timeout-1', data: 'buffered cmd' })
    expect(proc.write).not.toHaveBeenCalledWith('buffered cmd')

    // Simulate some PTY output (no marker)
    proc._onData!('some init output without marker')

    // Advance time by 15 seconds (the fallback timeout)
    vi.advanceTimersByTime(15_000)

    // Verify: buffered write was flushed even without marker
    expect(proc.write).toHaveBeenCalledWith('buffered cmd')

    // Verify: ready message emitted
    expect(messagesOfType(send, 'ready')).toHaveLength(1)
    expect(messagesOfType(send, 'ready')[0].sessionId).toBe('timeout-1')
  })

  it('timeout fallback: command is sent after timeout', () => {
    host.handleMessage(makeSpawnMsg({ sessionId: 'timeout-2', command: 'ls -la' }))
    const proc = spawnedProcesses[0]

    // Command should NOT be sent before timeout
    expect(proc.write).not.toHaveBeenCalledWith('ls -la\r')

    // Advance time by 15 seconds
    vi.advanceTimersByTime(15_000)

    // Command should now be sent
    expect(proc.write).toHaveBeenCalledWith('ls -la\r')
  })

  // ── Scenario 3: Multiple sessions in parallel ───────────────────

  it('multiple sessions in parallel: independent readiness and data isolation', () => {
    // Spawn session A
    host.handleMessage(makeSpawnMsg({ sessionId: 'A' }))
    const procA = spawnedProcesses[0]

    // Spawn session B
    host.handleMessage(makeSpawnMsg({ sessionId: 'B' }))
    const procB = spawnedProcesses[1]

    expect(procA).not.toBe(procB) // Confirm separate mock processes

    // Verify both spawned messages
    const spawnedMsgs = messagesOfType(send, 'spawned')
    expect(spawnedMsgs).toHaveLength(2)
    expect(spawnedMsgs.map((m) => m.sessionId).sort()).toEqual(['A', 'B'])

    // Simulate independent readiness for A
    const markerA = getMarker(0)
    procA._onData!(`init A\n${markerA}\npromptA$ `)

    // Simulate independent readiness for B
    const markerB = getMarker(1)
    procB._onData!(`init B\n${markerB}\npromptB$ `)

    // Both should be ready
    const readyMsgs = messagesOfType(send, 'ready')
    expect(readyMsgs).toHaveLength(2)

    send.mockClear()

    // Data from A only goes to A's messages
    procA._onData!('output from A')
    const dataAfterA = messagesOfType(send, 'data')
    expect(dataAfterA).toHaveLength(1)
    expect(dataAfterA[0].sessionId).toBe('A')
    expect(dataAfterA[0].data).toBe('output from A')

    send.mockClear()

    // Data from B only goes to B's messages
    procB._onData!('output from B')
    const dataAfterB = messagesOfType(send, 'data')
    expect(dataAfterB).toHaveLength(1)
    expect(dataAfterB[0].sessionId).toBe('B')
    expect(dataAfterB[0].data).toBe('output from B')

    // Kill A -> verify A exits, B still running
    send.mockClear()
    host.handleMessage({ type: 'kill', sessionId: 'A' })
    expect(procA.kill).toHaveBeenCalled()
    expect(procB.kill).not.toHaveBeenCalled()

    // B can still receive data
    send.mockClear()
    procB._onData!('B still alive')
    const bData = messagesOfType(send, 'data')
    expect(bData).toHaveLength(1)
    expect(bData[0].sessionId).toBe('B')
    expect(bData[0].data).toBe('B still alive')

    // A's snapshot should be empty (session destroyed)
    send.mockClear()
    host.handleMessage({ type: 'snapshot', sessionId: 'A' })
    const snapA = messagesOfType(send, 'snapshot')
    expect(snapA[0].lines).toEqual([])

    // B's snapshot should have content
    send.mockClear()
    host.handleMessage({ type: 'snapshot', sessionId: 'B' })
    const snapB = messagesOfType(send, 'snapshot')
    expect(snapB[0].lines.length).toBeGreaterThan(0)
  })
})
