/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above module-level consts, so the shared spies
// have to be created inside vi.hoisted rather than plain declarations.
const { execSync, createSession, write, ensureDevDockClaudeMd, watchSession } = vi.hoisted(() => ({
  execSync: vi.fn(),
  createSession: vi.fn(),
  write: vi.fn(),
  ensureDevDockClaudeMd: vi.fn(),
  watchSession: vi.fn(),
}))

vi.mock('child_process', () => ({ execSync }))
vi.mock('os', () => ({ homedir: () => '/tmp/test-home' }))
vi.mock('fs', () => ({ mkdirSync: vi.fn() }))
vi.mock('./pty-manager', () => ({ ptyManager: { createSession, write } }))
vi.mock('./store', () => ({ loadState: () => ({ rtkEnabled: false }) }))
vi.mock('./claude-md', () => ({ ensureDevDockClaudeMd }))
vi.mock('./claude-launch', () => ({
  resolveClaudeLaunch: ({ flags }: { flags: string }) => ({
    command: `claude${flags}`,
    claudeSessionId: 'claude-abc',
  }),
}))
vi.mock('./statusline-watcher', () => ({ statuslineWatcher: { watchSession } }))

import { launchClaudeSession } from './session-launcher'

function okSession() {
  createSession.mockReturnValue({
    success: true, id: 's1', folderName: 'proj', worktreePath: null, branchName: null,
  })
}

const base = {
  sessionId: 's1',
  projectPath: '/repo',
  projectName: 'proj',
  useWorktree: false,
  dangerousMode: false,
}

describe('launchClaudeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('launches without a worktree and returns the claude session id', () => {
    okSession()
    const result = launchClaudeSession(base)

    expect(result.success).toBe(true)
    expect(result.claudeSessionId).toBe('claude-abc')
    expect(execSync).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith('s1', 'proj', '/repo', null, null, 'claude')
  })

  it('passes model and dangerous flags into the launch command', () => {
    okSession()
    launchClaudeSession({ ...base, dangerousMode: true, model: 'opus' })

    expect(createSession).toHaveBeenCalledWith(
      's1', 'proj', '/repo', null, null, 'claude --model opus --dangerously-skip-permissions'
    )
  })

  it('skips worktree creation when the project is not a git repo', () => {
    execSync.mockImplementation(() => { throw new Error('not a git repo') })
    okSession()

    const result = launchClaudeSession({ ...base, useWorktree: true })

    expect(result.success).toBe(true)
    expect(createSession).toHaveBeenCalledWith('s1', 'proj', '/repo', null, null, 'claude')
  })

  it('returns the error when worktree creation fails in a git repo', () => {
    execSync
      .mockReturnValueOnce('true')       // rev-parse --is-inside-work-tree
      .mockReturnValueOnce('main\n')     // rev-parse --abbrev-ref HEAD
      .mockImplementationOnce(() => { throw new Error('worktree exists') })

    const result = launchClaudeSession({ ...base, useWorktree: true })

    expect(result.success).toBe(false)
    expect(result.error).toBe('worktree exists')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('writes initial commands after the startup delay', () => {
    vi.useFakeTimers()
    okSession()

    launchClaudeSession({ ...base, initialCommands: ['echo hi', '  ', 'ls'] })

    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500)

    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenNthCalledWith(1, 's1', 'echo hi\n')
    expect(write).toHaveBeenNthCalledWith(2, 's1', 'ls\n')
  })

  it('does not watch or write when the pty fails to start', () => {
    vi.useFakeTimers()
    createSession.mockReturnValue({ success: false, error: 'no pty' })

    launchClaudeSession({ ...base, initialCommands: ['echo hi'] })
    vi.advanceTimersByTime(2000)

    expect(watchSession).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
})
