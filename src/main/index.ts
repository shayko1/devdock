import { app, BrowserWindow, ipcMain, shell, nativeImage, dialog } from 'electron'
import { join } from 'path'
import { readdirSync, statSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { execSync, exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
import { homedir } from 'os'
import { processManager, detectSystemPorts, killSystemProcess, getShellPath } from './process-manager'
import { ptyManager } from './pty-manager'
import { startBrowserBridge, setBrowserBridgeWindow, getBridgePort, stopBrowserBridge, openBrowserForSession, closeBrowserForSession, isBrowserOpenForSession } from './browser-bridge'
import { pipelineManager } from './pipeline-manager'
import { scanAgents, getAgentLogs, triggerAgent } from './agent-scanner'
import { loadState, saveState } from './store'
import { scanWorkspace } from './scanner'
import { detectRtk, installRtkHook, uninstallRtkHook, getRtkGainStats, writeRtkWrapper, setSessionRtkDisabled, isSessionRtkDisabled, cleanupSessionRtkFlag } from './rtk-manager'
import { coachManager } from './coach-manager'
import { activeSessions, scanProjectSessions, getSessionTitle } from './session-history'
import { AppState, Project, WorkspaceFolder } from '../shared/types'
import { CoachConfig } from '../shared/coach-types'

let mainWindow: BrowserWindow | null = null

const DEVDOCK_CLAUDE_MD = `# DevDock Browser Tool

You have a \`browser\` command available in your PATH for controlling a real browser window.
Use this instead of \`open\` when you need to interact with or inspect web pages.

## Commands
\`\`\`
browser open                        Open browser window
browser navigate <url>              Navigate to URL (aliases: goto, go)
browser screenshot                  Take screenshot & save to file (alias: snap)
browser click '<css-selector>'      Click an element
browser type '<selector>' <text>    Type text into input
browser evaluate '<js-code>'        Run JavaScript (aliases: eval, js)
browser text                        Get visible page text
browser content                     Get page HTML (alias: html)
browser url                         Get current URL and title
browser back / forward / reload     Navigation
browser close                       Close browser window
\`\`\`

## Examples
\`\`\`bash
browser navigate https://localhost:3000
browser screenshot
browser click '#submit-btn'
browser type '#email' hello@test.com
browser text
browser eval 'document.title'
\`\`\`

## Important
- Always use \`browser navigate <url>\` instead of \`open <url>\` when you need to see page content
- Use \`browser screenshot\` to capture what's on screen — the image is saved to a file you can reference
- Use \`browser text\` to get visible page text for analysis
- The browser window persists across commands — you don't need to reopen it each time
`

const DEVDOCK_RTK_MD = `

## RTK Token Compression

RTK (Rust Token Killer) is active. Commands like \`git status\`, \`ls\`, \`grep\`, and test runners
are automatically rewritten to compressed equivalents via the rtk hook.
This reduces token usage by 60-90% with <10ms overhead.

- Check savings: \`rtk gain\`
- See what could be optimized: \`rtk discover\`
`

function ensureDevDockClaudeMd(cwd: string, rtkEnabled?: boolean) {
  try {
    const claudeMdPath = join(cwd, 'CLAUDE.md')
    const marker = '# DevDock Browser Tool'

    let fullContent = DEVDOCK_CLAUDE_MD
    if (rtkEnabled) {
      fullContent += DEVDOCK_RTK_MD
    }

    if (existsSync(claudeMdPath)) {
      const content = readFileSync(claudeMdPath, 'utf-8')
      if (content.includes(marker)) return
      writeFileSync(claudeMdPath, content + '\n\n' + fullContent)
    } else {
      writeFileSync(claudeMdPath, fullContent)
    }
  } catch { /* ignore — non-critical */ }
}

function getCoachConfigPath() {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'coach-config.json')
}

function loadCoachConfig() {
  try {
    const configPath = getCoachConfigPath()
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8')
      const cfg = JSON.parse(raw) as CoachConfig
      coachManager.setConfig(cfg)
    }
  } catch { /* use defaults */ }
}

function saveCoachConfig(config: CoachConfig) {
  try {
    const configPath = getCoachConfigPath()
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch { /* ignore */ }
}

async function createWindow() {
  const iconPng = join(__dirname, '../../resources/icon.png')
  const iconIcns = join(__dirname, '../../resources/icon.icns')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'DevDock',
    titleBarStyle: 'hiddenInset',
    icon: iconPng,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    try {
      // Try PNG first (more reliable), fall back to icns
      let icon = nativeImage.createFromPath(iconPng)
      if (icon.isEmpty()) {
        icon = nativeImage.createFromPath(iconIcns)
      }
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon)
      }
    } catch { /* ignore */ }
  }

  processManager.setMainWindow(mainWindow)
  ptyManager.setMainWindow(mainWindow)
  ptyManager.setShellPath(getShellPath())
  setBrowserBridgeWindow(mainWindow)
  pipelineManager.setMainWindow(mainWindow)
  pipelineManager.loadConfigs()
  pipelineManager.loadRuns()
  coachManager.setMainWindow(mainWindow)
  loadCoachConfig()
  ptyManager.onData((sessionId, data) => coachManager.feedData(sessionId, data))
  await startBrowserBridge()

  // Write RTK wrapper if installed and enabled
  const appState = loadState()
  if (appState.rtkEnabled) {
    writeRtkWrapper()
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC Handlers
function setupIPC() {
  ipcMain.handle('get-state', () => {
    return loadState()
  })

  ipcMain.handle('save-state', (_event, state: AppState) => {
    saveState(state)
    return true
  })

  ipcMain.handle('scan-workspace', (_event, scanPath: string, maxDepth?: number) => {
    return scanWorkspace(scanPath, maxDepth)
  })

  ipcMain.handle('start-project', async (_event, project: Project) => {
    return processManager.startProject(project)
  })

  ipcMain.handle('stop-project', (_event, projectId: string) => {
    return processManager.stopProject(projectId)
  })

  ipcMain.handle('get-process-statuses', () => {
    return processManager.getAllStatuses()
  })

  ipcMain.handle('get-logs', (_event, projectId: string) => {
    return processManager.getLogs(projectId)
  })

  ipcMain.handle('open-in-browser', (_event, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('detect-system-ports', (_event, ports: number[]) => {
    const portMap = detectSystemPorts(ports)
    // Convert Map to plain object for IPC serialization
    const result: Record<number, { port: number; pid: number; command: string }> = {}
    for (const [port, info] of portMap) {
      result[port] = info
    }
    return result
  })

  ipcMain.handle('kill-system-process', (_event, pid: number) => {
    return killSystemProcess(pid)
  })

  ipcMain.handle('list-workspace-folders', (_event, scanPath: string) => {
    const folders: WorkspaceFolder[] = []
    try {
      const entries = readdirSync(scanPath)
      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules') continue
        const fullPath = join(scanPath, entry)
        try {
          const stat = statSync(fullPath)
          if (!stat.isDirectory()) continue
          folders.push({
            name: entry,
            path: fullPath,
            modifiedAt: stat.mtime.toISOString(),
            gitBranch: null,
            gitRemote: null
          })
        } catch { continue }
      }
    } catch { /* ignore */ }
    return folders.sort((a, b) => a.name.localeCompare(b.name))
  })

  ipcMain.handle('get-git-info', async (_event, folderPath: string) => {
    let gitBranch: string | null = null
    let gitRemote: string | null = null
    try {
      const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000
      })
      gitBranch = branch.trim()
      try {
        const { stdout: remote } = await execAsync('git remote get-url origin', {
          cwd: folderPath, encoding: 'utf-8', timeout: 3000
        })
        const r = remote.trim()
        if (r.includes('github.com')) {
          gitRemote = r
            .replace(/^git@github\.com:/, 'https://github.com/')
            .replace(/\.git$/, '')
        } else {
          gitRemote = r
        }
      } catch { /* no remote */ }
    } catch { /* not a git repo */ }
    return { gitBranch, gitRemote }
  })

  ipcMain.handle('get-git-status', async (_event, folderPath: string) => {
    const result: {
      branch: string | null; baseBranch: string | null; remote: string | null
      filesChanged: number; insertions: number; deletions: number
      commitsAhead: number; uncommitted: number; isGitRepo: boolean
    } = {
      branch: null, baseBranch: null, remote: null,
      filesChanged: 0, insertions: 0, deletions: 0,
      commitsAhead: 0, uncommitted: 0, isGitRepo: false
    }
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      })
      result.isGitRepo = true
    } catch { return result }

    try {
      result.branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
    } catch { /* ignore */ }

    try {
      const remote = execSync('git remote get-url origin', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      result.remote = remote.includes('github.com')
        ? remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
        : remote
    } catch { /* no remote */ }

    // Detect base branch (origin/main or origin/master)
    try {
      const remoteHead = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      result.baseBranch = remoteHead.replace('refs/remotes/origin/', '')
    } catch {
      // Fallback
      try {
        execSync('git rev-parse --verify origin/main', {
          cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
        })
        result.baseBranch = 'main'
      } catch {
        try {
          execSync('git rev-parse --verify origin/master', {
            cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
          })
          result.baseBranch = 'master'
        } catch { /* no remote base */ }
      }
    }

    // Diff stats vs base
    if (result.baseBranch) {
      try {
        const stat = execSync(`git diff --shortstat origin/${result.baseBranch}...HEAD`, {
          cwd: folderPath, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
        const filesMatch = stat.match(/(\d+) files? changed/)
        const insMatch = stat.match(/(\d+) insertions?/)
        const delMatch = stat.match(/(\d+) deletions?/)
        if (filesMatch) result.filesChanged = parseInt(filesMatch[1])
        if (insMatch) result.insertions = parseInt(insMatch[1])
        if (delMatch) result.deletions = parseInt(delMatch[1])
      } catch { /* ignore */ }

      // Commits ahead
      try {
        const count = execSync(`git rev-list --count origin/${result.baseBranch}..HEAD`, {
          cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
        result.commitsAhead = parseInt(count) || 0
      } catch { /* ignore */ }
    }

    // Uncommitted changes
    try {
      const status = execSync('git status --porcelain', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      result.uncommitted = status ? status.split('\n').length : 0
    } catch { /* ignore */ }

    return result
  })

  ipcMain.handle('list-branches', async (_event, folderPath: string) => {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      return { current: null, branches: [] }
    }

    let current: string | null = null
    try {
      current = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
    } catch { /* detached HEAD */ }

    const branches: string[] = []
    try {
      const raw = execSync('git branch --format="%(refname:short)"', {
        cwd: folderPath, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      if (raw) {
        for (const b of raw.split('\n')) {
          const name = b.trim()
          if (name) branches.push(name)
        }
      }
    } catch { /* ignore */ }

    return { current, branches }
  })

  ipcMain.handle('checkout-branch', async (_event, folderPath: string, branchName: string) => {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      return { success: false, error: 'Not a git repository' }
    }

    try {
      execSync(`git checkout "${branchName}"`, {
        cwd: folderPath, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe']
      })
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Your local changes') || msg.includes('would be overwritten')) {
        return { success: false, error: 'You have uncommitted changes. Commit or stash them first.' }
      }
      return { success: false, error: msg.slice(0, 200) }
    }
  })

  ipcMain.handle('open-in-ide', (_event, projectPath: string, ide: 'cursor' | 'zed') => {
    try {
      if (ide === 'cursor') {
        execSync(`cursor "${projectPath}"`, { stdio: 'ignore' })
      } else {
        execSync(`zed "${projectPath}"`, { stdio: 'ignore' })
      }
      return true
    } catch {
      // Fallback: try open with the app
      try {
        if (ide === 'cursor') {
          execSync(`open -a "Cursor" "${projectPath}"`, { stdio: 'ignore' })
        } else {
          execSync(`open -a "Zed" "${projectPath}"`, { stdio: 'ignore' })
        }
        return true
      } catch {
        return false
      }
    }
  })

  ipcMain.handle('open-claude-worktree', (_event, projectPath: string, projectName: string) => {
    try {
      // Check if it's a git repo
      try {
        execSync('git rev-parse --is-inside-work-tree', {
          cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
        })
      } catch {
        return { success: false, error: 'Not a git repository. Worktrees require git.' }
      }

      // Get current branch as base
      const baseBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      }).trim()

      // Create worktree directory
      const timestamp = Date.now().toString(36)
      const slug = projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()
      const worktreeBase = join(homedir(), '.devdock', 'worktrees', slug)
      const worktreePath = join(worktreeBase, timestamp, 'worktree')
      const branchName = `devdock/claude-${slug}-${timestamp}`

      mkdirSync(join(worktreeBase, timestamp), { recursive: true })

      // Create the worktree
      execSync(
        `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
        { cwd: projectPath, encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }
      )

      // Create a small script to run claude in the worktree
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

      // Open Terminal.app running the script
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

  ipcMain.handle('open-in-finder', (_event, projectPath: string) => {
    shell.showItemInFolder(projectPath)
  })

  ipcMain.handle('open-in-terminal', (_event, projectPath: string) => {
    try {
      execSync(`open -a "Terminal" "${projectPath}"`, { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('select-folder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Workspace Folder'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // PTY session handlers for embedded terminals
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

    // If resuming with an existing worktree, detect its branch name
    if (worktreePath) {
      try {
        branchName = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: worktreePath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
      } catch { /* ignore */ }
    }

    if (opts.useWorktree && !worktreePath) {
      // Check if it's a git repo first
      let isGitRepo = false
      try {
        execSync('git rev-parse --is-inside-work-tree', {
          cwd: opts.folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
        })
        isGitRepo = true
      } catch { /* not a git repo — fall through to open without worktree */ }

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
      // If not a git repo, continue without worktree (open in original folder)
    }

    // Write CLAUDE.md with browser instructions (and RTK info if enabled) into the session cwd
    const sessionCwd = worktreePath || opts.folderPath
    const currentState = loadState()
    ensureDevDockClaudeMd(sessionCwd, currentState.rtkEnabled)

    // Build command: safe mode by default, dangerous only when explicitly opted in
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
      // Use sessionId + timestamp to avoid conflicts
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
      // Claude Code stores sessions in ~/.claude/projects/<encoded-path>/<uuid>.jsonl
      // The path encoding replaces / with -
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

      // Return the newest session's UUID (filename without .jsonl)
      const sessionId = files[0].name.replace('.jsonl', '')
      return { sessionId }
    } catch {
      return { sessionId: null }
    }
  })

  ipcMain.handle('cleanup-worktree', (_event, worktreePath: string, folderPath: string) => {
    try {
      // Remove worktree from git
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: folderPath, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe']
      })
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // File explorer handlers
  ipcMain.handle('list-directory', async (_event, dirPath: string) => {
    try {
      const entries = readdirSync(dirPath)
      const items: { name: string; path: string; isDir: boolean; size: number }[] = []
      for (const entry of entries) {
        if (entry.startsWith('.') && entry !== '.env') continue
        if (entry === 'node_modules' || entry === '__pycache__' || entry === '.git') continue
        const fullPath = join(dirPath, entry)
        try {
          const stat = statSync(fullPath)
          items.push({
            name: entry,
            path: fullPath,
            isDir: stat.isDirectory(),
            size: stat.size
          })
        } catch { continue }
      }
      // Dirs first, then files, alphabetical within each
      items.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      return items
    } catch {
      return []
    }
  })

  ipcMain.handle('find-files-by-name', async (_event, rootPath: string, query: string) => {
    try {
      const q = query.toLowerCase().trim()
      const isPathQuery = q.includes('/')
      const results: { name: string; path: string; relativePath: string; isDir: boolean }[] = []
      const ignoreDirs = new Set(['node_modules', '.git', '.next', '.cache', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache'])
      const MAX = 300
      const MAX_DEPTH = 12

      const walk = (dir: string, depth: number) => {
        if (depth > MAX_DEPTH || results.length >= MAX) return
        try {
          const entries = readdirSync(dir)
          for (const entry of entries) {
            if (results.length >= MAX) return
            if (entry === '.DS_Store') continue
            const fullPath = join(dir, entry)
            try {
              const s = statSync(fullPath)
              const isDir = s.isDirectory()
              if (isDir && ignoreDirs.has(entry)) continue
              const rel = fullPath.replace(rootPath + '/', '')
              const relLower = rel.toLowerCase()

              let matches = false
              if (!q) {
                matches = true
              } else if (isPathQuery) {
                // Path query: match against relative path (prefix or contains)
                matches = relLower.startsWith(q) || relLower.includes(q)
              } else {
                // Name query: match against filename or path
                matches = entry.toLowerCase().includes(q) || relLower.includes(q)
              }

              if (matches) {
                results.push({ name: entry, path: fullPath, relativePath: rel, isDir })
              }
              if (isDir) walk(fullPath, depth + 1)
            } catch { continue }
          }
        } catch { /* skip */ }
      }

      walk(rootPath, 0)

      if (q) {
        results.sort((a, b) => {
          const al = a.relativePath.toLowerCase(), bl = b.relativePath.toLowerCase()
          if (isPathQuery) {
            // For path queries, prioritize: starts-with > contains, then shorter paths first
            const aStarts = al.startsWith(q) ? 0 : 1
            const bStarts = bl.startsWith(q) ? 0 : 1
            if (aStarts !== bStarts) return aStarts - bStarts
            // Prefer files over dirs for path search
            if (a.isDir !== b.isDir) return a.isDir ? 1 : -1
            return al.length - bl.length
          }
          // Name queries: exact > starts-with > contains, prefer shallow paths
          const anl = a.name.toLowerCase(), bnl = b.name.toLowerCase()
          const aExact = anl === q ? 0 : 1
          const bExact = bnl === q ? 0 : 1
          if (aExact !== bExact) return aExact - bExact
          const aStarts = anl.startsWith(q) ? 0 : 1
          const bStarts = bnl.startsWith(q) ? 0 : 1
          if (aStarts !== bStarts) return aStarts - bStarts
          if (a.isDir !== b.isDir) return a.isDir ? 1 : -1
          return a.relativePath.split('/').length - b.relativePath.split('/').length
        })
      }

      return results.slice(0, 30)
    } catch {
      return []
    }
  })

  ipcMain.handle('search-files', async (_event, rootPath: string, query: string) => {
    try {
      // Use grep -rn for text search, limit results
      const { stdout } = await execAsync(
        `grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.json' --include='*.css' --include='*.html' --include='*.md' --include='*.py' --include='*.go' --include='*.rs' --include='*.yaml' --include='*.yml' --include='*.toml' --include='*.sh' --include='*.sql' --include='*.graphql' --include='*.env' --include='*.txt' -l -- ${JSON.stringify(query)} ${JSON.stringify(rootPath)}`,
        { encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 1024 }
      )
      // Get matching files, then get line matches for each (limited)
      const files = stdout.trim().split('\n').filter(Boolean).slice(0, 50)
      const results: { file: string; relativePath: string; matches: { line: number; text: string }[] }[] = []

      for (const file of files) {
        try {
          const { stdout: lines } = await execAsync(
            `grep -n -- ${JSON.stringify(query)} ${JSON.stringify(file)}`,
            { encoding: 'utf-8', timeout: 3000, maxBuffer: 256 * 1024 }
          )
          const matches = lines.trim().split('\n').filter(Boolean).slice(0, 10).map(l => {
            const colonIdx = l.indexOf(':')
            return {
              line: parseInt(l.substring(0, colonIdx), 10),
              text: l.substring(colonIdx + 1).substring(0, 200)
            }
          })
          results.push({
            file,
            relativePath: file.replace(rootPath + '/', ''),
            matches
          })
        } catch { continue }
      }
      return { results }
    } catch (err: unknown) {
      // grep returns exit 1 when no matches
      if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 1) {
        return { results: [] }
      }
      return { results: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      const stat = statSync(filePath)
      if (stat.size > 500_000) return { error: 'File too large (>500KB)' }
      const content = readFileSync(filePath, 'utf-8')
      return { content }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('get-worktree-diff', async (_event, worktreePath: string) => {
    try {
      // Get both staged and unstaged changes
      const { stdout: diff } = await execAsync(
        'git diff HEAD --stat && echo "---FULL---" && git diff HEAD',
        { cwd: worktreePath, encoding: 'utf-8', timeout: 10000 }
      )
      return { diff }
    } catch (err: unknown) {
      // Might be initial commit with no HEAD
      try {
        const { stdout: diff } = await execAsync(
          'git diff --cached --stat && echo "---FULL---" && git diff --cached',
          { cwd: worktreePath, encoding: 'utf-8', timeout: 10000 }
        )
        return { diff }
      } catch {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  })

  ipcMain.handle('pty-list-sessions', () => {
    return ptyManager.getSessions()
  })

  // Browser bridge IPC
  ipcMain.handle('open-browser', (_event, sessionId: string, url?: string) => {
    openBrowserForSession(sessionId, url)
    return { opened: true }
  })

  ipcMain.handle('close-browser', (_event, sessionId: string) => {
    closeBrowserForSession(sessionId)
    return { closed: true }
  })

  ipcMain.handle('is-browser-open', (_event, sessionId: string) => {
    return isBrowserOpenForSession(sessionId)
  })

  ipcMain.handle('get-browser-bridge-port', () => {
    return getBridgePort()
  })

  // Pipeline handlers
  ipcMain.handle('pipeline-start', (_event, folderName: string, folderPath: string, taskDescription: string) => {
    return pipelineManager.startPipeline(folderName, folderPath, taskDescription)
  })

  ipcMain.handle('pipeline-cancel', (_event, pipelineId: string) => {
    pipelineManager.cancelPipeline(pipelineId)
  })

  ipcMain.handle('pipeline-get-runs', () => {
    return pipelineManager.getAllRuns()
  })

  ipcMain.handle('pipeline-get-config', (_event, folderPath: string) => {
    return pipelineManager.getConfig(folderPath)
  })

  ipcMain.handle('pipeline-set-config', (_event, folderPath: string, config: any) => {
    pipelineManager.setConfig(folderPath, config)
  })

  // RTK (Rust Token Killer) handlers
  ipcMain.handle('rtk-detect', () => {
    return detectRtk()
  })

  ipcMain.handle('rtk-enable', () => {
    const result = installRtkHook()
    if (result.success) writeRtkWrapper()
    return result
  })

  ipcMain.handle('rtk-disable', () => {
    return uninstallRtkHook()
  })

  ipcMain.handle('rtk-gain', () => {
    return getRtkGainStats()
  })

  ipcMain.handle('rtk-session-toggle', (_event, sessionId: string, disabled: boolean) => {
    setSessionRtkDisabled(sessionId, disabled)
    return { disabled }
  })

  ipcMain.handle('rtk-session-status', (_event, sessionId: string) => {
    return { disabled: isSessionRtkDisabled(sessionId) }
  })

  ipcMain.handle('rtk-session-cleanup', (_event, sessionId: string) => {
    cleanupSessionRtkFlag(sessionId)
  })

  // Agent scanner handlers
  ipcMain.handle('scan-agents', () => {
    return scanAgents()
  })

  ipcMain.handle('get-agent-logs', (_event, agentId: string, logType: 'history' | 'stdout') => {
    return getAgentLogs(agentId, logType)
  })

  ipcMain.handle('trigger-agent', (_event, agentId: string) => {
    return triggerAgent(agentId)
  })

  // Coach (prompt improvement assistant) handlers
  ipcMain.handle('coach-get-config', () => {
    return coachManager.getConfig()
  })

  ipcMain.handle('coach-set-config', (_event, config: CoachConfig) => {
    coachManager.setConfig(config)
    saveCoachConfig(config)
  })

  ipcMain.handle('coach-get-suggestions', (_event, sessionId: string) => {
    return coachManager.getSuggestions(sessionId)
  })

  ipcMain.handle('coach-get-cost', (_event, sessionId: string) => {
    return coachManager.getCost(sessionId)
  })

  ipcMain.handle('coach-get-total-cost', () => {
    return coachManager.getTotalCost()
  })

  ipcMain.handle('coach-dismiss', (_event, sessionId: string, suggestionId: string) => {
    coachManager.dismissSuggestion(sessionId, suggestionId)
  })

  // MCP & Skills management
  ipcMain.handle('mcp-get-config', (_event, projectPath?: string) => {
    const configs: { scope: string; path: string; servers: Record<string, any> }[] = []
    const home = homedir()

    // User-level: ~/.claude.json
    const userFile = join(home, '.claude.json')
    try {
      if (existsSync(userFile)) {
        const data = JSON.parse(readFileSync(userFile, 'utf-8'))
        if (data.mcpServers && Object.keys(data.mcpServers).length > 0) {
          configs.push({ scope: 'user', path: userFile, servers: data.mcpServers })
        }
      }
    } catch { /* ignore */ }

    // Project-level: .mcp.json in project root
    if (projectPath) {
      const projectFile = join(projectPath, '.mcp.json')
      try {
        if (existsSync(projectFile)) {
          const data = JSON.parse(readFileSync(projectFile, 'utf-8'))
          if (data.mcpServers && Object.keys(data.mcpServers).length > 0) {
            configs.push({ scope: 'project', path: projectFile, servers: data.mcpServers })
          }
        }
      } catch { /* ignore */ }
    }

    return configs
  })

  ipcMain.handle('mcp-save-config', (_event, filePath: string, servers: Record<string, any>) => {
    try {
      let data: any = {}
      if (existsSync(filePath)) {
        data = JSON.parse(readFileSync(filePath, 'utf-8'))
      }
      data.mcpServers = servers
      mkdirSync(join(filePath, '..'), { recursive: true })
      writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('skills-list', (_event, projectPath?: string) => {
    const skills: { name: string; scope: string; path: string; description: string }[] = []
    const home = homedir()

    const scanDir = (dir: string, scope: string) => {
      try {
        if (!existsSync(dir)) return
        for (const entry of readdirSync(dir)) {
          const entryPath = join(dir, entry)
          const stat = statSync(entryPath)
          // Skills: directories with SKILL.md
          if (stat.isDirectory()) {
            const skillFile = join(entryPath, 'SKILL.md')
            if (existsSync(skillFile)) {
              const content = readFileSync(skillFile, 'utf-8').slice(0, 500)
              const descMatch = content.match(/description:\s*(.+)/i)
              skills.push({
                name: entry,
                scope,
                path: skillFile,
                description: descMatch ? descMatch[1].trim() : ''
              })
            }
          }
          // Commands: .md files
          if (stat.isFile() && entry.endsWith('.md')) {
            const content = readFileSync(entryPath, 'utf-8').slice(0, 200)
            skills.push({
              name: '/' + entry.replace(/\.md$/, ''),
              scope,
              path: entryPath,
              description: content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'))?.trim() || ''
            })
          }
        }
      } catch { /* ignore */ }
    }

    // User-level skills & commands
    scanDir(join(home, '.claude', 'skills'), 'user')
    scanDir(join(home, '.claude', 'commands'), 'user')

    // Project-level skills & commands
    if (projectPath) {
      scanDir(join(projectPath, '.claude', 'skills'), 'project')
      scanDir(join(projectPath, '.claude', 'commands'), 'project')
    }

    return skills
  })

  ipcMain.handle('create-command', (_event, opts: { name: string; content: string; scope: 'user' | 'project'; projectPath?: string }) => {
    try {
      const home = homedir()
      const dir = opts.scope === 'user'
        ? join(home, '.claude', 'commands')
        : join(opts.projectPath || '', '.claude', 'commands')
      mkdirSync(dir, { recursive: true })
      const filename = opts.name.replace(/^\//, '').replace(/[^a-zA-Z0-9_-]/g, '-') + '.md'
      const filePath = join(dir, filename)
      if (existsSync(filePath)) {
        return { success: false, error: 'Command already exists' }
      }
      writeFileSync(filePath, opts.content, 'utf-8')
      return { success: true, path: filePath }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('delete-command', (_event, filePath: string) => {
    try {
      const { unlinkSync } = require('fs')
      unlinkSync(filePath)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Active sessions (for auto-resume on restart)
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

  // Session history (scans Claude Code's own files)
  ipcMain.handle('session-history-scan', (_event, folderPath: string, folderName: string) => {
    return scanProjectSessions(folderPath, folderName)
  })

  ipcMain.handle('session-history-title', (_event, claudeSessionId: string, dirName: string) => {
    return getSessionTitle(claudeSessionId, dirName)
  })
}

app.whenReady().then(() => {
  setupIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  processManager.stopAll()
  ptyManager.destroyAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  processManager.stopAll()
  ptyManager.destroyAll()
  pipelineManager.destroyAll()
  stopBrowserBridge()
})
