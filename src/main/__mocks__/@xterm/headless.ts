/**
 * Mock for @xterm/headless Terminal.
 *
 * Simulates the headless terminal buffer API used by HeadlessEmulator.
 * This mock processes write() data through a simplified terminal emulation:
 * - Tracks cursor position (cursorX, cursorY)
 * - Handles \r\n and \n as newlines
 * - Strips ANSI escape sequences from buffer content
 * - Supports resize
 * - Provides buffer.active with getLine(), cursorX, cursorY, baseY, length
 */

class MockBufferLine {
  private content: string

  constructor(content: string) {
    this.content = content
  }

  translateToString(trimRight?: boolean): string {
    if (trimRight) {
      return this.content.replace(/\s+$/, '')
    }
    return this.content
  }

  get isWrapped(): boolean {
    return false
  }

  get length(): number {
    return this.content.length
  }
}

class MockBuffer {
  private lines: string[] = []
  private _cursorX = 0
  private _cursorY = 0
  private _cols: number
  private _rows: number

  constructor(cols: number, rows: number) {
    this._cols = cols
    this._rows = rows
    // Initialize with empty lines for the viewport
    for (let i = 0; i < rows; i++) {
      this.lines.push('')
    }
  }

  get type(): 'normal' {
    return 'normal'
  }

  get cursorX(): number {
    return this._cursorX
  }

  get cursorY(): number {
    return this._cursorY
  }

  get baseY(): number {
    return Math.max(0, this.lines.length - this._rows)
  }

  get viewportY(): number {
    return this.baseY
  }

  get length(): number {
    return this.lines.length
  }

  getLine(y: number): MockBufferLine | undefined {
    if (y < 0 || y >= this.lines.length) return undefined
    return new MockBufferLine(this.lines[y])
  }

  getNullCell(): object {
    return {}
  }

  // Internal methods used by MockTerminal
  _write(data: string): void {
    // Strip ANSI escape sequences
    const cleaned = data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')

    for (const ch of cleaned) {
      if (ch === '\n') {
        this._cursorY++
        this._cursorX = 0
        if (this._cursorY >= this._rows) {
          // Scroll: add new line, cursor stays at bottom
          this.lines.push('')
          this._cursorY = this._rows - 1
        }
        while (this.lines.length <= this.baseY + this._cursorY) {
          this.lines.push('')
        }
      } else if (ch === '\r') {
        this._cursorX = 0
      } else {
        const absY = this.baseY + this._cursorY
        while (this.lines.length <= absY) {
          this.lines.push('')
        }
        const line = this.lines[absY]
        // Pad line if cursor is past current content
        if (this._cursorX >= line.length) {
          this.lines[absY] = line + ' '.repeat(this._cursorX - line.length) + ch
        } else {
          this.lines[absY] =
            line.substring(0, this._cursorX) + ch + line.substring(this._cursorX + 1)
        }
        this._cursorX++
      }
    }
  }

  _resize(cols: number, rows: number): void {
    const oldRows = this._rows
    this._cols = cols
    this._rows = rows
    if (rows > oldRows) {
      // Add empty lines if growing
      while (this.lines.length < rows) {
        this.lines.push('')
      }
    }
  }
}

export class Terminal {
  private _cols: number
  private _rows: number
  private _buffer: MockBuffer
  private _disposed = false

  constructor(options?: { cols?: number; rows?: number; scrollback?: number }) {
    this._cols = options?.cols ?? 80
    this._rows = options?.rows ?? 24
    this._buffer = new MockBuffer(this._cols, this._rows)
  }

  get cols(): number {
    return this._cols
  }

  get rows(): number {
    return this._rows
  }

  get buffer(): { active: MockBuffer; normal: MockBuffer; alternate: MockBuffer } {
    return {
      active: this._buffer,
      normal: this._buffer,
      alternate: this._buffer,
    }
  }

  write(data: string | Uint8Array, callback?: () => void): void {
    const str = typeof data === 'string' ? data : new TextDecoder().decode(data)
    this._buffer._write(str)
    if (callback) {
      // Simulate async callback (in real xterm, write is async)
      callback()
    }
  }

  writeln(data: string | Uint8Array, callback?: () => void): void {
    this.write(data)
    this.write('\n', callback)
  }

  resize(cols: number, rows: number): void {
    this._cols = cols
    this._rows = rows
    this._buffer._resize(cols, rows)
  }

  dispose(): void {
    this._disposed = true
  }

  reset(): void {
    this._buffer = new MockBuffer(this._cols, this._rows)
  }

  // Stubs for event listeners (not used in HeadlessEmulator)
  onData = () => ({ dispose: () => {} })
  onBinary = () => ({ dispose: () => {} })
  onCursorMove = () => ({ dispose: () => {} })
  onLineFeed = () => ({ dispose: () => {} })
  onScroll = () => ({ dispose: () => {} })
  onResize = () => ({ dispose: () => {} })
  onWriteParsed = () => ({ dispose: () => {} })
  onTitleChange = () => ({ dispose: () => {} })
  onBell = () => ({ dispose: () => {} })
}
