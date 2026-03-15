import { ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readdirSync, statSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { ptyManager } from '../pty-manager'
import { loadState } from '../store'
import { cleanupSessionRtkFlag } from '../rtk-manager'
import { coachManager } from '../coach-manager'
import { activeSessions, scanProjectSessions, getSessionTitle } from '../session-history'
import { ensureDevDockClaudeMd } from '../claude-md'

let mainWindowRef: Electron.BrowserWindow | null = null

export function setSessionMainWindow(win: Electron.BrowserWindow) {
  mainWindowRef = win
}

export function registerSessionHandlers() {
  ipcMain.handle('select-folder', async () => {
    if (!mainWindowRef) return null
    const result = await dialog.showOpenDialog(mainWindowRef, {
      properties: ['openDirectory'],
      title: 'Select Workspace Folder'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('open-claude-worktree', (_event, projectPath: string, projectName: string) => {
    try {
      try {
        execSync('git rev-parse --is-inside-work-tree', {
          cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
        })
      } catch {
        return { success: false, error: 'Not a git repository. Worktrees require git.' }
      }

      const baseBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      }).trim()

      const timestamp = Date.now().toString(36)
      const slug = projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()
      const worktreeBase = join(homedir(), '.devdock', 'worktrees', slug)
      const worktreePath = join(worktreeBase, timestamp, 'worktree')
      const branchName = `devdock/claude-${slug}-${timestamp}`

      mkdirSync(join(worktreeBase, timestamp), { recursive: true })

      execSync(
        `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
        { cwd: projectPath, encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }
      )

      const scriptPath = join(worktreeBase, timestamp, 'run-claude.sh')
      const appState = loadState()
      const wtPermFlag = appState.dangerousMode ? ' --dangerously-skip-permissions' : ''
      writeFileSync(scriptPath, [
        '#!/bin/zsh',
        'unset CLAUDECODE',
        `cd "${worktreePath}"`,
        `echo "\\033[1;34m[DevDock]\\033[0m Worktree: ${worktreePath}"`,
        `echo "\\033[1;34m[DevDock]\\033[0m Branch: ${branchName}"`,
        `echo "\\033[1;34m[DevDock]\\033[0m Base: ${baseBranch}"`,
        `echo ""`,
        `claude${wtPermFlag}`,
      ].join('\n'), { mode: 0o755 })

      execSync(
        `open -a "Terminal" "${scriptPath}"`,
        { stdio: 'ignore' }
      )

      return { success: true, worktreePath, branchName, baseBranch }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('pty-create', (_event, opts: {
    sessionId: string
    folderName: string
    folderPath: string
    useWorktree: boolean
    resumeClaudeId?: string
    existingWorktreePath?: string
    dangerousMode?: boolean
  }) => {
    let worktreePath: string | null = opts.existingWorktreePath || null
    let branchName: string | null = null

    if (worktreePath) {
      try {
        branchName = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: worktreePath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
      } catch { /* ignore */ }
    }

    if (opts.useWorktree && !worktreePath) {
      let isGitRepo = false
      try {
        execSync('git rev-parse --is-inside-work-tree', {
          cwd: opts.folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
        })
        isGitRepo = true
      } catch { /* not a git repo */ }

      if (isGitRepo) {
        try {
          const baseBranch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: opts.folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
          }).trim()

          const timestamp = Date.now().toString(36)
          const slug = opts.folderName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()
          const worktreeBase = join(homedir(), '.devdock', 'worktrees', slug)
          worktreePath = join(worktreeBase, timestamp, 'worktree')
          branchName = `devdock/claude-${slug}-${timestamp}`

          mkdirSync(join(worktreeBase, timestamp), { recursive: true })
          execSync(
            `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
            { cwd: opts.folderPath, encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }
          )
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          return { success: false, error: message }
        }
      }
    }

    const sessionCwd = worktreePath || opts.folderPath
    const currentState = loadState()
    ensureDevDockClaudeMd(sessionCwd, currentState.rtkEnabled)

    // Run workspace setup script if present
    runWorkspaceSetup(sessionCwd, opts.folderPath)

    const permFlag = opts.dangerousMode ? ' --dangerously-skip-permissions' : ''
    let command = `claude${permFlag}`
    if (opts.resumeClaudeId) {
      command = `claude --resume ${opts.resumeClaudeId}${permFlag}`
    }

    return ptyManager.createSession(
      opts.sessionId,
      opts.folderName,
      opts.folderPath,
      worktreePath,
      branchName,
      command
    )
  })

  ipcMain.on('pty-write', (_event, sessionId: string, data: string) => {
    ptyManager.write(sessionId, data)
  })

  ipcMain.on('pty-resize', (_event, sessionId: string, cols: number, rows: number) => {
    ptyManager.resize(sessionId, cols, rows)
  })

  ipcMain.handle('pty-destroy', (_event, sessionId: string) => {
    ptyManager.destroySession(sessionId)
    cleanupSessionRtkFlag(sessionId)
    coachManager.clearSession(sessionId)
  })

  ipcMain.handle('save-temp-image', (_event, opts: { name: string; data: number[]; sessionId: string }) => {
    try {
      const tmpDir = join(homedir(), '.devdock', 'tmp-images')
      mkdirSync(tmpDir, { recursive: true })
      const ext = opts.name.split('.').pop() || 'png'
      const fileName = `${opts.sessionId.slice(0, 8)}-${Date.now()}.${ext}`
      const filePath = join(tmpDir, fileName)
      writeFileSync(filePath, Buffer.from(opts.data))
      return { path: filePath }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('detect-claude-session-id', (_event, cwd: string) => {
    try {
      const encoded = cwd.replace(/\//g, '-')
      const claudeProjectDir = join(homedir(), '.claude', 'projects', encoded)
      if (!existsSync(claudeProjectDir)) return { sessionId: null }

      const files = readdirSync(claudeProjectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const fullPath = join(claudeProjectDir, f)
          return { name: f, mtime: statSync(fullPath).mtime.getTime() }
        })
        .sort((a, b) => b.mtime - a.mtime)

      if (files.length === 0) return { sessionId: null }
      const sessionId = files[0].name.replace('.jsonl', '')
      return { sessionId }
    } catch {
      return { sessionId: null }
    }
  })

  ipcMain.handle('cleanup-worktree', (_event, worktreePath: string, folderPath: string) => {
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: folderPath, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe']
      })
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('pty-list-sessions', () => {
    return ptyManager.getSessions()
  })

  // Active sessions (auto-resume)
  ipcMain.handle('active-sessions-set', (_event, session: any) => {
    activeSessions.set(session)
  })

  ipcMain.handle('active-sessions-update-claude-id', (_event, id: string, claudeSessionId: string) => {
    activeSessions.updateClaudeId(id, claudeSessionId)
  })

  ipcMain.handle('active-sessions-remove', (_event, id: string) => {
    activeSessions.remove(id)
  })

  ipcMain.handle('active-sessions-get-all', () => {
    return activeSessions.getAll()
  })

  // Session history
  ipcMain.handle('session-history-scan', (_event, folderPath: string, folderName: string) => {
    return scanProjectSessions(folderPath, folderName)
  })

  ipcMain.handle('session-history-title', (_event, claudeSessionId: string, dirName: string) => {
    return getSessionTitle(claudeSessionId, dirName)
  })
}

function runWorkspaceSetup(sessionCwd: string, projectPath: string) {
  const configPath = join(projectPath, '.devdock', 'config.json')
  if (!existsSync(configPath)) return

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (!config.setup || !Array.isArray(config.setup)) return

    for (const script of config.setup) {
      const scriptPath = join(projectPath, script)
      if (!existsSync(scriptPath)) continue
      try {
        execSync(`bash "${scriptPath}"`, {
          cwd: sessionCwd,
          encoding: 'utf-8',
          timeout: 30000,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            DEVDOCK_WORKSPACE_PATH: sessionCwd,
            DEVDOCK_PROJECT_PATH: projectPath,
          }
        })
      } catch { /* setup script failed — non-fatal */ }
    }
  } catch { /* invalid config — ignore */ }
}
