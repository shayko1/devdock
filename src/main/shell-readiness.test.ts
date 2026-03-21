/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ShellReadinessDetector } from './shell-readiness'

describe('ShellReadinessDetector', () => {
  let writeFn: ReturnType<typeof vi.fn>
  let onReady: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    writeFn = vi.fn()
    onReady = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('getEnvVars() returns env with DEVDOCK_READY_MARKER matching pattern', () => {
    const detector = new ShellReadinessDetector('sess-1', writeFn, onReady)
    const env = detector.getEnvVars()

    expect(env).toHaveProperty('DEVDOCK_READY_MARKER')
    expect(env.DEVDOCK_READY_MARKER).toMatch(/^__DEVDOCK_READY_sess-1_[a-z0-9]+__$/)

    detector.dispose()
  })

  it('getShellInitCommand() returns echo command containing the marker', () => {
    const detector = new ShellReadinessDetector('sess-2', writeFn, onReady)
    const cmd = detector.getShellInitCommand()
    const marker = detector.getEnvVars().DEVDOCK_READY_MARKER

    expect(cmd).toContain('echo')
    expect(cmd).toContain(marker)

    detector.dispose()
  })

  it('buffers writes until ready (writeFn not called)', () => {
    const detector = new ShellReadinessDetector('sess-3', writeFn, onReady)

    detector.write('ls\n')
    detector.write('pwd\n')

    expect(writeFn).not.toHaveBeenCalled()
    expect(detector.isReady).toBe(false)

    detector.dispose()
  })

  it('flushes buffered writes when marker detected in output; onReady called; marker stripped from output', () => {
    const detector = new ShellReadinessDetector('sess-4', writeFn, onReady)
    const marker = detector.getEnvVars().DEVDOCK_READY_MARKER

    // Buffer some input
    detector.write('ls\n')
    detector.write('pwd\n')
    expect(writeFn).not.toHaveBeenCalled()

    // Simulate PTY output containing the marker
    const output = `some init output\n${marker}\nprompt$ `
    const filtered = detector.filterOutput(output)

    // Marker line should be stripped from output
    expect(filtered).not.toContain(marker)
    expect(filtered).toContain('some init output')
    expect(filtered).toContain('prompt$ ')

    // Buffered writes should have been flushed
    expect(writeFn).toHaveBeenCalledTimes(2)
    expect(writeFn).toHaveBeenNthCalledWith(1, 'ls\n')
    expect(writeFn).toHaveBeenNthCalledWith(2, 'pwd\n')

    // onReady should have been called
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(detector.isReady).toBe(true)

    detector.dispose()
  })

  it('passes through writes directly after ready', () => {
    const detector = new ShellReadinessDetector('sess-5', writeFn, onReady)
    const marker = detector.getEnvVars().DEVDOCK_READY_MARKER

    // Trigger ready
    detector.filterOutput(marker)
    writeFn.mockClear()

    // Now writes should pass through directly
    detector.write('echo hello\n')
    expect(writeFn).toHaveBeenCalledTimes(1)
    expect(writeFn).toHaveBeenCalledWith('echo hello\n')

    // filterOutput should pass through directly
    const output = detector.filterOutput('hello\nprompt$ ')
    expect(output).toBe('hello\nprompt$ ')

    detector.dispose()
  })

  it('falls back after timeout and flushes buffer', () => {
    const detector = new ShellReadinessDetector('sess-6', writeFn, onReady, 15000)

    // Buffer some input
    detector.write('ls\n')
    expect(writeFn).not.toHaveBeenCalled()
    expect(detector.isReady).toBe(false)

    // Advance past the timeout
    vi.advanceTimersByTime(15001)

    // Should have flushed and called onReady
    expect(writeFn).toHaveBeenCalledTimes(1)
    expect(writeFn).toHaveBeenCalledWith('ls\n')
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(detector.isReady).toBe(true)
  })

  it('strips marker even when split across multiple output chunks', () => {
    const detector = new ShellReadinessDetector('sess-7', writeFn, onReady)
    const marker = detector.getEnvVars().DEVDOCK_READY_MARKER

    // Buffer input
    detector.write('cmd\n')

    // Split the marker across two chunks at an arbitrary point
    const splitPoint = Math.floor(marker.length / 2)
    const chunk1 = `init output\n${marker.substring(0, splitPoint)}`
    const chunk2 = `${marker.substring(splitPoint)}\nprompt$ `

    const filtered1 = detector.filterOutput(chunk1)
    // Should not have triggered ready yet (marker incomplete)
    expect(onReady).not.toHaveBeenCalled()

    const filtered2 = detector.filterOutput(chunk2)
    // Now it should be ready
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(detector.isReady).toBe(true)

    // Buffered write should have been flushed
    expect(writeFn).toHaveBeenCalledTimes(1)
    expect(writeFn).toHaveBeenCalledWith('cmd\n')

    // Combined filtered output should not contain the marker
    const combined = filtered1 + filtered2
    expect(combined).not.toContain(marker)
    expect(combined).toContain('init output')
    expect(combined).toContain('prompt$ ')

    detector.dispose()
  })
})
