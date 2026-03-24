import { BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { readdirSync, statSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { execSync, exec, execFile } from 'child_process'
import { promisify } from 'util'
import { WorkspaceFolder } from '../../shared/types'
import type {
  BulkGitPullOptions,
  BulkGitPullResult,
  BulkGitPullResultEntry,
  BulkGitPullProgressEvent,
  BulkGitPullPhase,
} from '../../shared/ipc-types'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

let bulkPullRunning = false

function trimExecError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && err !== null) {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    const s = `${e.stderr || ''}${e.stdout || ''}`.trim()
    if (s) return s.slice(0, 400)
    if (e.message) return e.message.slice(0, 400)
  }
  return fallback
}

/** Ref names from symbolic-ref / remote branches; blocks shell metacharacters. */
function isSafeGitBranchName(branch: string): boolean {
  return branch.length > 0 && branch.length < 256 && /^[\w./-]+$/.test(branch)
}

function notifyBulkProgress(win: BrowserWindow | null, payload: BulkGitPullProgressEvent): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('bulk-git-pull-progress', payload)
  }
}

/** Resolve default branch: origin/HEAD → main → master → null */
async function resolveDefaultBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd,
      encoding: 'utf-8',
      timeout: 8000,
    })
    const sym = stdout.trim()
    if (sym.startsWith('refs/remotes/origin/')) {
      const b = sym.replace('refs/remotes/origin/', '')
      if (isSafeGitBranchName(b)) return b
    }
  } catch {
    /* fallback */
  }
  for (const candidate of ['main', 'master'] as const) {
    try {
      await execAsync(`git rev-parse --verify origin/${candidate}`, {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
      })
      return candidate
    } catch {
      /* try next */
    }
  }
  return null
}

export function registerGitHandlers() {
  ipcMain.handle('list-workspace-folders', (_event, scanPath: string) => {
    const folders: WorkspaceFolder[] = []
    try {
      const entries = readdirSync(scanPath)
      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules') continue
        const fullPath = join(scanPath, entry)
        try {
          const st = statSync(fullPath)
          if (!st.isDirectory()) continue
          folders.push({
            name: entry,
            path: fullPath,
            modifiedAt: st.mtime.toISOString(),
            gitBranch: null,
            gitRemote: null,
          })
        } catch {
          continue
        }
      }
    } catch {
      /* ignore */
    }
    return folders.sort((a, b) => a.name.localeCompare(b.name))
  })

  ipcMain.handle('get-git-info', async (_event, folderPath: string) => {
    let gitBranch: string | null = null
    let gitRemote: string | null = null
    try {
      const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 3000,
      })
      gitBranch = branch.trim()
      try {
        const { stdout: remote } = await execAsync('git remote get-url origin', {
          cwd: folderPath,
          encoding: 'utf-8',
          timeout: 3000,
        })
        const r = remote.trim()
        if (r.includes('github.com')) {
          gitRemote = r.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
        } else {
          gitRemote = r
        }
      } catch {
        /* no remote */
      }
    } catch {
      /* not a git repo */
    }
    return { gitBranch, gitRemote }
  })

  ipcMain.handle('get-git-status', async (_event, folderPath: string) => {
    const result: {
      branch: string | null
      baseBranch: string | null
      remote: string | null
      filesChanged: number
      insertions: number
      deletions: number
      commitsAhead: number
      uncommitted: number
      isGitRepo: boolean
    } = {
      branch: null,
      baseBranch: null,
      remote: null,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      commitsAhead: 0,
      uncommitted: 0,
      isGitRepo: false,
    }
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      result.isGitRepo = true
    } catch {
      return result
    }

    try {
      result.branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      /* ignore */
    }

    try {
      const remote = execSync('git remote get-url origin', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      result.remote = remote.includes('github.com')
        ? remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
        : remote
    } catch {
      /* no remote */
    }

    result.baseBranch = await resolveDefaultBranch(folderPath)

    if (result.baseBranch) {
      try {
        const statOut = execSync(`git diff --shortstat origin/${result.baseBranch}...HEAD`, {
          cwd: folderPath,
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        const filesMatch = statOut.match(/(\d+) files? changed/)
        const insMatch = statOut.match(/(\d+) insertions?/)
        const delMatch = statOut.match(/(\d+) deletions?/)
        if (filesMatch) result.filesChanged = parseInt(filesMatch[1])
        if (insMatch) result.insertions = parseInt(insMatch[1])
        if (delMatch) result.deletions = parseInt(delMatch[1])
      } catch {
        /* ignore */
      }

      try {
        const count = execSync(`git rev-list --count origin/${result.baseBranch}..HEAD`, {
          cwd: folderPath,
          encoding: 'utf-8',
          timeout: 3000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        result.commitsAhead = parseInt(count) || 0
      } catch {
        /* ignore */
      }
    }

    try {
      const status = execSync('git status --porcelain', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      result.uncommitted = status ? status.split('\n').length : 0
    } catch {
      /* ignore */
    }

    return result
  })

  ipcMain.handle('list-branches', async (_event, folderPath: string) => {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return { current: null, branches: [] }
    }

    let current: string | null = null
    try {
      current = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      /* detached HEAD */
    }

    const branches: string[] = []
    try {
      const raw = execSync('git branch --format="%(refname:short)"', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (raw) {
        for (const b of raw.split('\n')) {
          const name = b.trim()
          if (name) branches.push(name)
        }
      }
    } catch {
      /* ignore */
    }

    return { current, branches }
  })

  ipcMain.handle('checkout-branch', async (_event, folderPath: string, branchName: string) => {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return { success: false, error: 'Not a git repository' }
    }

    if (!isSafeGitBranchName(branchName)) {
      return { success: false, error: 'Invalid branch name' }
    }

    try {
      await execFileAsync('git', ['checkout', branchName], {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 10000,
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

  ipcMain.handle('get-worktree-diff', async (_event, worktreePath: string) => {
    try {
      const { stdout: diff } = await execAsync(
        'git diff HEAD --stat && echo "---FULL---" && git diff HEAD',
        { cwd: worktreePath, encoding: 'utf-8', timeout: 10000 }
      )
      return { diff }
    } catch (err: unknown) {
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

  ipcMain.handle(
    'bulk-git-pull-workspace',
    async (event, scanPath: string, options: BulkGitPullOptions): Promise<BulkGitPullResult> => {
      if (bulkPullRunning) {
        return {
          entries: [
            {
              name: '(workspace)',
              path: scanPath,
              status: 'failed',
              detail: 'A bulk pull is already running — please wait for it to finish',
            },
          ],
        }
      }
      bulkPullRunning = true
      const win = BrowserWindow.fromWebContents(event.sender)

      const entries: BulkGitPullResultEntry[] = []

      const pushResult = (entry: BulkGitPullResultEntry) => {
        entries.push(entry)
        notifyBulkProgress(win, { kind: 'result', entry })
      }

      const sendActive = (name: string, path: string, phase: BulkGitPullPhase, index: number, total: number) => {
        notifyBulkProgress(win, { kind: 'active', name, path, phase, index, total })
      }

      try {
        const extras = options.extraRemoteSubstrings
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
        const patterns = options.onlyWixRelated ? [...new Set(['wix', ...extras])] : []

        let dirNames: string[]
        try {
          dirNames = await readdir(scanPath)
        } catch {
          return {
            entries: [
              {
                name: '(workspace)',
                path: scanPath,
                status: 'failed',
                detail: 'Cannot read workspace path',
              },
            ],
          }
        }

        const candidates: { name: string; path: string }[] = []
        for (const entry of dirNames) {
          if (entry.startsWith('.') || entry === 'node_modules') continue
          const fullPath = join(scanPath, entry)
          try {
            const st = await stat(fullPath)
            if (!st.isDirectory()) continue
            candidates.push({ name: entry, path: fullPath })
          } catch {
            continue
          }
        }

        const total = candidates.length

        for (let i = 0; i < candidates.length; i++) {
          const { name: entry, path: fullPath } = candidates[i]
          const index = i + 1

          try {
            await execAsync('git rev-parse --is-inside-work-tree', {
              cwd: fullPath,
              encoding: 'utf-8',
              timeout: 3000,
            })
          } catch {
            pushResult({
              name: entry,
              path: fullPath,
              status: 'skipped',
              detail: 'Not a git repository',
            })
            continue
          }

          let originRaw = ''
          try {
            const { stdout } = await execAsync('git remote get-url origin', {
              cwd: fullPath,
              encoding: 'utf-8',
              timeout: 5000,
            })
            originRaw = stdout.trim()
          } catch {
            pushResult({
              name: entry,
              path: fullPath,
              status: 'skipped',
              detail: 'No origin remote',
            })
            continue
          }
          const originLower = originRaw.toLowerCase()

          if (options.onlyWixRelated) {
            const match = patterns.some((p) => originLower.includes(p))
            if (!match) {
              pushResult({
                name: entry,
                path: fullPath,
                status: 'skipped',
                detail: 'Origin does not match filter (Wix / extra substrings)',
              })
              continue
            }
          }

          sendActive(entry, fullPath, 'fetch', index, total)
          try {
            await execAsync('git fetch origin', {
              cwd: fullPath,
              encoding: 'utf-8',
              timeout: 180_000,
              maxBuffer: 20 * 1024 * 1024,
            })
          } catch (err) {
            pushResult({
              name: entry,
              path: fullPath,
              status: 'failed',
              detail: `fetch: ${trimExecError(err, 'failed')}`,
            })
            continue
          }

          const branch = await resolveDefaultBranch(fullPath)
          if (!branch) {
            pushResult({
              name: entry,
              path: fullPath,
              status: 'failed',
              detail: 'Could not determine a safe default branch (main/master)',
            })
            continue
          }

          try {
            const { stdout: porcelain } = await execAsync('git status --porcelain', {
              cwd: fullPath,
              encoding: 'utf-8',
              timeout: 8000,
            })
            if (porcelain.trim()) {
              pushResult({
                name: entry,
                path: fullPath,
                status: 'skipped',
                branch,
                detail: 'Uncommitted changes — checkout skipped. Stash or commit first.',
              })
              continue
            }
          } catch (err) {
            pushResult({
              name: entry,
              path: fullPath,
              status: 'failed',
              branch,
              detail: `status: ${trimExecError(err, 'failed')}`,
            })
            continue
          }

          sendActive(entry, fullPath, 'checkout', index, total)
          try {
            await execFileAsync('git', ['checkout', branch], {
              cwd: fullPath,
              timeout: 60_000,
              encoding: 'utf-8',
            })
          } catch (err) {
            pushResult({
              name: entry,
              path: fullPath,
              status: 'failed',
              branch,
              detail: `checkout: ${trimExecError(err, 'failed')}`,
            })
            continue
          }

          sendActive(entry, fullPath, 'pull', index, total)
          try {
            await execFileAsync('git', ['pull', '--ff-only', 'origin', branch], {
              cwd: fullPath,
              timeout: 120_000,
              maxBuffer: 20 * 1024 * 1024,
              encoding: 'utf-8',
            })
            pushResult({
              name: entry,
              path: fullPath,
              status: 'ok',
              branch,
              detail: `Up to date with origin/${branch} (ff-only)`,
            })
          } catch (err) {
            pushResult({
              name: entry,
              path: fullPath,
              status: 'failed',
              branch,
              detail: `pull: ${trimExecError(err, 'failed')}`,
            })
          }
        }

        entries.sort((a, b) => a.name.localeCompare(b.name))
        return { entries }
      } finally {
        bulkPullRunning = false
      }
    }
  )
}
