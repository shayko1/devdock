import { BrowserWindow } from 'electron'
import { fork, ChildProcess } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { getBridgePort } from './browser-bridge'
import {
  encodeMessage,
  decodeMessages,
} from './pty-ipc-protocol'
import type {
  PtyClientMessage,
  PtyHostMessage,
  SnapshotResponseMessage,
} from './pty-ipc-protocol'

// ─── Session metadata (renderer-facing; PTY process lives in host) ──

export interface PtySession {
  id: string
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
}

// ─── Snapshot result shape ──────────────────────────────────────────

export interface SnapshotResult {
  lines: string[]
  cursorX: number
  cursorY: number
}

// ─── PtyManager (proxy to PTY host child process) ───────────────────

export class PtyManager {
  private sessions = new Map<string, PtySession>()
  private mainWindow: BrowserWindow | null = null
  private shellPath: string | null = null
  private dataHooks: ((sessionId: string, data: string) => void)[] = []
  private exitHooks: ((sessionId: string) => void)[] = []

  private hostProcess: ChildProcess | null = null
  private hostBuffer: Buffer = Buffer.alloc(0)
  private snapshotResolvers = new Map<string, {
    resolve: (result: SnapshotResult) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  // ─── Public API (unchanged for callers) ────────────────────────

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  setShellPath(path: string): void {
    this.shellPath = path
  }

  /** Register a hook that receives all PTY data for every session */
  onData(hook: (sessionId: string, data: string) => void): void {
    this.dataHooks.push(hook)
  }

  /** Register a hook that fires when a PTY session exits */
  onExit(hook: (sessionId: string) => void): void {
    this.exitHooks.push(hook)
  }

  createSession(
    sessionId: string,
    folderName: string,
    folderPath: string,
    worktreePath: string | null,
    branchName: string | null,
    command: string
  ): { success: boolean; id: string; folderName: string; worktreePath: string | null; branchName: string | null; error?: string } {
    // Ensure host is running
    this.ensureHost()

    // Destroy duplicate session if it exists
    if (this.sessions.has(sessionId)) {
      this.destroySession(sessionId)
    }

    const cwd = worktreePath || folderPath

    // Build environment (same logic as before — host passes it to node-pty)
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      LANG: process.env.LANG || 'en_US.UTF-8',
      HOME: process.env.HOME || '/',
    }
    if (this.shellPath) {
      env.PATH = this.shellPath
    }
    // Remove CLAUDECODE env var so claude doesn't think it's nested
    delete env.CLAUDECODE

    // Suppress oh-my-zsh update prompt
    env.DISABLE_AUTO_UPDATE = 'true'
    env.DISABLE_UPDATE_PROMPT = 'true'

    // Set DevDock browser bridge env vars
    env.DEVDOCK_SESSION_ID = sessionId
    const port = getBridgePort()
    if (port > 0) {
      env.DEVDOCK_BROWSER_PORT = String(port)
    }
    // Add devdock helper to PATH
    const devdockBin = join(homedir(), '.devdock')
    env.PATH = devdockBin + ':' + (env.PATH || '')

    // Store session metadata locally
    const session: PtySession = {
      id: sessionId,
      folderName,
      folderPath,
      worktreePath,
      branchName,
    }
    this.sessions.set(sessionId, session)

    // Send spawn message to host
    const spawnMsg: PtyClientMessage = {
      type: 'spawn',
      sessionId,
      cols: 80,
      rows: 24,
      cwd,
      env,
      shell: '/bin/zsh',
      shellArgs: ['-i'],
      command,
    }
    this.sendToHost(spawnMsg)

    return { success: true, id: sessionId, folderName, worktreePath, branchName }
  }

  write(sessionId: string, data: string): void {
    if (!this.sessions.has(sessionId)) return
    this.sendToHost({ type: 'write', sessionId, data })
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (!this.sessions.has(sessionId)) return
    this.sendToHost({ type: 'resize', sessionId, cols, rows })
  }

  destroySession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) return
    this.sendToHost({ type: 'kill', sessionId })
    this.sessions.delete(sessionId)
  }

  getSessions(): { id: string; folderName: string; worktreePath: string | null; branchName: string | null }[] {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      folderName: s.folderName,
      worktreePath: s.worktreePath,
      branchName: s.branchName,
    }))
  }

  destroyAll(): void {
    this.sendToHost({ type: 'destroy-all' })
    this.sessions.clear()
  }

  /** Request a terminal snapshot from the host. Resolves with lines + cursor position. */
  getSnapshot(sessionId: string): Promise<SnapshotResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.snapshotResolvers.delete(sessionId)
        reject(new Error('Snapshot timeout'))
      }, 2000)

      this.snapshotResolvers.set(sessionId, { resolve, reject, timer })
      this.sendToHost({ type: 'snapshot', sessionId })
    })
  }

  // ─── Host lifecycle ────────────────────────────────────────────

  /** Start the PTY host child process. Called automatically on first createSession. */
  startHost(): void {
    if (this.hostProcess) return

    const entryPath = join(__dirname, 'pty-host-entry.js')
    this.hostProcess = fork(entryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      silent: true,
    })

    this.hostBuffer = Buffer.alloc(0)

    // Read host stdout — decode and dispatch messages
    this.hostProcess.stdout!.on('data', (chunk: Buffer) => {
      this.hostBuffer = Buffer.concat([this.hostBuffer, chunk])
      const { messages, remainder } = decodeMessages(this.hostBuffer)
      this.hostBuffer = remainder

      for (const msg of messages) {
        this.dispatchHostMessage(msg as PtyHostMessage)
      }
    })

    // Log host stderr for debugging
    this.hostProcess.stderr!.on('data', (chunk: Buffer) => {
      console.error('[pty-host]', chunk.toString())
    })

    // Handle host crash
    this.hostProcess.on('exit', (code: number | null) => {
      console.error(`[pty-host] Process exited with code ${code}`)
      this.hostProcess = null
      this.hostBuffer = Buffer.alloc(0)

      // Notify all sessions as disconnected
      for (const [sessionId] of this.sessions) {
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('pty-exit', { sessionId, exitCode: -1 })
          }
        } catch { /* window destroyed */ }
        for (const hook of this.exitHooks) {
          try { hook(sessionId) } catch { /* ignore hook errors */ }
        }
      }
      this.sessions.clear()
    })
  }

  /** Stop the PTY host child process. */
  stopHost(): void {
    if (!this.hostProcess) return
    try {
      this.hostProcess.kill()
    } catch { /* already dead */ }
    this.hostProcess = null
    this.hostBuffer = Buffer.alloc(0)
  }

  // ─── Internal ──────────────────────────────────────────────────

  private ensureHost(): void {
    if (!this.hostProcess) {
      this.startHost()
    }
  }

  private sendToHost(msg: PtyClientMessage): void {
    if (!this.hostProcess?.stdin?.writable) return
    const frame = encodeMessage(msg)
    this.hostProcess.stdin.write(frame)
  }

  private dispatchHostMessage(msg: PtyHostMessage): void {
    switch (msg.type) {
      case 'data': {
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('pty-data', {
              sessionId: msg.sessionId,
              data: msg.data,
            })
          }
        } catch { /* window destroyed */ }
        for (const hook of this.dataHooks) {
          try { hook(msg.sessionId, msg.data) } catch { /* ignore hook errors */ }
        }
        break
      }

      case 'exit': {
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('pty-exit', {
              sessionId: msg.sessionId,
              exitCode: msg.exitCode,
            })
          }
        } catch { /* window destroyed */ }
        this.sessions.delete(msg.sessionId)
        for (const hook of this.exitHooks) {
          try { hook(msg.sessionId) } catch { /* ignore hook errors */ }
        }
        break
      }

      case 'ready': {
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('pty-ready', {
              sessionId: msg.sessionId,
            })
          }
        } catch { /* window destroyed */ }
        break
      }

      case 'snapshot': {
        const resolver = this.snapshotResolvers.get(msg.sessionId)
        if (resolver) {
          clearTimeout(resolver.timer)
          this.snapshotResolvers.delete(msg.sessionId)
          resolver.resolve({
            lines: (msg as SnapshotResponseMessage).lines,
            cursorX: (msg as SnapshotResponseMessage).cursorX,
            cursorY: (msg as SnapshotResponseMessage).cursorY,
          })
        }
        break
      }

      case 'error': {
        console.error(`[pty-host] Session ${msg.sessionId} error: ${msg.message}`)
        break
      }

      case 'host-error': {
        console.error(`[pty-host] Host error: ${msg.message}`)
        break
      }

      case 'spawned': {
        // Session confirmed spawned in host — no action needed, metadata already stored
        break
      }
    }
  }
}

export const ptyManager = new PtyManager()
