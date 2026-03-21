/**
 * PtyHostProcess — manages PTY sessions inside the child process.
 *
 * Receives PtyClientMessages (via handleMessage) and emits
 * PtyHostMessages via the send callback provided at construction.
 */
import type { PtyClientMessage, PtyHostMessage } from './pty-ipc-protocol'

// node-pty is a native module — use eval to prevent vite from bundling it.
// Tests inject mock via global __PTY_FOR_TEST__
// eslint-disable-next-line no-eval
const pty: typeof import('node-pty') =
  (typeof globalThis !== 'undefined' && (globalThis as any).__PTY_FOR_TEST__) ||
  eval("require('node-pty')")

export class PtyHostProcess {
  private sessions = new Map<string, any>()
  private send: (msg: PtyHostMessage) => void

  constructor(send: (msg: PtyHostMessage) => void) {
    this.send = send
  }

  handleMessage(msg: PtyClientMessage): void {
    switch (msg.type) {
      case 'spawn':
        this.handleSpawn(msg)
        break
      case 'write':
        this.sessions.get(msg.sessionId)?.write(msg.data)
        break
      case 'resize':
        this.sessions.get(msg.sessionId)?.resize(msg.cols, msg.rows)
        break
      case 'kill':
        this.handleKill(msg.sessionId)
        break
      case 'snapshot':
        this.handleSnapshot(msg.sessionId)
        break
      case 'destroy-all':
        this.handleDestroyAll()
        break
    }
  }

  private handleSpawn(msg: Extract<PtyClientMessage, { type: 'spawn' }>): void {
    const { sessionId, cols, rows, cwd, env, shell, shellArgs, command } = msg

    let ptyProcess: any
    try {
      ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.send({ type: 'error', sessionId, message })
      return
    }

    this.sessions.set(sessionId, ptyProcess)

    ptyProcess.onData((data: string) => {
      this.send({ type: 'data', sessionId, data })
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.send({ type: 'exit', sessionId, exitCode })
      this.sessions.delete(sessionId)
    })

    this.send({ type: 'spawned', sessionId })

    // Send command after 800ms delay (placeholder — Task 6 will replace with readiness detection)
    if (command) {
      setTimeout(() => {
        ptyProcess.write(command + '\r')
      }, 800)
    }
  }

  private handleKill(sessionId: string): void {
    const ptyProcess = this.sessions.get(sessionId)
    if (!ptyProcess) return
    try {
      ptyProcess.kill()
    } catch { /* already dead */ }
    this.sessions.delete(sessionId)
  }

  private handleSnapshot(sessionId: string): void {
    // Placeholder — Task 5 will implement real snapshots
    this.send({
      type: 'snapshot',
      sessionId,
      lines: [],
      cursorX: 0,
      cursorY: 0,
    })
  }

  private handleDestroyAll(): void {
    for (const [sessionId] of this.sessions) {
      this.handleKill(sessionId)
    }
  }
}
