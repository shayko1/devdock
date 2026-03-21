/**
 * PtyHostProcess — manages PTY sessions inside the child process.
 *
 * Receives PtyClientMessages (via handleMessage) and emits
 * PtyHostMessages via the send callback provided at construction.
 *
 * Each session pairs the raw PTY process with a ShellReadinessDetector
 * (buffering user input until the shell finishes init) and a
 * HeadlessEmulator (tracking screen state for snapshot/restore).
 */
import type { PtyClientMessage, PtyHostMessage } from './pty-ipc-protocol'
import { ShellReadinessDetector } from './shell-readiness'
import { HeadlessEmulator } from './headless-emulator'

// node-pty is a native module — use eval to prevent vite from bundling it.
// Tests inject mock via global __PTY_FOR_TEST__
// eslint-disable-next-line no-eval
const pty: typeof import('node-pty') =
  (typeof globalThis !== 'undefined' && (globalThis as any).__PTY_FOR_TEST__) ||
  eval("require('node-pty')")

/** Internal representation of a managed PTY session. */
interface HostSession {
  id: string
  ptyProcess: any
  readiness: ShellReadinessDetector
  emulator: HeadlessEmulator
}

export class PtyHostProcess {
  private sessions = new Map<string, HostSession>()
  private send: (msg: PtyHostMessage) => void

  constructor(send: (msg: PtyHostMessage) => void) {
    this.send = send
  }

  handleMessage(msg: PtyClientMessage): void {
    switch (msg.type) {
      case 'spawn':
        this.handleSpawn(msg)
        break
      case 'write': {
        const session = this.sessions.get(msg.sessionId)
        if (session) {
          session.readiness.write(msg.data)
        }
        break
      }
      case 'resize': {
        const session = this.sessions.get(msg.sessionId)
        if (session) {
          session.ptyProcess.resize(msg.cols, msg.rows)
          session.emulator.resize(msg.cols, msg.rows)
        }
        break
      }
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

    // Create the headless emulator for screen state tracking
    const emulator = new HeadlessEmulator(cols, rows)

    // Create the readiness detector with PTY write function and ready callback
    const readiness = new ShellReadinessDetector(
      sessionId,
      (data: string) => ptyProcess.write(data),
      () => {
        // Shell is ready — send ready message and execute the initial command
        this.send({ type: 'ready', sessionId })
        if (command) {
          ptyProcess.write(command + '\r')
        }
      },
    )

    // Merge readiness env vars + shell init command into spawn environment
    const readinessEnv = readiness.getEnvVars()
    const shellInitCmd = readiness.getShellInitCommand()
    const spawnEnv = {
      ...env,
      ...readinessEnv,
      DEVDOCK_SHELL_INIT: shellInitCmd,
    }

    let ptyProcess: any
    try {
      ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: spawnEnv,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      emulator.dispose()
      readiness.dispose()
      this.send({ type: 'error', sessionId, message })
      return
    }

    const session: HostSession = { id: sessionId, ptyProcess, readiness, emulator }
    this.sessions.set(sessionId, session)

    ptyProcess.onData((data: string) => {
      // Filter output through readiness detector (strips marker, detects ready state)
      const filtered = readiness.filterOutput(data)
      // Feed filtered output to headless emulator for screen tracking
      if (filtered) {
        emulator.write(filtered)
        this.send({ type: 'data', sessionId, data: filtered })
      }
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.send({ type: 'exit', sessionId, exitCode })
      session.readiness.dispose()
      session.emulator.dispose()
      this.sessions.delete(sessionId)
    })

    this.send({ type: 'spawned', sessionId })
  }

  private handleKill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    try {
      session.ptyProcess.kill()
    } catch { /* already dead */ }
    session.readiness.dispose()
    session.emulator.dispose()
    this.sessions.delete(sessionId)
  }

  private handleSnapshot(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      this.send({ type: 'snapshot', sessionId, lines: [], cursorX: 0, cursorY: 0 })
      return
    }

    const snapshot = session.emulator.getSnapshot()
    this.send({
      type: 'snapshot',
      sessionId,
      lines: snapshot.lines,
      cursorX: snapshot.cursorX,
      cursorY: snapshot.cursorY,
    })
  }

  private handleDestroyAll(): void {
    for (const [sessionId] of this.sessions) {
      this.handleKill(sessionId)
    }
  }
}
