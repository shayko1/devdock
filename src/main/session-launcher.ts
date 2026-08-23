import { execSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { ptyManager } from './pty-manager'
import { loadState } from './store'
import { ensureDevDockClaudeMd } from './claude-md'
import { resolveClaudeLaunch } from './claude-launch'
import { statuslineWatcher } from './statusline-watcher'

/**
 * Shared Claude session launch path: optional git worktree, CLAUDE.md seeding,
 * pty creation, and initial command replay. Extracted from the preset-launch
 * handler so task delegation reuses it instead of copying it.
 *
 * execSync usage here mirrors the existing session.ts pattern. All interpolated
 * values (branch names, paths) are derived from the filesystem — not from
 * untrusted user input.
 */

export interface LaunchSessionInput {
  sessionId: string
  projectPath: string
  projectName: string
  useWorktree: boolean
  dangerousMode: boolean
  model?: string
  initialCommands?: string[]
}

export interface LaunchSessionResult {
  success: boolean
  error?: string
  id?: string
  folderName?: string
  claudeSessionId?: string | null
  worktreePath?: string | null
  branchName?: string | null
}

/** Delay before replaying initial commands, giving the shell time to start. */
const INITIAL_COMMAND_DELAY_MS = 1500

export function launchClaudeSession(input: LaunchSessionInput): LaunchSessionResult {
  let worktreePath: string | null = null
  let branchName: string | null = null

  if (input.useWorktree) {
    let isGitRepo = false
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: input.projectPath, encoding: 'utf-8', timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      isGitRepo = true
    } catch { /* not a git repo — fall through and run in place */ }

    if (isGitRepo) {
      try {
        const baseBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: input.projectPath, encoding: 'utf-8', timeout: 3000,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim()

        const timestamp = Date.now().toString(36)
        const slug = input.projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()
        const worktreeBase = join(homedir(), '.devdock', 'worktrees', slug)
        worktreePath = join(worktreeBase, timestamp, 'worktree')
        branchName = `devdock/claude-${slug}-${timestamp}`

        mkdirSync(join(worktreeBase, timestamp), { recursive: true })
        execSync(
          `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
          { cwd: input.projectPath, encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }
        )
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    }
  }

  const sessionCwd = worktreePath || input.projectPath
  const currentState = loadState()
  ensureDevDockClaudeMd(sessionCwd, currentState.rtkEnabled)

  const permFlag = input.dangerousMode ? ' --dangerously-skip-permissions' : ''
  const modelFlag = input.model ? ` --model ${input.model}` : ''

  // Always a fresh conversation — callers that resume go through session.ts.
  const launch = resolveClaudeLaunch({
    cwd: sessionCwd,
    flags: `${modelFlag}${permFlag}`,
  })

  const result = ptyManager.createSession(
    input.sessionId,
    input.projectName,
    input.projectPath,
    worktreePath,
    branchName,
    launch.command
  )

  if (result.success) {
    statuslineWatcher.watchSession(input.sessionId)
    const commands = (input.initialCommands ?? []).filter(c => c.trim().length > 0)
    if (commands.length > 0) {
      setTimeout(() => {
        for (const cmd of commands) {
          ptyManager.write(input.sessionId, cmd + '\n')
        }
      }, INITIAL_COMMAND_DELAY_MS)
    }
  }

  return { ...result, claudeSessionId: launch.claudeSessionId }
}
