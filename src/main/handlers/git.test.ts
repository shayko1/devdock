/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted creates variables before vi.mock hoisting runs
const { mockExec, mockExecFile, mockExecSync } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExecFile: vi.fn(),
  mockExecSync: vi.fn(),
}))

const handlers = new Map<string, Function>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: Function) => { handlers.set(channel, fn) }),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  })),
  shell: { openExternal: vi.fn() },
}))

vi.mock('fs', () => ({
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false, mtime: new Date() })),
}))

vi.mock('fs/promises', () => ({
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({ isDirectory: () => false, mtime: new Date() })),
}))

vi.mock('child_process', () => ({
  exec: mockExec,
  execFile: mockExecFile,
  execSync: mockExecSync,
}))

import { registerGitHandlers } from './git'

describe('git-sync-with-base handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlers.clear()
    registerGitHandlers()
  })

  const callSync = (folderPath: string) => {
    const handler = handlers.get('git-sync-with-base')
    if (!handler) throw new Error('git-sync-with-base handler not registered')
    return handler({} as any, folderPath)
  }

  it('returns error when base branch cannot be resolved', async () => {
    // All resolveDefaultBranch attempts fail
    mockExec.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
      cb(new Error('not a git repo'), { stdout: '', stderr: 'fatal: not a git repo' })
    })

    const result = await callSync('/some/path')
    expect(result).toEqual({ success: false, error: 'Could not determine base branch' })
  })

  it('returns success with stdout on fast-forward', async () => {
    // resolveDefaultBranch: symbolic-ref succeeds → returns 'main'
    mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
      cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' })
    })
    // fetch succeeds
    mockExecFile.mockImplementationOnce((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, { stdout: '', stderr: '' })
    })
    // merge --ff-only succeeds
    mockExecFile.mockImplementationOnce((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, { stdout: 'Already up to date.\n', stderr: '' })
    })

    const result = await callSync('/repo')
    expect(result).toEqual({ success: true, stdout: 'Already up to date.' })
  })

  it('returns informative error when ff-only fails (diverged branches)', async () => {
    // resolveDefaultBranch: symbolic-ref succeeds → returns 'main'
    mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
      cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' })
    })
    // fetch succeeds
    mockExecFile.mockImplementationOnce((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, { stdout: '', stderr: '' })
    })
    // merge --ff-only fails (diverged)
    const mergeErr: any = new Error('Not possible to fast-forward')
    mergeErr.stderr = 'fatal: Not possible to fast-forward, aborting.'
    mockExecFile.mockImplementationOnce((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(mergeErr, { stdout: '', stderr: mergeErr.stderr })
    })

    const result = await callSync('/repo')
    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Cannot fast-forward: your branch has diverged from origin/main. Merge or rebase manually.'
    )
  })

  it('returns error when fetch fails', async () => {
    // resolveDefaultBranch: symbolic-ref succeeds → returns 'master'
    mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
      cb(null, { stdout: 'refs/remotes/origin/master\n', stderr: '' })
    })
    // fetch fails
    const fetchErr: any = new Error('Network unreachable')
    fetchErr.stderr = 'fatal: Could not read from remote repository.'
    mockExecFile.mockImplementationOnce((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(fetchErr, { stdout: '', stderr: fetchErr.stderr })
    })

    const result = await callSync('/repo')
    expect(result.success).toBe(false)
    expect(result.error).toContain('fatal: Could not read from remote repository.')
  })
})
