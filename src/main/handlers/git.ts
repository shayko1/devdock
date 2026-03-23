import { ipcMain, shell } from 'electron'
import { join } from 'path'
import { readdirSync, statSync } from 'fs'
import { execSync, exec, execFile } from 'child_process'
import { promisify } from 'util'
import { WorkspaceFolder } from '../../shared/types'
import type { BulkGitPullOptions, BulkGitPullResult, BulkGitPullResultEntry } from '../../shared/ipc-types'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

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

export function registerGitHandlers() {
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
          gitRemote = r.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
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

    try {
      const remoteHead = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
        cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      result.baseBranch = remoteHead.replace('refs/remotes/origin/', '')
    } catch {
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

      try {
        const count = execSync(`git rev-list --count origin/${result.baseBranch}..HEAD`, {
          cwd: folderPath, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
        result.commitsAhead = parseInt(count) || 0
      } catch { /* ignore */ }
    }

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
    async (_event, scanPath: string, options: BulkGitPullOptions): Promise<BulkGitPullResult> => {
      const entries: BulkGitPullResultEntry[] = []
      const extras = options.extraRemoteSubstrings
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      const patterns =
        options.onlyWixRelated ? [...new Set(['wix', ...extras])] : []

      let dirNames: string[] = []
      try {
        dirNames = readdirSync(scanPath)
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

      for (const entry of dirNames) {
        if (entry.startsWith('.') || entry === 'node_modules') continue
        const fullPath = join(scanPath, entry)
        let isDir = false
        try {
          isDir = statSync(fullPath).isDirectory()
        } catch {
          continue
        }
        if (!isDir) continue

        try {
          await execAsync('git rev-parse --is-inside-work-tree', {
            cwd: fullPath,
            encoding: 'utf-8',
            timeout: 3000,
          })
        } catch {
          entries.push({
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
          entries.push({
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
            entries.push({
              name: entry,
              path: fullPath,
              status: 'skipped',
              detail: 'Origin does not match filter (Wix / extra substrings)',
            })
            continue
          }
        }

        try {
          await execAsync('git fetch origin', {
            cwd: fullPath,
            encoding: 'utf-8',
            timeout: 180_000,
            maxBuffer: 20 * 1024 * 1024,
          })
        } catch (err) {
          entries.push({
            name: entry,
            path: fullPath,
            status: 'failed',
            detail: `fetch: ${trimExecError(err, 'failed')}`,
          })
          continue
        }

        let branch: string | null = null
        try {
          const { stdout } = await execAsync('git symbolic-ref refs/remotes/origin/HEAD', {
            cwd: fullPath,
            encoding: 'utf-8',
            timeout: 8000,
          })
          const sym = stdout.trim()
          if (sym.startsWith('refs/remotes/origin/')) {
            branch = sym.replace('refs/remotes/origin/', '')
          }
        } catch {
          /* use main/master fallback */
        }
        if (!branch) {
          try {
            await execAsync('git rev-parse --verify origin/main', {
              cwd: fullPath,
              encoding: 'utf-8',
              timeout: 5000,
            })
            branch = 'main'
          } catch {
            try {
              await execAsync('git rev-parse --verify origin/master', {
                cwd: fullPath,
                encoding: 'utf-8',
                timeout: 5000,
              })
              branch = 'master'
            } catch {
              branch = null
            }
          }
        }

        if (!branch || !isSafeGitBranchName(branch)) {
          entries.push({
            name: entry,
            path: fullPath,
            status: 'failed',
            detail: 'Could not determine a safe default branch (main/master)',
          })
          continue
        }

        try {
          await execFileAsync('git', ['checkout', branch], {
            cwd: fullPath,
            timeout: 60_000,
            encoding: 'utf-8',
          })
        } catch (err) {
          entries.push({
            name: entry,
            path: fullPath,
            status: 'failed',
            branch,
            detail: `checkout: ${trimExecError(err, 'failed')}`,
          })
          continue
        }

        try {
          await execFileAsync('git', ['pull', '--ff-only', 'origin', branch], {
            cwd: fullPath,
            timeout: 120_000,
            maxBuffer: 20 * 1024 * 1024,
            encoding: 'utf-8',
          })
          entries.push({
            name: entry,
            path: fullPath,
            status: 'ok',
            branch,
            detail: `Up to date with origin/${branch} (ff-only)`,
          })
        } catch (err) {
          entries.push({
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
    }
  )
}
