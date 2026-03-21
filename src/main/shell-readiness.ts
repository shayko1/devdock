/**
 * ShellReadinessDetector
 *
 * Detects when a spawned shell (zsh, bash, etc.) has finished loading its
 * init scripts and is ready to accept input.  Until the shell is ready,
 * user keystrokes are buffered and replayed once readiness is confirmed.
 *
 * Readiness is detected by injecting a unique marker via an environment
 * variable + echo command that runs at the end of shell init.  The marker
 * is stripped from terminal output so the user never sees it.
 *
 * A fallback timeout ensures the shell is eventually considered ready even
 * if the marker is never echoed (e.g. the shell doesn't source .zshrc).
 */

export class ShellReadinessDetector {
  private readonly marker: string
  private readonly writeFn: (data: string) => void
  private readonly onReadyCb: () => void
  private readonly buffer: string[] = []
  private ready = false
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null

  /**
   * Accumulates trailing output that may contain a partial marker.
   * Each call to filterOutput appends to this, and once the full marker
   * is found the pending content is flushed (with the marker stripped).
   */
  private pendingOutput = ''

  constructor(
    sessionId: string,
    writeFn: (data: string) => void,
    onReady: () => void,
    timeoutMs = 15_000,
  ) {
    this.marker = `__DEVDOCK_READY_${sessionId}_${Date.now().toString(36)}__`
    this.writeFn = writeFn
    this.onReadyCb = onReady

    this.timeoutHandle = setTimeout(() => {
      if (!this.ready) {
        this.becomeReady()
      }
    }, timeoutMs)
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Environment variables to inject into the PTY spawn call. */
  getEnvVars(): Record<string, string> {
    return { DEVDOCK_READY_MARKER: this.marker }
  }

  /** Shell init command that echoes the marker (append to .zshrc / rc). */
  getShellInitCommand(): string {
    return `echo "${this.marker}"`
  }

  /** True once the shell is considered interactive. */
  get isReady(): boolean {
    return this.ready
  }

  /**
   * Accept user input.  Before the shell is ready the data is buffered;
   * afterwards it is forwarded immediately to the PTY.
   */
  write(data: string): void {
    if (this.ready) {
      this.writeFn(data)
    } else {
      this.buffer.push(data)
    }
  }

  /**
   * Filter PTY output, looking for the readiness marker.
   *
   * - Before ready: accumulates output in `pendingOutput` so that a marker
   *   split across two chunks is still detected.  Returns filtered output
   *   (everything confirmed to not contain the marker).
   * - After ready: passes output through unchanged.
   *
   * The marker line (including surrounding newlines) is stripped so the
   * user never sees it.
   */
  filterOutput(data: string): string {
    if (this.ready) {
      return data
    }

    this.pendingOutput += data

    const markerIdx = this.pendingOutput.indexOf(this.marker)
    if (markerIdx !== -1) {
      // Found the full marker.  Strip the marker line from output.
      const before = this.pendingOutput.substring(0, markerIdx)
      const after = this.pendingOutput.substring(markerIdx + this.marker.length)

      // Remove the surrounding newline that the echo command produces.
      // The marker is typically on its own line: "...\n<marker>\n..."
      const cleaned = this.stripMarkerLine(before, after)

      this.pendingOutput = ''
      this.becomeReady()
      return cleaned
    }

    // The marker might be partially at the tail of pendingOutput.
    // Keep enough trailing characters to cover a partial match.
    const safeLen = this.pendingOutput.length - this.marker.length
    if (safeLen > 0) {
      const safe = this.pendingOutput.substring(0, safeLen)
      this.pendingOutput = this.pendingOutput.substring(safeLen)
      return safe
    }

    // Not enough data yet to release anything safely.
    return ''
  }

  /** Clean up the fallback timeout. */
  dispose(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }

  // ── Internal ────────────────────────────────────────────────────────

  private becomeReady(): void {
    if (this.ready) return
    this.ready = true
    this.dispose()

    // Flush buffered writes in order.
    for (const data of this.buffer) {
      this.writeFn(data)
    }
    this.buffer.length = 0

    this.onReadyCb()
  }

  /**
   * Strip the marker and its surrounding newline delimiters.
   * e.g. "init output\n" + "\nprompt$ " → "init output\nprompt$ "
   */
  private stripMarkerLine(before: string, after: string): string {
    // Remove trailing newline from `before` (the line break before the marker)
    const trimmedBefore = before.endsWith('\n') ? before.slice(0, -1) : before
    // Remove leading newline from `after` (the line break after the marker)
    const trimmedAfter = after.startsWith('\n') ? after.slice(1) : after

    if (trimmedBefore && trimmedAfter) {
      return trimmedBefore + '\n' + trimmedAfter
    }
    return trimmedBefore + trimmedAfter
  }
}
