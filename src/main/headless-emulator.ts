/**
 * HeadlessEmulator
 *
 * Wraps @xterm/headless Terminal to run in Node.js without a DOM.
 * Tracks terminal screen state by feeding PTY output into the headless
 * terminal, enabling snapshot/restore when the Electron window reloads.
 *
 * The snapshot shape matches the PTY IPC protocol's SnapshotResponseMessage:
 *   { lines: string[], cursorX: number, cursorY: number }
 */

import { Terminal } from '@xterm/headless'

export interface TerminalSnapshot {
  lines: string[]
  cursorX: number
  cursorY: number
}

export class HeadlessEmulator {
  private terminal: Terminal | null

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback: 1000,
    })
  }

  /**
   * Feed PTY output into the headless terminal.
   * The terminal processes escape sequences internally, so the buffer
   * always contains plain text with correct cursor positioning.
   */
  write(data: string): void {
    if (!this.terminal) return
    this.terminal.write(data)
  }

  /**
   * Resize the virtual terminal to match the renderer's viewport.
   */
  resize(cols: number, rows: number): void {
    if (!this.terminal) return
    this.terminal.resize(cols, rows)
  }

  /**
   * Serialize the current screen buffer as an array of plain text lines
   * plus cursor position. Includes scrollback + active viewport.
   *
   * Lines are right-trimmed to avoid trailing whitespace.
   */
  getSnapshot(): TerminalSnapshot {
    if (!this.terminal) {
      return { lines: [], cursorX: 0, cursorY: 0 }
    }

    const buffer = this.terminal.buffer.active
    const lines: string[] = []

    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      lines.push(line ? line.translateToString(true) : '')
    }

    return {
      lines,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
    }
  }

  /**
   * Clean up the terminal instance.
   * Safe to call multiple times.
   */
  dispose(): void {
    if (this.terminal) {
      this.terminal.dispose()
      this.terminal = null
    }
  }
}
