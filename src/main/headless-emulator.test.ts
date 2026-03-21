/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'

// Mock must be set up before importing the module under test
vi.mock('@xterm/headless', () => import('./__mocks__/@xterm/headless'))

import { HeadlessEmulator } from './headless-emulator'

describe('HeadlessEmulator', () => {
  it('writes data and captures it in snapshot lines', () => {
    const emu = new HeadlessEmulator(80, 24)

    emu.write('Hello, world!')

    const snapshot = emu.getSnapshot()
    const nonEmpty = snapshot.lines.filter(l => l.length > 0)
    expect(nonEmpty.length).toBeGreaterThanOrEqual(1)
    expect(nonEmpty.some(line => line.includes('Hello, world!'))).toBe(true)

    emu.dispose()
  })

  it('handles ANSI escape sequences (snapshot contains text, not raw escape codes)', () => {
    const emu = new HeadlessEmulator(80, 24)

    // Write text with ANSI color codes: bold red "ERROR" then reset
    emu.write('\x1b[1;31mERROR\x1b[0m: something failed')

    const snapshot = emu.getSnapshot()
    const allText = snapshot.lines.join('\n')

    // Should contain the readable text
    expect(allText).toContain('ERROR')
    expect(allText).toContain('something failed')

    // Should NOT contain raw escape sequences
    expect(allText).not.toContain('\x1b[')
    expect(allText).not.toContain('\x1b[1;31m')

    emu.dispose()
  })

  it('handles resize', () => {
    const emu = new HeadlessEmulator(80, 24)

    emu.write('before resize')
    emu.resize(120, 40)

    // After resize, write more data
    emu.write('\r\nafter resize')
    const snapshot = emu.getSnapshot()
    const allText = snapshot.lines.join('\n')

    expect(allText).toContain('before resize')
    expect(allText).toContain('after resize')

    emu.dispose()
  })

  it('returns serialized buffer with multiple lines', () => {
    const emu = new HeadlessEmulator(80, 24)

    emu.write('line one\r\nline two\r\nline three')

    const snapshot = emu.getSnapshot()

    // Should have at least 3 non-empty lines
    const nonEmpty = snapshot.lines.filter(l => l.length > 0)
    expect(nonEmpty.length).toBeGreaterThanOrEqual(3)
    expect(nonEmpty[0]).toContain('line one')
    expect(nonEmpty[1]).toContain('line two')
    expect(nonEmpty[2]).toContain('line three')

    emu.dispose()
  })

  it('returns cursor position in snapshot', () => {
    const emu = new HeadlessEmulator(80, 24)

    emu.write('Hello')

    const snapshot = emu.getSnapshot()
    // After writing "Hello", cursor should be at x=5, y=0
    expect(snapshot.cursorX).toBe(5)
    expect(snapshot.cursorY).toBe(0)

    // Write a newline and more text
    emu.write('\r\nWorld')
    const snapshot2 = emu.getSnapshot()
    // cursor should be at x=5, y=1
    expect(snapshot2.cursorX).toBe(5)
    expect(snapshot2.cursorY).toBe(1)

    emu.dispose()
  })

  it('dispose() cleans up without error', () => {
    const emu = new HeadlessEmulator(80, 24)

    emu.write('some data')

    // Should not throw
    expect(() => emu.dispose()).not.toThrow()

    // Calling dispose again should also not throw
    expect(() => emu.dispose()).not.toThrow()
  })
})
