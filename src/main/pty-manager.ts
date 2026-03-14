import { BrowserWindow } from 'electron'
import { getBridgePort } from './browser-bridge'
import { join } from 'path'
import { homedir } from 'os'

// node-pty is a native module — use eval to prevent vite from bundling it
// Tests inject mock via global __PTY_FOR_TEST__
// eslint-disable-next-line no-eval
const pty: typeof import('node-pty') =
  (typeof globalThis !== 'undefined' && (globalThis as any).__PTY_FOR_TEST__) ||
  eval("require('node-pty')")

export interface PtySession {
  id: string
  folderName: string
  folderPath: string
  ptyProcess: any
  worktreePath: string | null
  branchName: string | null
}

class PtyManager {
  private sessions = new Map<string, PtySession>()
  private mainWindow: BrowserWindow | null = null
  private shellPath: string | null = null
  private dataHooks: ((sessionId: string, data: string) => void)[] = []

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win
  }

  setShellPath(path: string) {
    this.shellPath = path
  }

  /** Register a hook that receives all PTY data for every session */
  onData(hook: (sessionId: string, data: string) => void) {
    this.dataHooks.push(hook)
  }

  createSession(
    sessionId: string,
    folderName: string,
    folderPath: string,
    worktreePath: string | null,
    branchName: string | null,
    command: string
  ): { success: boolean; id: string; folderName: string; worktreePath: string | null; branchName: string | null; error?: string } {
    if (this.sessions.has(sessionId)) {
      this.destroySession(sessionId)
    }

    const cwd = worktreePath || folderPath
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

    // Suppress oh-my-zsh update prompt — it consumes the first char of the initial command
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

    let ptyProcess: any
    try {
      // Use -i (interactive) instead of -l (login) to skip slow profile sourcing
      ptyProcess = pty.spawn('/bin/zsh', ['-i'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[PTY] Failed to spawn:', message)
      return { success: false, id: sessionId, folderName, worktreePath, branchName, error: message }
    }

    const session: PtySession = {
      id: sessionId,
      folderName,
      folderPath,
      ptyProcess,
      worktreePath,
      branchName
    }

    ptyProcess.onData((data: string) => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('pty-data', { sessionId, data })
        }
      } catch { /* window destroyed */ }
      for (const hook of this.dataHooks) {
        try { hook(sessionId, data) } catch { /* ignore hook errors */ }
      }
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('pty-exit', { sessionId, exitCode })
        }
      } catch { /* window destroyed */ }
      this.sessions.delete(sessionId)
    })

    this.sessions.set(sessionId, session)

    // Send the command after shell prompt appears
    // Delay must be long enough for zsh + oh-my-zsh to finish init
    setTimeout(() => {
      ptyProcess.write(command + '\r')
    }, 800)

    return { success: true, id: sessionId, folderName, worktreePath, branchName }
  }

  write(sessionId: string, data: string) {
    this.sessions.get(sessionId)?.ptyProcess.write(data)
  }

  resize(sessionId: string, cols: number, rows: number) {
    this.sessions.get(sessionId)?.ptyProcess.resize(cols, rows)
  }

  destroySession(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    try {
      session.ptyProcess.kill()
    } catch { /* already dead */ }
    this.sessions.delete(sessionId)
  }

  getSessions(): { id: string; folderName: string; worktreePath: string | null; branchName: string | null }[] {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      folderName: s.folderName,
      worktreePath: s.worktreePath,
      branchName: s.branchName
    }))
  }

  destroyAll() {
    for (const [id] of this.sessions) {
      this.destroySession(id)
    }
  }
}

export const ptyManager = new PtyManager()
