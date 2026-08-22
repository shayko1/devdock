# Tasks Time-Blocking Implementation Plan (1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `tasks` tab to DevDock with a task board, one-line capture, and a day canvas you can drag tasks onto — plus extract the Claude session launch path so a later phase can delegate a task to a real agent session.

**Architecture:** A `TaskManager` in the main process owns `~/.devdock/tasks.json` and is reached over `tasks:*` IPC channels through the preload bridge, exactly as `KanbanManager` and `PresetManager` are. All non-trivial logic lives in pure modules under `src/shared/` so it is unit-testable without Electron or a DOM. Nothing in the existing session Kanban is modified.

**Tech Stack:** Electron 33, React 19, TypeScript 5.7, electron-vite, Vitest (jsdom default, `@vitest-environment node` for main-process tests), `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-08-22-tasks-timeblocking-design.md`

## Global Constraints

- **Branch:** `feat/tasks-timeblocking`, already created off `5fa7f6e`. Do not rebase onto `main` — `claude-launch.ts` is 120 lines ahead of `main` on this line of work.
- **Timestamps are epoch numbers** (`number`), never ISO strings. Matches `SessionPreset.createdAt`.
- **Tests are colocated** as `<source>.test.ts` beside the file they test. Main-process tests start with the `/** @vitest-environment node */` docblock; renderer tests rely on the default jsdom environment from `vitest.config.ts`.
- **Persistence is atomic:** write `<path>.tmp` then `renameSync` over the target. Never write the real file directly.
- **A corrupt or missing JSON file yields defaults, never a throw.** Matches `loadState()` and `PresetManager.loadPresets()`.
- **Do not modify** `KanbanPanel.tsx`, `KanbanColumn.tsx`, `KanbanCard.tsx`, `kanban-manager.ts`, `useKanban.ts`, or `ActiveSession.columnId`.
- **Priority is `1 | 2 | 3 | 4`**, 1 highest, default 3.
- **IPC channel prefix is `tasks:`** with a colon, matching `kanban:`.
- Run the full suite with `npx vitest run` before every commit. It must be green.

---

### Task 1: Extract the Claude session launcher

The `preset-launch` handler inlines ~90 lines of worktree creation, CLAUDE.md seeding, pty creation and initial-command writing. Delegation (plan 2) needs every one of those steps, so they move to a reusable function now, while the only caller is one we can verify.

**Files:**
- Create: `src/main/session-launcher.ts`
- Create: `src/main/session-launcher.test.ts`
- Modify: `src/main/handlers/presets.ts:45-134` (handler becomes a thin wrapper)

**Interfaces:**
- Consumes: `ptyManager.createSession(sessionId, folderName, folderPath, worktreePath, branchName, command)` from `./pty-manager`; `resolveClaudeLaunch({ cwd, flags })` from `./claude-launch`; `ensureDevDockClaudeMd(cwd, rtkEnabled)` from `./claude-md`; `statuslineWatcher.watchSession(id)`; `loadState()` from `./store`.
- Produces: `launchClaudeSession(input: LaunchSessionInput): LaunchSessionResult` — used by `preset-launch` here and by `tasks:delegate` in plan 2.

- [ ] **Step 1: Write the failing test**

Create `src/main/session-launcher.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const execSync = vi.fn()
vi.mock('child_process', () => ({ execSync: (...a: unknown[]) => execSync(...a) }))
vi.mock('os', () => ({ homedir: () => '/tmp/test-home' }))
vi.mock('fs', () => ({ mkdirSync: vi.fn() }))

const createSession = vi.fn()
const write = vi.fn()
vi.mock('./pty-manager', () => ({ ptyManager: { createSession, write } }))

vi.mock('./store', () => ({ loadState: () => ({ rtkEnabled: false }) }))
const ensureDevDockClaudeMd = vi.fn()
vi.mock('./claude-md', () => ({ ensureDevDockClaudeMd }))
vi.mock('./claude-launch', () => ({
  resolveClaudeLaunch: ({ flags }: { flags: string }) => ({
    command: `claude${flags}`,
    claudeSessionId: 'claude-abc',
  }),
}))
const watchSession = vi.fn()
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd /Users/shayk/Workspace/devdock && npx vitest run src/main/session-launcher.test.ts`
Expected: FAIL — cannot resolve `./session-launcher`.

- [ ] **Step 3: Create `src/main/session-launcher.ts`**

This is a faithful move of `handlers/presets.ts:54-134`. Keep the `execSync` calls, timeouts and `stdio` triples identical — they are load-bearing.

```ts
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
 * execSync usage mirrors the existing session.ts pattern. All interpolated
 * values are derived from the filesystem, not from untrusted input.
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/main/session-launcher.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Replace the handler body in `src/main/handlers/presets.ts`**

Delete the whole `ipcMain.handle('preset-launch', ...)` block (lines 45-134) and put this in its place:

```ts
  ipcMain.handle('preset-launch', (_event, opts: {
    presetId: string
    sessionId: string
  }) => {
    const preset = presetManager.getPreset(opts.presetId)
    if (!preset) {
      return { success: false, error: 'Preset not found' }
    }

    const result = launchClaudeSession({
      sessionId: opts.sessionId,
      projectPath: preset.projectPath,
      projectName: preset.projectName,
      useWorktree: preset.useWorktree,
      dangerousMode: preset.dangerousMode,
      model: preset.model,
      initialCommands: preset.initialCommands,
    })

    if (result.success) {
      presetManager.recordUsage(opts.presetId)
    }

    return { ...result, preset }
  })
```

Then fix the imports at the top of the file: add `import { launchClaudeSession } from '../session-launcher'`, and remove the now-unused `ptyManager`, `loadState`, `ensureDevDockClaudeMd`, `resolveClaudeLaunch`, `statuslineWatcher`, `execSync`, `join`, `homedir`, `mkdirSync` imports. Leave the file's top doc comment about `execSync` — move it into `session-launcher.ts` (it is already in the code block above) and delete it from `presets.ts`.

One intentional, benign behaviour difference: a worktree failure now returns `preset` alongside `success: false`, where before it returned only `{ success, error }`. Extra field, no consumer relies on its absence.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green. Preset launching is unchanged; no test touched it before, and now six cover it.

- [ ] **Step 7: Commit**

```bash
git add src/main/session-launcher.ts src/main/session-launcher.test.ts src/main/handlers/presets.ts
git commit -m "refactor(sessions): extract launchClaudeSession from preset-launch handler"
```

---

### Task 2: Task types and `TaskManager`

**Files:**
- Modify: `src/shared/ipc-types.ts` (append a Tasks section)
- Create: `src/main/task-manager.ts`
- Create: `src/main/task-manager.test.ts`

**Interfaces:**
- Consumes: `KanbanColumn` from `../shared/ipc-types` (reused as a type; column *data* is stored separately).
- Produces: `taskManager` singleton and the `TaskManager` class with `getAll()`, `createTask()`, `updateTask()`, `deleteTask()`, `saveColumns()`, `setBlock()`, `deleteBlock()`, `batchBlocks()`, `setFocus()`. Types `Task`, `TaskBlock`, `TaskDelegation`, `TasksFile`, `TaskCreate`, `TaskBlockInput`.

- [ ] **Step 1: Add the types to `src/shared/ipc-types.ts`**

Append at the end of the file:

```ts
// ── Tasks ──

export interface TaskDelegation {
  /** DevDock pty session id. */
  sessionId: string
  claudeSessionId: string | null
  worktreePath: string | null
  branchName: string | null
  launchedAt: number
  prompt: string
}

export interface Task {
  id: string
  title: string
  notes?: string
  /** 1 = highest. */
  priority: 1 | 2 | 3 | 4
  estimateMinutes?: number
  status: 'open' | 'done' | 'dropped' | 'delegated'
  dueAt?: number
  /** Board column. Falls back to the first column when unset or dangling. */
  columnId?: string
  /** Absolute path of the DevDock project this task belongs to. Required to delegate. */
  projectPath?: string
  projectName?: string
  delegation?: TaskDelegation
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface TaskBlock {
  id: string
  taskId: string
  startsAt: number
  endsAt: number
  /** Non-null means the focus timer is running for this block. */
  focusStartedAt?: number
  /** Accumulated focus seconds, excluding any currently running stretch. */
  focusSeconds: number
  /** Block this one was rolled over from, for push-count provenance. */
  rolledFrom?: string
}

export interface TasksFile {
  version: 1
  tasks: Task[]
  blocks: TaskBlock[]
  /** Task board columns — independent of the session Kanban's columns. */
  columns: KanbanColumn[]
}

export type TaskCreate = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>

export interface TaskBlockInput {
  /** Omit to create; supply to move or resize an existing block. */
  id?: string
  taskId: string
  startsAt: number
  endsAt: number
  rolledFrom?: string
}
```

- [ ] **Step 2: Write the failing test**

Create `src/main/task-manager.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
}))
vi.mock('os', () => ({ homedir: () => '/tmp/test-home' }))

let uuidCounter = 0
vi.mock('crypto', () => ({ randomUUID: () => `id-${uuidCounter++}` }))

import { TaskManager } from './task-manager'

const TASKS_PATH = '/tmp/test-home/.devdock/tasks.json'

function newManager(fileContents?: unknown) {
  vi.mocked(fs.existsSync).mockReturnValue(fileContents !== undefined)
  if (fileContents !== undefined) {
    vi.mocked(fs.readFileSync).mockReturnValue(
      typeof fileContents === 'string' ? fileContents : JSON.stringify(fileContents)
    )
  }
  return new TaskManager()
}

function writtenFile(): { version: number; tasks: unknown[]; blocks: unknown[]; columns: unknown[] } {
  const calls = vi.mocked(fs.writeFileSync).mock.calls
  return JSON.parse(calls[calls.length - 1][1] as string)
}

const taskInput = {
  title: 'Write the spec',
  priority: 3 as const,
  status: 'open' as const,
}

describe('TaskManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uuidCounter = 0
  })

  it('seeds four default columns when no file exists', () => {
    const m = newManager()
    const names = m.getAll().columns.map(c => c.name)
    expect(names).toEqual(['Backlog', 'Today', 'Doing', 'Done'])
  })

  it('recovers to defaults from a corrupt file instead of throwing', () => {
    const m = newManager('{ not json')
    const file = m.getAll()
    expect(file.tasks).toEqual([])
    expect(file.columns).toHaveLength(4)
  })

  it('writes atomically via a tmp file and rename', () => {
    const m = newManager()
    m.createTask(taskInput)

    expect(vi.mocked(fs.writeFileSync).mock.calls[0][0]).toBe(TASKS_PATH + '.tmp')
    expect(fs.renameSync).toHaveBeenCalledWith(TASKS_PATH + '.tmp', TASKS_PATH)
  })

  it('assigns new tasks to the first column', () => {
    const m = newManager()
    const first = m.getAll().columns.find(c => c.order === 0)!
    const task = m.createTask(taskInput)
    expect(task.columnId).toBe(first.id)
  })

  it('deleting a task cascades its blocks in one write', () => {
    const m = newManager()
    const task = m.createTask(taskInput)
    m.setBlock({ taskId: task.id, startsAt: 1000, endsAt: 2000 })

    expect(m.deleteTask(task.id)).toBe(true)
    const file = writtenFile()
    expect(file.tasks).toHaveLength(0)
    expect(file.blocks).toHaveLength(0)
  })

  it('clears the columnId of tasks whose column was deleted', () => {
    const m = newManager()
    const columns = m.getAll().columns
    const task = m.createTask({ ...taskInput, columnId: columns[1].id })

    m.saveColumns(columns.filter(c => c.id !== columns[1].id))

    expect(m.getAll().tasks.find(t => t.id === task.id)!.columnId).toBeUndefined()
  })

  it('setBlock updates in place when an id is supplied', () => {
    const m = newManager()
    const task = m.createTask(taskInput)
    const block = m.setBlock({ taskId: task.id, startsAt: 1000, endsAt: 2000 })

    const moved = m.setBlock({ id: block.id, taskId: task.id, startsAt: 5000, endsAt: 6000 })

    expect(moved.id).toBe(block.id)
    expect(m.getAll().blocks).toHaveLength(1)
    expect(m.getAll().blocks[0].startsAt).toBe(5000)
  })

  it('starting focus on a block stops any other running block', () => {
    const m = newManager()
    const a = m.createTask(taskInput)
    const b = m.createTask({ ...taskInput, title: 'Other' })
    const blockA = m.setBlock({ taskId: a.id, startsAt: 1000, endsAt: 2000 })
    const blockB = m.setBlock({ taskId: b.id, startsAt: 3000, endsAt: 4000 })

    m.setFocus(blockA.id, 'start', 10_000)
    m.setFocus(blockB.id, 'start', 15_000)

    const blocks = m.getAll().blocks
    const stopped = blocks.find(x => x.id === blockA.id)!
    const running = blocks.find(x => x.id === blockB.id)!

    expect(stopped.focusStartedAt).toBeUndefined()
    expect(stopped.focusSeconds).toBe(5)
    expect(running.focusStartedAt).toBe(15_000)
  })

  it('stopping focus accumulates elapsed seconds', () => {
    const m = newManager()
    const task = m.createTask(taskInput)
    const block = m.setBlock({ taskId: task.id, startsAt: 1000, endsAt: 2000 })

    m.setFocus(block.id, 'start', 60_000)
    m.setFocus(block.id, 'stop', 150_000)

    const updated = m.getAll().blocks[0]
    expect(updated.focusSeconds).toBe(90)
    expect(updated.focusStartedAt).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run src/main/task-manager.test.ts`
Expected: FAIL — cannot resolve `./task-manager`.

- [ ] **Step 4: Create `src/main/task-manager.ts`**

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import type {
  KanbanColumn, Task, TaskBlock, TaskCreate, TaskBlockInput, TasksFile,
} from '../shared/ipc-types'

const DEFAULT_COLUMN_NAMES = ['Backlog', 'Today', 'Doing', 'Done']

function getTasksPath(): string {
  const dir = join(homedir(), '.devdock')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'tasks.json')
}

function defaultColumns(): KanbanColumn[] {
  return DEFAULT_COLUMN_NAMES.map((name, order) => ({ id: randomUUID(), name, order }))
}

function emptyFile(): TasksFile {
  return { version: 1, tasks: [], blocks: [], columns: defaultColumns() }
}

/**
 * Owns ~/.devdock/tasks.json. Follows PresetManager: lazy load, in-memory
 * cache, atomic tmp-then-rename writes, and defaults rather than throws on a
 * missing or corrupt file.
 */
export class TaskManager {
  private file: TasksFile = emptyFile()
  private loaded = false

  getAll(): TasksFile {
    this.ensureLoaded()
    return {
      version: 1,
      tasks: [...this.file.tasks],
      blocks: [...this.file.blocks],
      columns: [...this.file.columns],
    }
  }

  createTask(input: TaskCreate): Task {
    this.ensureLoaded()
    const now = Date.now()
    const task: Task = {
      ...input,
      columnId: input.columnId ?? this.firstColumnId(),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.file.tasks.push(task)
    this.persist()
    return { ...task }
  }

  updateTask(id: string, partial: Partial<Task>): Task | null {
    this.ensureLoaded()
    const index = this.file.tasks.findIndex(t => t.id === id)
    if (index === -1) return null

    const { id: _id, createdAt: _ca, ...safe } = partial
    const next: Task = { ...this.file.tasks[index], ...safe, updatedAt: Date.now() }
    if (safe.status === 'done' && !next.completedAt) next.completedAt = Date.now()
    if (safe.status && safe.status !== 'done') next.completedAt = undefined

    this.file.tasks[index] = next
    this.persist()
    return { ...next }
  }

  /** Removes the task and every block pointing at it, in a single write. */
  deleteTask(id: string): boolean {
    this.ensureLoaded()
    const before = this.file.tasks.length
    this.file.tasks = this.file.tasks.filter(t => t.id !== id)
    if (this.file.tasks.length === before) return false

    this.file.blocks = this.file.blocks.filter(b => b.taskId !== id)
    this.persist()
    return true
  }

  /** Mirrors KanbanManager.saveColumns: tasks in deleted columns lose columnId. */
  saveColumns(columns: KanbanColumn[]): KanbanColumn[] {
    this.ensureLoaded()
    const kept = new Set(columns.map(c => c.id))
    this.file.columns = columns
    this.file.tasks = this.file.tasks.map(t =>
      t.columnId && !kept.has(t.columnId) ? { ...t, columnId: undefined } : t
    )
    this.persist()
    return [...this.file.columns]
  }

  /** Creates a block, or moves/resizes one when input.id is supplied. */
  setBlock(input: TaskBlockInput): TaskBlock {
    this.ensureLoaded()
    if (input.id) {
      const index = this.file.blocks.findIndex(b => b.id === input.id)
      if (index !== -1) {
        const next: TaskBlock = {
          ...this.file.blocks[index],
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        }
        this.file.blocks[index] = next
        this.persist()
        return { ...next }
      }
    }

    const block: TaskBlock = {
      id: randomUUID(),
      taskId: input.taskId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      focusSeconds: 0,
      rolledFrom: input.rolledFrom,
    }
    this.file.blocks.push(block)
    this.persist()
    return { ...block }
  }

  deleteBlock(id: string): boolean {
    this.ensureLoaded()
    const before = this.file.blocks.length
    this.file.blocks = this.file.blocks.filter(b => b.id !== id)
    if (this.file.blocks.length === before) return false
    this.persist()
    return true
  }

  /** Persists a whole packer run in one write. */
  batchBlocks(inputs: TaskBlockInput[]): TaskBlock[] {
    this.ensureLoaded()
    const created: TaskBlock[] = inputs.map(input => ({
      id: randomUUID(),
      taskId: input.taskId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      focusSeconds: 0,
      rolledFrom: input.rolledFrom,
    }))
    this.file.blocks.push(...created)
    this.persist()
    return created.map(b => ({ ...b }))
  }

  /**
   * Starts or stops the focus timer. Starting one block stops every other
   * running block in the same write, so only one can ever be live.
   * `now` is a parameter so tests are not clock-dependent.
   */
  setFocus(blockId: string, action: 'start' | 'stop', now: number = Date.now()): TaskBlock | null {
    this.ensureLoaded()
    const target = this.file.blocks.find(b => b.id === blockId)
    if (!target) return null

    this.file.blocks = this.file.blocks.map(block => {
      const isRunning = block.focusStartedAt != null
      const shouldStop = isRunning && (block.id !== blockId || action === 'stop')
      if (shouldStop) {
        const elapsed = Math.max(0, Math.round((now - block.focusStartedAt!) / 1000))
        return { ...block, focusSeconds: block.focusSeconds + elapsed, focusStartedAt: undefined }
      }
      if (block.id === blockId && action === 'start' && !isRunning) {
        return { ...block, focusStartedAt: now }
      }
      return block
    })

    this.persist()
    return { ...this.file.blocks.find(b => b.id === blockId)! }
  }

  private firstColumnId(): string | undefined {
    return [...this.file.columns].sort((a, b) => a.order - b.order)[0]?.id
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true

    const filePath = getTasksPath()
    if (!existsSync(filePath)) {
      this.file = emptyFile()
      this.persist()
      return
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<TasksFile>
      this.file = {
        version: 1,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
        columns: Array.isArray(parsed.columns) && parsed.columns.length > 0
          ? parsed.columns
          : defaultColumns(),
      }
    } catch {
      this.file = emptyFile()
    }
  }

  private persist(): void {
    const filePath = getTasksPath()
    mkdirSync(dirname(filePath), { recursive: true })
    const tmpPath = filePath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(this.file, null, 2), 'utf-8')
    renameSync(tmpPath, filePath)
  }
}

export const taskManager = new TaskManager()
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/main/task-manager.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the full suite and typecheck, then commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/shared/ipc-types.ts src/main/task-manager.ts src/main/task-manager.test.ts
git commit -m "feat(tasks): add task types and TaskManager with atomic persistence"
```

---

### Task 3: IPC handlers and preload bridge

**Files:**
- Create: `src/main/handlers/tasks.ts`
- Create: `src/main/handlers/tasks.test.ts`
- Modify: `src/main/handlers/index.ts` (add the export)
- Modify: `src/main/index.ts` (import at ~line 40, call at ~line 187)
- Modify: `src/preload/index.ts` (add bridge methods near the kanban ones at line 343)

**Interfaces:**
- Consumes: `taskManager` from `../task-manager`; types from `../../shared/ipc-types`.
- Produces: `registerTaskHandlers()`; and on `window.api`: `tasksGetAll`, `tasksCreate`, `tasksUpdate`, `tasksDelete`, `tasksSaveColumns`, `tasksSetBlock`, `tasksDeleteBlock`, `tasksBatchBlocks`, `tasksFocus`.

- [ ] **Step 1: Write the failing test**

Create `src/main/handlers/tasks.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: any[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: any[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))

const taskManager = {
  getAll: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  saveColumns: vi.fn(),
  setBlock: vi.fn(),
  deleteBlock: vi.fn(),
  batchBlocks: vi.fn(),
  setFocus: vi.fn(),
}
vi.mock('../task-manager', () => ({ taskManager }))

import { registerTaskHandlers } from './tasks'

function invoke(channel: string, ...args: unknown[]) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`No handler registered for ${channel}`)
  return fn({}, ...args)
}

describe('task IPC handlers', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    registerTaskHandlers()
  })

  it('registers every tasks channel', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'tasks:batch-blocks',
      'tasks:create',
      'tasks:delete',
      'tasks:delete-block',
      'tasks:focus',
      'tasks:get-all',
      'tasks:save-columns',
      'tasks:set-block',
      'tasks:update',
    ])
  })

  it('tasks:get-all delegates to the manager', () => {
    taskManager.getAll.mockReturnValue({ version: 1, tasks: [], blocks: [], columns: [] })
    expect(invoke('tasks:get-all')).toEqual({ version: 1, tasks: [], blocks: [], columns: [] })
  })

  it('tasks:create forwards the input', () => {
    invoke('tasks:create', { title: 'x', priority: 3, status: 'open' })
    expect(taskManager.createTask).toHaveBeenCalledWith({ title: 'x', priority: 3, status: 'open' })
  })

  it('tasks:update forwards id and patch separately', () => {
    invoke('tasks:update', 't1', { title: 'y' })
    expect(taskManager.updateTask).toHaveBeenCalledWith('t1', { title: 'y' })
  })

  it('tasks:focus forwards block id and action', () => {
    invoke('tasks:focus', { blockId: 'b1', action: 'start' })
    expect(taskManager.setFocus).toHaveBeenCalledWith('b1', 'start')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/main/handlers/tasks.test.ts`
Expected: FAIL — cannot resolve `./tasks`.

- [ ] **Step 3: Create `src/main/handlers/tasks.ts`**

```ts
import { ipcMain } from 'electron'
import { taskManager } from '../task-manager'
import type {
  KanbanColumn, Task, TaskBlockInput, TaskCreate,
} from '../../shared/ipc-types'

/** IPC handlers for the Tasks tab. Every write persists before returning. */
export function registerTaskHandlers() {
  ipcMain.handle('tasks:get-all', () => {
    return taskManager.getAll()
  })

  ipcMain.handle('tasks:create', (_event, input: TaskCreate) => {
    return taskManager.createTask(input)
  })

  ipcMain.handle('tasks:update', (_event, id: string, partial: Partial<Task>) => {
    return taskManager.updateTask(id, partial)
  })

  ipcMain.handle('tasks:delete', (_event, id: string) => {
    return taskManager.deleteTask(id)
  })

  ipcMain.handle('tasks:save-columns', (_event, columns: KanbanColumn[]) => {
    return taskManager.saveColumns(columns)
  })

  ipcMain.handle('tasks:set-block', (_event, input: TaskBlockInput) => {
    return taskManager.setBlock(input)
  })

  ipcMain.handle('tasks:delete-block', (_event, id: string) => {
    return taskManager.deleteBlock(id)
  })

  ipcMain.handle('tasks:batch-blocks', (_event, inputs: TaskBlockInput[]) => {
    return taskManager.batchBlocks(inputs)
  })

  ipcMain.handle('tasks:focus', (_event, opts: { blockId: string; action: 'start' | 'stop' }) => {
    return taskManager.setFocus(opts.blockId, opts.action)
  })
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/main/handlers/tasks.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the handlers into the app**

In `src/main/handlers/index.ts`, append:

```ts
export { registerTaskHandlers } from './tasks'
```

In `src/main/index.ts`, add `registerTaskHandlers,` to the import list from `./handlers` (after `registerKanbanHandlers,`), and add the call after `registerKanbanHandlers()`:

```ts
  registerTaskHandlers()
```

- [ ] **Step 6: Add the preload bridge**

In `src/preload/index.ts`, extend the type import to include the task types, then add these after the two `kanban*` methods:

```ts
  // Tasks
  tasksGetAll: (): Promise<TasksFile> =>
    ipcRenderer.invoke('tasks:get-all'),
  tasksCreate: (input: TaskCreate): Promise<Task> =>
    ipcRenderer.invoke('tasks:create', input),
  tasksUpdate: (id: string, partial: Partial<Task>): Promise<Task | null> =>
    ipcRenderer.invoke('tasks:update', id, partial),
  tasksDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('tasks:delete', id),
  tasksSaveColumns: (columns: KanbanColumn[]): Promise<KanbanColumn[]> =>
    ipcRenderer.invoke('tasks:save-columns', columns),
  tasksSetBlock: (input: TaskBlockInput): Promise<TaskBlock> =>
    ipcRenderer.invoke('tasks:set-block', input),
  tasksDeleteBlock: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('tasks:delete-block', id),
  tasksBatchBlocks: (inputs: TaskBlockInput[]): Promise<TaskBlock[]> =>
    ipcRenderer.invoke('tasks:batch-blocks', inputs),
  tasksFocus: (blockId: string, action: 'start' | 'stop'): Promise<TaskBlock | null> =>
    ipcRenderer.invoke('tasks:focus', { blockId, action }),
```

Add `Task, TaskBlock, TaskBlockInput, TaskCreate, TasksFile` to the existing type import from `../shared/ipc-types` at the top of the file. `window.api` types flow automatically — `global.d.ts` derives `Window['api']` from `ElectronAPI`, so no separate declaration is needed.

- [ ] **Step 7: Run the full suite, typecheck, and commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/main/handlers/tasks.ts src/main/handlers/tasks.test.ts src/main/handlers/index.ts src/main/index.ts src/preload/index.ts
git commit -m "feat(tasks): add tasks IPC handlers and preload bridge"
```

---

### Task 4: `useTasks` hook and the Tasks tab shell

Ends with a real, navigable tab showing an empty board. No capture or canvas yet.

**Files:**
- Create: `src/renderer/hooks/useTasks.ts`
- Create: `src/renderer/components/tasks/TasksView.tsx`
- Create: `src/renderer/components/tasks/TasksView.css`
- Create: `src/renderer/components/tasks/TasksView.test.tsx`
- Modify: `src/shared/types.ts:34` (`activeTab` union)
- Modify: `src/renderer/App.tsx:23` (`TabId`), tab bar at ~line 459, content chain at ~line 506, shortcut wiring at ~line 123
- Modify: `src/renderer/hooks/useKeyboardShortcuts.ts` (add optional `onTab6`)

**Interfaces:**
- Consumes: `window.api.tasksGetAll/tasksCreate/tasksUpdate/tasksDelete/tasksSaveColumns` from Task 3.
- Produces: `useTasks()` returning `{ tasks, blocks, columns, loading, createTask, updateTask, deleteTask, saveColumns, columnFor }`; `<TasksView />`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/tasks/TasksView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TasksView } from './TasksView'

const columns = [
  { id: 'c1', name: 'Backlog', order: 0 },
  { id: 'c2', name: 'Today', order: 1 },
]

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    tasksGetAll: vi.fn().mockResolvedValue({ version: 1, tasks: [], blocks: [], columns }),
    tasksCreate: vi.fn(),
    tasksUpdate: vi.fn(),
    tasksDelete: vi.fn(),
    tasksSaveColumns: vi.fn(),
  }
})

describe('TasksView', () => {
  it('renders a column per stored column, in order', async () => {
    render(<TasksView />)
    await waitFor(() => expect(screen.getByText('Backlog')).toBeTruthy())

    const headings = screen.getAllByTestId('task-column-name').map(el => el.textContent)
    expect(headings).toEqual(['Backlog', 'Today'])
  })

  it('shows an empty state when there are no tasks', async () => {
    render(<TasksView />)
    await waitFor(() => expect(screen.getByText(/no tasks yet/i)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/renderer/components/tasks/TasksView.test.tsx`
Expected: FAIL — cannot resolve `./TasksView`.

- [ ] **Step 3: Create `src/renderer/hooks/useTasks.ts`**

```ts
import { useState, useEffect, useCallback, useRef } from 'react'
import type { KanbanColumn, Task, TaskBlock, TaskCreate } from '../../shared/ipc-types'

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [blocks, setBlocks] = useState<TaskBlock[]>([])
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [loading, setLoading] = useState(true)

  const columnsRef = useRef(columns)
  columnsRef.current = columns

  useEffect(() => {
    let cancelled = false
    window.api.tasksGetAll().then(file => {
      if (cancelled) return
      setTasks(file.tasks)
      setBlocks(file.blocks)
      setColumns(file.columns)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const createTask = useCallback(async (input: TaskCreate) => {
    const task = await window.api.tasksCreate(input)
    setTasks(prev => [...prev, task])
    return task
  }, [])

  const updateTask = useCallback(async (id: string, partial: Partial<Task>) => {
    const updated = await window.api.tasksUpdate(id, partial)
    if (updated) setTasks(prev => prev.map(t => (t.id === id ? updated : t)))
    return updated
  }, [])

  const deleteTask = useCallback(async (id: string) => {
    const ok = await window.api.tasksDelete(id)
    if (ok) {
      setTasks(prev => prev.filter(t => t.id !== id))
      setBlocks(prev => prev.filter(b => b.taskId !== id))
    }
    return ok
  }, [])

  const saveColumns = useCallback(async (next: KanbanColumn[]) => {
    setColumns(next)
    const saved = await window.api.tasksSaveColumns(next)
    setColumns(saved)
  }, [])

  /** Resolves a possibly-dangling columnId to a real one, mirroring useKanban. */
  const columnFor = useCallback((columnId?: string) => {
    if (columnId && columnsRef.current.some(c => c.id === columnId)) return columnId
    return [...columnsRef.current].sort((a, b) => a.order - b.order)[0]?.id
  }, [])

  return {
    tasks, blocks, columns, loading,
    createTask, updateTask, deleteTask, saveColumns, columnFor,
    setBlocks,
  }
}
```

- [ ] **Step 4: Create `src/renderer/components/tasks/TasksView.tsx`**

```tsx
import { useMemo } from 'react'
import { useTasks } from '../../hooks/useTasks'
import './TasksView.css'

export function TasksView() {
  const { tasks, columns, loading, columnFor } = useTasks()

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns]
  )

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, typeof tasks>()
    for (const col of sortedColumns) map.set(col.id, [])
    for (const task of tasks) {
      const id = columnFor(task.columnId)
      if (!id) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id)!.push(task)
    }
    return map
  }, [tasks, sortedColumns, columnFor])

  if (loading) return <div className="tasks-view tasks-view-loading">Loading tasks…</div>

  return (
    <div className="tasks-view">
      <div className="tasks-board">
        {sortedColumns.map(column => (
          <div className="tasks-column" key={column.id}>
            <div className="tasks-column-header">
              <span className="tasks-column-name" data-testid="task-column-name">
                {column.name}
              </span>
              <span className="tasks-column-count">
                {tasksByColumn.get(column.id)?.length ?? 0}
              </span>
            </div>
          </div>
        ))}
      </div>
      {tasks.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">No tasks yet. Capture one to get started.</div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create `src/renderer/components/tasks/TasksView.css`**

```css
.tasks-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tasks-view-loading {
  padding: 24px;
  color: var(--text-secondary);
}

.tasks-board {
  display: flex;
  gap: 12px;
  padding: 12px;
  overflow-x: auto;
  align-items: flex-start;
}

.tasks-column {
  display: flex;
  flex-direction: column;
  min-width: 240px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.tasks-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.tasks-column-name {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.tasks-column-count {
  font-size: 11px;
  color: var(--text-muted);
}
```

Every custom property used here is already defined in the app's stylesheets: `--accent`, `--bg-primary`, `--bg-secondary`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`, `--red`, `--orange`. Do not introduce new tokens.

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npx vitest run src/renderer/components/tasks/TasksView.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 7: Register the tab**

In `src/shared/types.ts:34`, extend the union:

```ts
  activeTab?: 'launchpad' | 'folders' | 'claude' | 'agents' | 'db-access' | 'tasks'
```

In `src/renderer/App.tsx:23`:

```ts
type TabId = 'launchpad' | 'folders' | 'claude' | 'agents' | 'db-access' | 'tasks'
```

Add the import alongside the other view imports:

```ts
import { TasksView } from './components/tasks/TasksView'
```

Add the tab button after the DB Access tab (~line 459):

```tsx
        <div
          className={`tab ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          Tasks
        </div>
```

Add a branch to the content chain at ~line 506, before the `activeTab === 'agents'` branch:

```tsx
      ) : activeTab === 'tasks' ? (
        <ErrorBoundary name="Tasks">
          <TasksView />
        </ErrorBoundary>
```

The chain currently begins `activeTab === 'claude' || activeTab === 'db-access' ? null : activeTab === 'agents' ? (`. Insert the tasks branch immediately after the `null` guard so it reads `... ? null : activeTab === 'tasks' ? (…) : activeTab === 'agents' ? (…)`.

In `src/renderer/hooks/useKeyboardShortcuts.ts`, add to the shortcuts interface after `onTab4?`:

```ts
  onTab6?: () => void
```

Then add this block immediately after the existing `e.key === '4'` block (which ends just before the `// ? - show help` comment), matching its shape exactly:

```ts
      if ((e.metaKey || e.ctrlKey) && e.key === '6') {
        e.preventDefault()
        shortcuts.onTab6?.()
        return
      }
```

Then wire it in `App.tsx` next to `onTab4`:

```ts
    onTab6: () => setActiveTab('tasks'),
```

`Cmd+5` stays unbound on purpose — db-access, the fifth tab, has never had a shortcut, and adding one is unrelated to this feature. The number stays positional.

- [ ] **Step 8: Verify by hand**

Run: `npm run dev`
Expected: a Tasks tab appears after DB Access; clicking it shows four columns (Backlog, Today, Doing, Done) and the "No tasks yet" empty state. `Cmd+6` switches to it. Quit and relaunch — the tab is still selected, because `activeTab` persists through the existing `persist()` effect. Confirm `~/.devdock/tasks.json` now exists with four columns.

- [ ] **Step 9: Run the full suite, typecheck, and commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/renderer/hooks/useTasks.ts src/renderer/components/tasks src/shared/types.ts src/renderer/App.tsx src/renderer/hooks/useKeyboardShortcuts.ts
git commit -m "feat(tasks): add Tasks tab with board columns and empty state"
```

---

### Task 5: One-line capture parser

Pure module, no React, no IPC. The trickiest logic in the feature and the cheapest to test.

**Files:**
- Create: `src/shared/task-parse.ts`
- Create: `src/shared/task-parse.test.ts`

**Interfaces:**
- Produces: `parseTaskInput(text: string, now: number): ParsedTask` where

```ts
export interface ParsedTask {
  title: string
  priority: 1 | 2 | 3 | 4
  estimateMinutes?: number
  dueAt?: number
  scheduleAt?: number
  matched: Array<{ start: number; end: number; kind: 'priority' | 'estimate' | 'date' | 'time' }>
}
```

- [ ] **Step 1: Write the failing test**

Create `src/shared/task-parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseTaskInput } from './task-parse'

// Saturday 2026-08-22, 10:00 local.
const NOW = new Date(2026, 7, 22, 10, 0, 0).getTime()

describe('parseTaskInput', () => {
  it('defaults to priority 3 and keeps the whole text as the title', () => {
    const r = parseTaskInput('Write the quarterly review', NOW)
    expect(r.title).toBe('Write the quarterly review')
    expect(r.priority).toBe(3)
    expect(r.estimateMinutes).toBeUndefined()
    expect(r.dueAt).toBeUndefined()
    expect(r.scheduleAt).toBeUndefined()
  })

  it('extracts priority and strips it from the title', () => {
    const r = parseTaskInput('p1 Fix the build', NOW)
    expect(r.priority).toBe(1)
    expect(r.title).toBe('Fix the build')
  })

  it.each([
    ['45m', 45],
    ['90min', 90],
    ['1h', 60],
    ['1.5h', 90],
    ['2h', 120],
  ])('parses estimate %s as %i minutes', (token, minutes) => {
    const r = parseTaskInput(`Review docs ${token}`, NOW)
    expect(r.estimateMinutes).toBe(minutes)
    expect(r.title).toBe('Review docs')
  })

  it('a date without a time sets dueAt and leaves scheduleAt unset', () => {
    const r = parseTaskInput('Board deck tomorrow', NOW)
    expect(r.scheduleAt).toBeUndefined()
    expect(new Date(r.dueAt!).getDate()).toBe(23)
    expect(r.title).toBe('Board deck')
  })

  it('a date with a time sets scheduleAt', () => {
    const r = parseTaskInput('1:1 with Dana tomorrow 2pm', NOW)
    const scheduled = new Date(r.scheduleAt!)
    expect(scheduled.getDate()).toBe(23)
    expect(scheduled.getHours()).toBe(14)
    expect(scheduled.getMinutes()).toBe(0)
    expect(r.title).toBe('1:1 with Dana')
  })

  it('resolves a weekday name to the next such day', () => {
    const r = parseTaskInput('Retro mon', NOW)
    expect(new Date(r.dueAt!).getDate()).toBe(24)
  })

  it('handles 24-hour and half-hour times', () => {
    const r = parseTaskInput('Standup today 9:30am', NOW)
    const at = new Date(r.scheduleAt!)
    expect(at.getHours()).toBe(9)
    expect(at.getMinutes()).toBe(30)
  })

  it('only matches whole-word tokens', () => {
    const r = parseTaskInput('review 1h1 doc', NOW)
    expect(r.estimateMinutes).toBeUndefined()
    expect(r.title).toBe('review 1h1 doc')
  })

  it('ignores an out-of-range priority', () => {
    const r = parseTaskInput('p5 nonsense', NOW)
    expect(r.priority).toBe(3)
    expect(r.title).toBe('p5 nonsense')
  })

  it('uses the first match when a field appears twice', () => {
    const r = parseTaskInput('Thing 30m 45m', NOW)
    expect(r.estimateMinutes).toBe(30)
  })

  it('collapses whitespace left by stripped tokens', () => {
    const r = parseTaskInput('p2  Deploy   the   thing  1h', NOW)
    expect(r.title).toBe('Deploy the thing')
  })

  it('reports match offsets so the input can highlight them', () => {
    const r = parseTaskInput('p1 ship it', NOW)
    expect(r.matched).toEqual([{ start: 0, end: 2, kind: 'priority' }])
  })

  it('returns an empty title rather than throwing on token-only input', () => {
    const r = parseTaskInput('p1 1h', NOW)
    expect(r.title).toBe('')
    expect(r.priority).toBe(1)
    expect(r.estimateMinutes).toBe(60)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/shared/task-parse.test.ts`
Expected: FAIL — cannot resolve `./task-parse`.

- [ ] **Step 3: Create `src/shared/task-parse.ts`**

```ts
export interface ParsedTask {
  title: string
  priority: 1 | 2 | 3 | 4
  estimateMinutes?: number
  /** Set when a date was given without a time. */
  dueAt?: number
  /** Set when both a date and a time were given — the caller schedules a block. */
  scheduleAt?: number
  matched: Array<{ start: number; end: number; kind: MatchKind }>
}

type MatchKind = 'priority' | 'estimate' | 'date' | 'time'

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const PRIORITY_RE = /\bp([1-4])\b/i
const ESTIMATE_RE = /\b(\d+(?:\.\d+)?)(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i
const RELATIVE_DATE_RE = /\b(today|tomorrow)\b/i
const WEEKDAY_RE = /\b(?:(next)\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday)?\b/i

/**
 * Deterministic one-line task capture. No AI: a small, predictable grammar the
 * user can learn. Unmatched text becomes the title.
 *
 * Whole-word matches only, first match wins per field. A date plus a time
 * schedules; a date alone is a due date.
 */
export function parseTaskInput(text: string, now: number): ParsedTask {
  const matched: ParsedTask['matched'] = []
  /** Character ranges to remove from the title, collected as we match. */
  const cuts: Array<[number, number]> = []

  const take = (m: RegExpExecArray | null, kind: MatchKind): RegExpExecArray | null => {
    if (!m) return null
    const start = m.index
    const end = m.index + m[0].length
    matched.push({ start, end, kind })
    cuts.push([start, end])
    return m
  }

  const priorityMatch = take(PRIORITY_RE.exec(text), 'priority')
  const priority = priorityMatch
    ? (Number(priorityMatch[1]) as 1 | 2 | 3 | 4)
    : 3

  const estimateMatch = take(ESTIMATE_RE.exec(text), 'estimate')
  let estimateMinutes: number | undefined
  if (estimateMatch) {
    const value = Number(estimateMatch[1])
    const unit = estimateMatch[2].toLowerCase()
    const isHours = unit.startsWith('h')
    estimateMinutes = Math.round(isHours ? value * 60 : value)
  }

  const date = resolveDate(text, now, take)
  const time = resolveTime(text, take)

  let dueAt: number | undefined
  let scheduleAt: number | undefined
  if (date != null) {
    const base = new Date(date)
    if (time) {
      base.setHours(time.hours, time.minutes, 0, 0)
      scheduleAt = base.getTime()
    } else {
      base.setHours(23, 59, 0, 0)
      dueAt = base.getTime()
    }
  }

  return {
    title: stripRanges(text, cuts),
    priority,
    estimateMinutes,
    dueAt,
    scheduleAt,
    matched: matched.sort((a, b) => a.start - b.start),
  }
}

function resolveDate(
  text: string,
  now: number,
  take: (m: RegExpExecArray | null, kind: MatchKind) => RegExpExecArray | null
): number | null {
  const relative = take(RELATIVE_DATE_RE.exec(text), 'date')
  if (relative) {
    const d = new Date(now)
    if (relative[1].toLowerCase() === 'tomorrow') d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  const weekday = take(WEEKDAY_RE.exec(text), 'date')
  if (weekday) {
    const wantsNext = Boolean(weekday[1])
    const target = WEEKDAYS.indexOf(weekday[2].toLowerCase())
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    let delta = (target - d.getDay() + 7) % 7
    if (delta === 0) delta = 7
    if (wantsNext) delta += 7
    d.setDate(d.getDate() + delta)
    return d.getTime()
  }

  return null
}

function resolveTime(
  text: string,
  take: (m: RegExpExecArray | null, kind: MatchKind) => RegExpExecArray | null
): { hours: number; minutes: number } | null {
  const m = take(TIME_RE.exec(text), 'time')
  if (!m) return null

  // Either the am/pm alternative (groups 1-3) or the 24h one (groups 4-5).
  if (m[3]) {
    let hours = Number(m[1]) % 12
    if (m[3].toLowerCase() === 'pm') hours += 12
    return { hours, minutes: m[2] ? Number(m[2]) : 0 }
  }
  return { hours: Number(m[4]), minutes: Number(m[5]) }
}

/** Removes matched ranges and collapses the whitespace they leave behind. */
function stripRanges(text: string, cuts: Array<[number, number]>): string {
  if (cuts.length === 0) return text.trim()

  const ordered = [...cuts].sort((a, b) => b[0] - a[0])
  let out = text
  for (const [start, end] of ordered) {
    out = out.slice(0, start) + ' ' + out.slice(end)
  }
  return out.replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/shared/task-parse.test.ts`
Expected: PASS. If the `1:1 with Dana tomorrow 2pm` case fails because `TIME_RE` matches `1:1` before `2pm`, that is a genuine ambiguity in the grammar — fix it by requiring the 24-hour alternative to have a first group of 2 digits or a value above 12, and re-run. Do not weaken the test.

- [ ] **Step 5: Commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/shared/task-parse.ts src/shared/task-parse.test.ts
git commit -m "feat(tasks): add deterministic one-line capture parser"
```

---

### Task 6: Capture bar

**Files:**
- Create: `src/renderer/components/tasks/CaptureBar.tsx`
- Create: `src/renderer/components/tasks/CaptureBar.test.tsx`
- Modify: `src/renderer/components/tasks/TasksView.tsx` (render it, handle submit)
- Modify: `src/renderer/components/tasks/TasksView.css` (capture bar styles)

**Interfaces:**
- Consumes: `parseTaskInput` from `../../../shared/task-parse`; `useTasks().createTask`.
- Produces: `<CaptureBar onCapture={(parsed, rawText) => void} />`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/tasks/CaptureBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CaptureBar } from './CaptureBar'

describe('CaptureBar', () => {
  it('shows what it understood as you type', async () => {
    render(<CaptureBar onCapture={vi.fn()} />)
    await userEvent.type(screen.getByPlaceholderText(/add a task/i), 'p1 Ship it 90m')

    const hint = screen.getByTestId('capture-hint').textContent ?? ''
    expect(hint).toMatch(/P1/)
    expect(hint).toMatch(/90m/)
  })

  it('calls onCapture with the parsed task on Enter and clears the input', async () => {
    const onCapture = vi.fn()
    render(<CaptureBar onCapture={onCapture} />)

    const input = screen.getByPlaceholderText(/add a task/i) as HTMLInputElement
    await userEvent.type(input, 'p2 Fix the flake 45m{Enter}')

    expect(onCapture).toHaveBeenCalledTimes(1)
    const [parsed] = onCapture.mock.calls[0]
    expect(parsed.title).toBe('Fix the flake')
    expect(parsed.priority).toBe(2)
    expect(parsed.estimateMinutes).toBe(45)
    expect(input.value).toBe('')
  })

  it('ignores Enter on an empty or token-only input', async () => {
    const onCapture = vi.fn()
    render(<CaptureBar onCapture={onCapture} />)
    const input = screen.getByPlaceholderText(/add a task/i)

    await userEvent.type(input, '{Enter}')
    await userEvent.type(input, 'p1{Enter}')

    expect(onCapture).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/renderer/components/tasks/CaptureBar.test.tsx`
Expected: FAIL — cannot resolve `./CaptureBar`.

- [ ] **Step 3: Create `src/renderer/components/tasks/CaptureBar.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { parseTaskInput, type ParsedTask } from '../../../shared/task-parse'

interface Props {
  onCapture: (parsed: ParsedTask, rawText: string) => void
}

function describeParsed(parsed: ParsedTask): string {
  const parts: string[] = [`P${parsed.priority}`]
  if (parsed.estimateMinutes) parts.push(`${parsed.estimateMinutes}m`)
  if (parsed.scheduleAt) parts.push(new Date(parsed.scheduleAt).toLocaleString())
  else if (parsed.dueAt) parts.push(`due ${new Date(parsed.dueAt).toLocaleDateString()}`)
  return parts.join(' · ')
}

export function CaptureBar({ onCapture }: Props) {
  const [text, setText] = useState('')

  // Reparsed on every keystroke so the hint reflects exactly what would be saved.
  const parsed = useMemo(() => parseTaskInput(text, Date.now()), [text])

  const submit = () => {
    if (!parsed.title.trim()) return
    onCapture(parsed, text)
    setText('')
  }

  return (
    <div className="tasks-capture">
      <input
        className="tasks-capture-input"
        placeholder="Add a task —  p1 Review deck tomorrow 2pm 45m"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') setText('')
        }}
      />
      {text.trim() && (
        <span className="tasks-capture-hint" data-testid="capture-hint">
          {describeParsed(parsed)}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/renderer/components/tasks/CaptureBar.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire it into `TasksView`**

Add the import, render `<CaptureBar>` above `.tasks-board`, and handle capture by creating the task. Pull `createTask` out of `useTasks()`:

```tsx
      <CaptureBar
        onCapture={parsed => {
          createTask({
            title: parsed.title,
            priority: parsed.priority,
            estimateMinutes: parsed.estimateMinutes,
            dueAt: parsed.dueAt,
            status: 'open',
          })
        }}
      />
```

`scheduleAt` is deliberately ignored for now — creating a block needs the canvas from Task 8, which will extend this handler. Leave a comment saying so, so it does not read as a bug.

Add to `TasksView.css`:

```css
.tasks-capture {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.tasks-capture-input {
  flex: 1;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 5px;
}

.tasks-capture-input:focus {
  outline: none;
  border-color: var(--accent);
}

.tasks-capture-hint {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}
```

- [ ] **Step 6: Verify by hand, then commit**

Run: `npm run dev` — type `p1 Review the deck tomorrow 2pm 45m` and press Enter. A card-less count appears in the first column, and the task survives a restart.

```bash
npx vitest run && npx tsc --noEmit
git add src/renderer/components/tasks
git commit -m "feat(tasks): add capture bar with live parse hint"
```

---

### Task 7: Task cards and column drag-and-drop

**Files:**
- Create: `src/renderer/components/tasks/TaskCard.tsx`
- Create: `src/renderer/components/tasks/TaskCard.test.tsx`
- Modify: `src/renderer/components/tasks/TasksView.tsx` (render cards, handle drop)
- Modify: `src/renderer/components/tasks/TasksView.css`

**Interfaces:**
- Consumes: `Task` from `../../../shared/ipc-types`; `useTasks().updateTask`.
- Produces: `<TaskCard task onToggleDone onDelete onDragStart />`.

Uses native HTML5 drag-and-drop, matching how `KanbanColumn` already handles `onDrop`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/tasks/TaskCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskCard } from './TaskCard'
import type { Task } from '../../../shared/ipc-types'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Review the deck',
    priority: 2,
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('TaskCard', () => {
  it('renders the title and a priority class', () => {
    render(<TaskCard task={makeTask()} onToggleDone={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Review the deck')).toBeTruthy()
    expect(screen.getByTestId('task-card').className).toContain('task-card-p2')
  })

  it('shows the estimate when present', () => {
    render(<TaskCard task={makeTask({ estimateMinutes: 45 })} onToggleDone={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('45m')).toBeTruthy()
  })

  it('calls onToggleDone when the checkbox is clicked', async () => {
    const onToggleDone = vi.fn()
    render(<TaskCard task={makeTask()} onToggleDone={onToggleDone} onDelete={vi.fn()} />)

    await userEvent.click(screen.getByRole('checkbox'))
    expect(onToggleDone).toHaveBeenCalledWith('t1', true)
  })

  it('marks the card done when the task is done', () => {
    render(<TaskCard task={makeTask({ status: 'done' })} onToggleDone={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByTestId('task-card').className).toContain('task-card-done')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('is draggable and carries the task id', () => {
    render(<TaskCard task={makeTask()} onToggleDone={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByTestId('task-card').getAttribute('draggable')).toBe('true')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/renderer/components/tasks/TaskCard.test.tsx`
Expected: FAIL — cannot resolve `./TaskCard`.

- [ ] **Step 3: Create `src/renderer/components/tasks/TaskCard.tsx`**

```tsx
import React from 'react'
import type { Task } from '../../../shared/ipc-types'

interface Props {
  task: Task
  onToggleDone: (id: string, done: boolean) => void
  onDelete: (id: string) => void
}

/** Drag payload key, shared with TasksView's drop handler. */
export const TASK_DRAG_TYPE = 'application/x-devdock-task-id'

export function TaskCard({ task, onToggleDone, onDelete }: Props) {
  const done = task.status === 'done'

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={`task-card task-card-p${task.priority}${done ? ' task-card-done' : ''}`}
      data-testid="task-card"
      draggable
      onDragStart={handleDragStart}
    >
      <input
        type="checkbox"
        className="task-card-check"
        checked={done}
        onChange={e => onToggleDone(task.id, e.target.checked)}
        aria-label={`Mark "${task.title}" done`}
      />
      <div className="task-card-body">
        <div className="task-card-title">{task.title}</div>
        <div className="task-card-meta">
          {task.estimateMinutes != null && <span>{task.estimateMinutes}m</span>}
          {task.dueAt != null && <span>due {new Date(task.dueAt).toLocaleDateString()}</span>}
          {task.status === 'delegated' && <span className="task-card-delegated">delegated</span>}
        </div>
      </div>
      <button
        type="button"
        className="task-card-delete"
        onClick={() => onDelete(task.id)}
        aria-label={`Delete "${task.title}"`}
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/renderer/components/tasks/TaskCard.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Render cards and accept drops in `TasksView`**

Import `TaskCard` and `TASK_DRAG_TYPE`, pull `updateTask` and `deleteTask` from `useTasks()`, then inside each column render its cards and accept drops:

```tsx
          <div
            className="tasks-column"
            key={column.id}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={e => {
              e.preventDefault()
              const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE)
              if (taskId) updateTask(taskId, { columnId: column.id })
            }}
          >
```

and inside the column, after the header:

```tsx
            <div className="tasks-column-body">
              {(tasksByColumn.get(column.id) ?? []).map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onToggleDone={(id, done) => updateTask(id, { status: done ? 'done' : 'open' })}
                  onDelete={deleteTask}
                />
              ))}
            </div>
```

Add to `TasksView.css`:

```css
.tasks-column-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  min-height: 40px;
}

.task-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 8px 8px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: 4px;
  cursor: grab;
}

.task-card-p1 { border-left-color: var(--red); }
.task-card-p2 { border-left-color: var(--orange); }
.task-card-p3 { border-left-color: var(--border); }
.task-card-p4 { border-left-color: transparent; }

.task-card-done { opacity: 0.5; }
.task-card-done .task-card-title { text-decoration: line-through; }

.task-card-body { flex: 1; min-width: 0; }

.task-card-title {
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-word;
}

.task-card-meta {
  display: flex;
  gap: 8px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

.task-card-delete {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}

.task-card:hover .task-card-delete { color: var(--text-primary); }
```

Priority colours use `--red` and `--orange`; both are defined already, alongside `--red-dim` and `--green-dim` if a softer treatment reads better.

- [ ] **Step 6: Verify by hand, then commit**

Run: `npm run dev` — capture two tasks, drag one to another column, mark one done, delete one. Restart and confirm all three stuck.

```bash
npx vitest run && npx tsc --noEmit
git add src/renderer/components/tasks
git commit -m "feat(tasks): add task cards with priority, done toggle, and column drag"
```

---

### Task 8: Day canvas with drag-to-schedule and resize

**Files:**
- Create: `src/renderer/components/tasks/DayCanvas.tsx`
- Create: `src/renderer/components/tasks/DayCanvas.test.tsx`
- Create: `src/shared/task-time.ts` (slot maths, pure)
- Create: `src/shared/task-time.test.ts`
- Modify: `src/renderer/components/tasks/TasksView.tsx` (two-pane layout, block state)
- Modify: `src/renderer/components/tasks/TasksView.css`

**Interfaces:**
- Consumes: `TaskBlock`, `Task`; `window.api.tasksSetBlock`, `tasksDeleteBlock`.
- Produces: `snapToSlot(ms, slotMinutes)`, `offsetToTime(offsetPx, pxPerMinute, dayStart)`, `timeToOffset(ms, pxPerMinute, dayStart)` in `task-time.ts`; `<DayCanvas day tasks blocks onSchedule onMoveBlock onResizeBlock />`.

- [ ] **Step 1: Write the failing test for the pure slot maths**

Create `src/shared/task-time.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { snapToSlot, offsetToTime, timeToOffset, SLOT_MINUTES } from './task-time'

const DAY_START = new Date(2026, 7, 22, 0, 0, 0).getTime()
const PX_PER_MINUTE = 1

describe('task-time', () => {
  it('snaps down to the nearest slot boundary', () => {
    const t = new Date(2026, 7, 22, 9, 7, 0).getTime()
    expect(new Date(snapToSlot(t)).getMinutes()).toBe(0)
  })

  it('snaps to the correct slot inside the hour', () => {
    const t = new Date(2026, 7, 22, 9, 38, 0).getTime()
    expect(new Date(snapToSlot(t)).getMinutes()).toBe(30)
  })

  it('uses 15-minute slots by default', () => {
    expect(SLOT_MINUTES).toBe(15)
  })

  it('converts a pixel offset to a snapped time', () => {
    const t = offsetToTime(547, PX_PER_MINUTE, DAY_START)
    const d = new Date(t)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(0)
  })

  it('round-trips a snapped time through an offset', () => {
    const t = new Date(2026, 7, 22, 14, 30, 0).getTime()
    const offset = timeToOffset(t, PX_PER_MINUTE, DAY_START)
    expect(offsetToTime(offset, PX_PER_MINUTE, DAY_START)).toBe(t)
  })

  it('clamps a negative offset to the start of the day', () => {
    expect(offsetToTime(-50, PX_PER_MINUTE, DAY_START)).toBe(DAY_START)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/shared/task-time.test.ts`
Expected: FAIL — cannot resolve `./task-time`.

- [ ] **Step 3: Create `src/shared/task-time.ts`**

```ts
/** Canvas granularity. Blocks always start and end on a slot boundary. */
export const SLOT_MINUTES = 15

const MS_PER_MINUTE = 60_000

/** Rounds a timestamp down to the enclosing slot boundary. */
export function snapToSlot(ms: number, slotMinutes: number = SLOT_MINUTES): number {
  const slotMs = slotMinutes * MS_PER_MINUTE
  return Math.floor(ms / slotMs) * slotMs
}

/** Vertical pixel offset within the canvas → snapped timestamp. */
export function offsetToTime(offsetPx: number, pxPerMinute: number, dayStart: number): number {
  const minutes = Math.max(0, offsetPx) / pxPerMinute
  return snapToSlot(dayStart + minutes * MS_PER_MINUTE)
}

/** Timestamp → vertical pixel offset within the canvas. */
export function timeToOffset(ms: number, pxPerMinute: number, dayStart: number): number {
  return ((ms - dayStart) / MS_PER_MINUTE) * pxPerMinute
}
```

Note `snapToSlot` floors against the epoch, which is only slot-aligned because 15 minutes divides an hour and all supported timezone offsets are whole quarter-hours. That holds for every current zone; if it ever stops holding, snap relative to `dayStart` instead.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/shared/task-time.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing DayCanvas test**

Create `src/renderer/components/tasks/DayCanvas.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DayCanvas } from './DayCanvas'
import type { Task, TaskBlock } from '../../../shared/ipc-types'

const DAY = new Date(2026, 7, 22, 0, 0, 0).getTime()

const task: Task = {
  id: 't1', title: 'Deep work', priority: 1, status: 'open', createdAt: 0, updatedAt: 0,
}

function block(overrides: Partial<TaskBlock> = {}): TaskBlock {
  return {
    id: 'b1',
    taskId: 't1',
    startsAt: new Date(2026, 7, 22, 9, 0, 0).getTime(),
    endsAt: new Date(2026, 7, 22, 10, 0, 0).getTime(),
    focusSeconds: 0,
    ...overrides,
  }
}

const noop = vi.fn()

describe('DayCanvas', () => {
  it('renders one row label per hour', () => {
    render(
      <DayCanvas
        day={DAY} tasks={[]} blocks={[]} busy={[]}
        onSchedule={noop} onMoveBlock={noop} onResizeBlock={noop} onDeleteBlock={noop}
      />
    )
    expect(screen.getAllByTestId('canvas-hour')).toHaveLength(24)
  })

  it('renders a block with the task title', () => {
    render(
      <DayCanvas
        day={DAY} tasks={[task]} blocks={[block()]} busy={[]}
        onSchedule={noop} onMoveBlock={noop} onResizeBlock={noop} onDeleteBlock={noop}
      />
    )
    expect(screen.getByText('Deep work')).toBeTruthy()
  })

  it('positions and sizes the block from its times', () => {
    render(
      <DayCanvas
        day={DAY} tasks={[task]} blocks={[block()]} busy={[]}
        onSchedule={noop} onMoveBlock={noop} onResizeBlock={noop} onDeleteBlock={noop}
      />
    )
    const el = screen.getByTestId('canvas-block') as HTMLElement
    // 9h × 60min × 1px, 60min tall.
    expect(el.style.top).toBe('540px')
    expect(el.style.height).toBe('60px')
  })

  it('renders busy intervals behind blocks', () => {
    render(
      <DayCanvas
        day={DAY} tasks={[]} blocks={[]}
        busy={[{
          startsAt: new Date(2026, 7, 22, 11, 0, 0).getTime(),
          endsAt: new Date(2026, 7, 22, 12, 0, 0).getTime(),
          title: 'Standup',
          allDay: false,
        }]}
        onSchedule={noop} onMoveBlock={noop} onResizeBlock={noop} onDeleteBlock={noop}
      />
    )
    expect(screen.getByText('Standup')).toBeTruthy()
  })

  it('ignores all-day busy events', () => {
    render(
      <DayCanvas
        day={DAY} tasks={[]} blocks={[]}
        busy={[{ startsAt: DAY, endsAt: DAY + 86_400_000, title: 'OOO', allDay: true }]}
        onSchedule={noop} onMoveBlock={noop} onResizeBlock={noop} onDeleteBlock={noop}
      />
    )
    expect(screen.queryByText('OOO')).toBeNull()
  })
})
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx vitest run src/renderer/components/tasks/DayCanvas.test.tsx`
Expected: FAIL — cannot resolve `./DayCanvas`.

- [ ] **Step 7: Create `src/renderer/components/tasks/DayCanvas.tsx`**

```tsx
import React, { useRef } from 'react'
import type { Task, TaskBlock } from '../../../shared/ipc-types'
import { offsetToTime, timeToOffset, SLOT_MINUTES } from '../../../shared/task-time'
import { TASK_DRAG_TYPE } from './TaskCard'

export interface BusyInterval {
  startsAt: number
  endsAt: number
  title: string
  allDay: boolean
}

interface Props {
  /** Midnight of the rendered day, local time. */
  day: number
  tasks: Task[]
  blocks: TaskBlock[]
  busy: BusyInterval[]
  onSchedule: (taskId: string, startsAt: number, endsAt: number) => void
  onMoveBlock: (blockId: string, startsAt: number, endsAt: number) => void
  onResizeBlock: (blockId: string, startsAt: number, endsAt: number) => void
  onDeleteBlock: (blockId: string) => void
}

const PX_PER_MINUTE = 1
const DEFAULT_BLOCK_MINUTES = 30
const MS_PER_MINUTE = 60_000

export function DayCanvas({
  day, tasks, blocks, busy,
  onSchedule, onMoveBlock, onResizeBlock, onDeleteBlock,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const titleFor = (taskId: string) => tasks.find(t => t.id === taskId)?.title ?? 'Untitled'

  const offsetWithinGrid = (clientY: number): number => {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return clientY - rect.top + (gridRef.current?.scrollTop ?? 0)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE)
    if (!taskId) return

    const task = tasks.find(t => t.id === taskId)
    const minutes = task?.estimateMinutes ?? DEFAULT_BLOCK_MINUTES
    const startsAt = offsetToTime(offsetWithinGrid(e.clientY), PX_PER_MINUTE, day)
    onSchedule(taskId, startsAt, startsAt + minutes * MS_PER_MINUTE)
  }

  /** Shared pointer loop for moving a whole block and for resizing its bottom edge. */
  const startPointerDrag = (
    block: TaskBlock,
    mode: 'move' | 'resize',
    e: React.PointerEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const originY = e.clientY
    const originalStart = block.startsAt
    const originalEnd = block.endsAt
    let next = { startsAt: originalStart, endsAt: originalEnd }

    const onMove = (ev: PointerEvent) => {
      const deltaMinutes = Math.round((ev.clientY - originY) / PX_PER_MINUTE / SLOT_MINUTES) * SLOT_MINUTES
      const deltaMs = deltaMinutes * MS_PER_MINUTE

      if (mode === 'move') {
        next = { startsAt: originalStart + deltaMs, endsAt: originalEnd + deltaMs }
      } else {
        const minEnd = originalStart + SLOT_MINUTES * MS_PER_MINUTE
        next = { startsAt: originalStart, endsAt: Math.max(minEnd, originalEnd + deltaMs) }
      }
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (next.startsAt === originalStart && next.endsAt === originalEnd) return
      if (mode === 'move') onMoveBlock(block.id, next.startsAt, next.endsAt)
      else onResizeBlock(block.id, next.startsAt, next.endsAt)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="day-canvas">
      <div
        className="day-canvas-grid"
        ref={gridRef}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={handleDrop}
      >
        {Array.from({ length: 24 }, (_, hour) => (
          <div className="day-canvas-hour" data-testid="canvas-hour" key={hour}>
            <span className="day-canvas-hour-label">
              {String(hour).padStart(2, '0')}:00
            </span>
          </div>
        ))}

        {busy.filter(b => !b.allDay).map((interval, i) => (
          <div
            className="day-canvas-busy"
            key={`busy-${i}`}
            style={{
              top: timeToOffset(interval.startsAt, PX_PER_MINUTE, day),
              height: Math.max(
                SLOT_MINUTES * PX_PER_MINUTE,
                (interval.endsAt - interval.startsAt) / MS_PER_MINUTE * PX_PER_MINUTE
              ),
            }}
          >
            <span className="day-canvas-busy-title">{interval.title}</span>
          </div>
        ))}

        {blocks.map(block => (
          <div
            className="day-canvas-block"
            data-testid="canvas-block"
            key={block.id}
            style={{
              top: `${timeToOffset(block.startsAt, PX_PER_MINUTE, day)}px`,
              height: `${(block.endsAt - block.startsAt) / MS_PER_MINUTE * PX_PER_MINUTE}px`,
            }}
            onPointerDown={e => startPointerDrag(block, 'move', e)}
          >
            <span className="day-canvas-block-title">{titleFor(block.taskId)}</span>
            <button
              type="button"
              className="day-canvas-block-remove"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => onDeleteBlock(block.id)}
              aria-label="Unschedule"
            >
              ×
            </button>
            <div
              className="day-canvas-block-resize"
              onPointerDown={e => startPointerDrag(block, 'resize', e)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run it and confirm it passes**

Run: `npx vitest run src/renderer/components/tasks/DayCanvas.test.tsx`
Expected: PASS, 5 tests. jsdom reports zero-size rects, which is why the position test asserts on inline styles rather than measured geometry.

- [ ] **Step 9: Put the canvas beside the board in `TasksView`**

Wrap the board and canvas in a two-pane container, add block handlers using `window.api` directly plus the `setBlocks` returned by `useTasks`, and pass `busy={[]}` for now — the calendar arrives in plan 2.

The import this step needs in `TasksView.tsx`:

```tsx
import { DayCanvas } from './DayCanvas'
```

```tsx
  const todayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [])

  const schedule = async (taskId: string, startsAt: number, endsAt: number) => {
    const created = await window.api.tasksSetBlock({ taskId, startsAt, endsAt })
    setBlocks(prev => [...prev, created])
  }

  const moveBlock = async (id: string, startsAt: number, endsAt: number) => {
    const block = blocks.find(b => b.id === id)
    if (!block) return
    const updated = await window.api.tasksSetBlock({ id, taskId: block.taskId, startsAt, endsAt })
    setBlocks(prev => prev.map(b => (b.id === id ? updated : b)))
  }

  const removeBlock = async (id: string) => {
    if (await window.api.tasksDeleteBlock(id)) {
      setBlocks(prev => prev.filter(b => b.id !== id))
    }
  }
```

Render:

```tsx
      <div className="tasks-panes">
        <div className="tasks-board"> …existing columns… </div>
        <DayCanvas
          day={todayStart}
          tasks={tasks}
          blocks={blocks.filter(b => b.startsAt >= todayStart && b.startsAt < todayStart + 86_400_000)}
          busy={[]}
          onSchedule={schedule}
          onMoveBlock={moveBlock}
          onResizeBlock={moveBlock}
          onDeleteBlock={removeBlock}
        />
      </div>
```

`onResizeBlock` and `onMoveBlock` share an implementation because both are just "write new start and end" — the distinction only matters inside the canvas's pointer maths.

Also extend the `CaptureBar` handler from Task 6 to honour `scheduleAt`, replacing the comment left there:

```tsx
        onCapture={async parsed => {
          const task = await createTask({
            title: parsed.title,
            priority: parsed.priority,
            estimateMinutes: parsed.estimateMinutes,
            dueAt: parsed.dueAt,
            status: 'open',
          })
          if (parsed.scheduleAt) {
            const minutes = parsed.estimateMinutes ?? 30
            await schedule(task.id, parsed.scheduleAt, parsed.scheduleAt + minutes * 60_000)
          }
        }}
```

Add to `TasksView.css`:

```css
.tasks-panes {
  display: flex;
  flex: 1;
  min-height: 0;
}

.tasks-panes .tasks-board {
  flex: 1;
  min-width: 0;
}

.day-canvas {
  width: 320px;
  border-left: 1px solid var(--border);
  overflow-y: auto;
}

.day-canvas-grid {
  position: relative;
}

.day-canvas-hour {
  position: relative;
  height: 60px;
  border-bottom: 1px solid var(--border);
}

.day-canvas-hour-label {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 10px;
  color: var(--text-muted);
}

.day-canvas-busy,
.day-canvas-block {
  position: absolute;
  left: 48px;
  right: 8px;
  border-radius: 4px;
  overflow: hidden;
}

.day-canvas-busy {
  background: var(--bg-secondary);
  border: 1px dashed var(--border);
  font-size: 10px;
  color: var(--text-muted);
  padding: 2px 4px;
}

.day-canvas-block {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 3px 5px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  cursor: grab;
  user-select: none;
}

.day-canvas-block-title { flex: 1; min-width: 0; }

.day-canvas-block-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.day-canvas-block-resize {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 6px;
  cursor: ns-resize;
}
```

- [ ] **Step 10: Verify by hand, then commit**

Run: `npm run dev` — drag a card onto the canvas, drag the block to a new time, drag its bottom edge to resize, click × to unschedule. Capture `Deep work today 2pm 90m` and confirm a 90-minute block appears at 14:00. Restart; everything persists.

```bash
npx vitest run && npx tsc --noEmit
git add src/shared/task-time.ts src/shared/task-time.test.ts src/renderer/components/tasks
git commit -m "feat(tasks): add day canvas with drag-to-schedule, move, and resize"
```

---

### Task 9: Daily sweep

**Files:**
- Create: `src/shared/task-rollover.ts`
- Create: `src/shared/task-rollover.test.ts`
- Create: `src/renderer/components/tasks/SweepModal.tsx`
- Create: `src/renderer/components/tasks/SweepModal.test.tsx`
- Modify: `src/renderer/components/tasks/TasksView.tsx` (trigger + apply)
- Modify: `src/renderer/components/tasks/TasksView.css`

**Interfaces:**
- Consumes: `Task`, `TaskBlock`; `window.api.tasksSetBlock`, `tasksUpdate`.
- Produces: `sweepDay({ tasks, blocks, now }): SweepResult` with `StaleBlock[]`; `pushCount(blockId, blocks): number`; `<SweepModal items onApply onClose />`.

- [ ] **Step 1: Write the failing test**

Create `src/shared/task-rollover.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sweepDay, pushCount } from './task-rollover'
import type { Task, TaskBlock } from './ipc-types'

const NOW = new Date(2026, 7, 22, 18, 0, 0).getTime()
const h = (hour: number) => new Date(2026, 7, 22, hour, 0, 0).getTime()

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'Thing', priority: 3, status: 'open',
    createdAt: 0, updatedAt: 0, ...overrides,
  }
}

function block(overrides: Partial<TaskBlock> = {}): TaskBlock {
  return {
    id: 'b1', taskId: 't1', startsAt: h(9), endsAt: h(10), focusSeconds: 0, ...overrides,
  }
}

describe('sweepDay', () => {
  it('flags a finished block whose task is still open', () => {
    const result = sweepDay({ tasks: [task()], blocks: [block()], now: NOW })
    expect(result.stale.map(s => s.block.id)).toEqual(['b1'])
  })

  it('ignores blocks that have not ended yet', () => {
    const result = sweepDay({
      tasks: [task()],
      blocks: [block({ startsAt: h(19), endsAt: h(20) })],
      now: NOW,
    })
    expect(result.stale).toEqual([])
  })

  it('ignores blocks whose task is done', () => {
    const result = sweepDay({ tasks: [task({ status: 'done' })], blocks: [block()], now: NOW })
    expect(result.stale).toEqual([])
  })

  it('ignores blocks whose task already has a later block', () => {
    const result = sweepDay({
      tasks: [task()],
      blocks: [block(), block({ id: 'b2', startsAt: h(20), endsAt: h(21) })],
      now: NOW,
    })
    expect(result.stale).toEqual([])
  })

  it('suggests the same time tomorrow', () => {
    const result = sweepDay({ tasks: [task()], blocks: [block()], now: NOW })
    const suggested = new Date(result.stale[0].suggestedStartsAt)
    expect(suggested.getDate()).toBe(23)
    expect(suggested.getHours()).toBe(9)
  })

  it('preserves the original duration in the suggestion', () => {
    const result = sweepDay({
      tasks: [task()],
      blocks: [block({ startsAt: h(9), endsAt: h(11) })],
      now: NOW,
    })
    const { suggestedStartsAt, suggestedEndsAt } = result.stale[0]
    expect(suggestedEndsAt - suggestedStartsAt).toBe(2 * 3_600_000)
  })

  it('ignores delegated tasks — they are not on your calendar', () => {
    const result = sweepDay({ tasks: [task({ status: 'delegated' })], blocks: [block()], now: NOW })
    expect(result.stale).toEqual([])
  })
})

describe('pushCount', () => {
  it('is zero for a block that was never rolled over', () => {
    expect(pushCount('b1', [block()])).toBe(0)
  })

  it('counts the length of the rolledFrom chain', () => {
    const chain = [
      block({ id: 'b1' }),
      block({ id: 'b2', rolledFrom: 'b1' }),
      block({ id: 'b3', rolledFrom: 'b2' }),
    ]
    expect(pushCount('b3', chain)).toBe(2)
  })

  it('stops on a dangling rolledFrom instead of looping forever', () => {
    expect(pushCount('b2', [block({ id: 'b2', rolledFrom: 'gone' })])).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/shared/task-rollover.test.ts`
Expected: FAIL — cannot resolve `./task-rollover`.

- [ ] **Step 3: Create `src/shared/task-rollover.ts`**

```ts
import type { Task, TaskBlock } from './ipc-types'

export interface StaleBlock {
  block: TaskBlock
  task: Task
  suggestedStartsAt: number
  suggestedEndsAt: number
}

export interface SweepResult {
  stale: StaleBlock[]
}

const ONE_DAY_MS = 86_400_000

/**
 * Finds work that was scheduled, has passed, and never got finished or
 * rescheduled. Pure and read-only: it proposes, the user decides. A sweep that
 * rewrote the calendar on its own would make the calendar untrustworthy.
 */
export function sweepDay({
  tasks, blocks, now,
}: { tasks: Task[]; blocks: TaskBlock[]; now: number }): SweepResult {
  const taskById = new Map(tasks.map(t => [t.id, t]))
  const latestEndByTask = new Map<string, number>()
  for (const block of blocks) {
    const current = latestEndByTask.get(block.taskId) ?? -Infinity
    if (block.endsAt > current) latestEndByTask.set(block.taskId, block.endsAt)
  }

  const stale: StaleBlock[] = []

  for (const block of blocks) {
    if (block.endsAt >= now) continue

    const task = taskById.get(block.taskId)
    if (!task || task.status !== 'open') continue

    // Only the task's final block is stale; earlier ones were already followed up.
    if (latestEndByTask.get(block.taskId) !== block.endsAt) continue

    stale.push({
      block,
      task,
      suggestedStartsAt: block.startsAt + ONE_DAY_MS,
      suggestedEndsAt: block.endsAt + ONE_DAY_MS,
    })
  }

  return { stale }
}

/** How many times this block's work has already been pushed. */
export function pushCount(blockId: string, blocks: TaskBlock[]): number {
  const byId = new Map(blocks.map(b => [b.id, b]))
  let count = 0
  let current = byId.get(blockId)

  while (current?.rolledFrom) {
    count += 1
    const next = byId.get(current.rolledFrom)
    if (!next) break
    current = next
  }

  return count
}
```

Note the suggestion adds exactly 24 hours rather than reconstructing a local wall-clock time. Across a DST boundary that shifts the suggested hour by one; the user sees and confirms every suggestion, so it is visible rather than silent. Reconstructing local time is the fix if it ever matters.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/shared/task-rollover.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing SweepModal test**

Create `src/renderer/components/tasks/SweepModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SweepModal } from './SweepModal'
import type { StaleBlock } from '../../../shared/task-rollover'

const item: StaleBlock = {
  block: {
    id: 'b1', taskId: 't1',
    startsAt: new Date(2026, 7, 22, 9, 0).getTime(),
    endsAt: new Date(2026, 7, 22, 10, 0).getTime(),
    focusSeconds: 0,
  },
  task: {
    id: 't1', title: 'Unfinished thing', priority: 2, status: 'open',
    createdAt: 0, updatedAt: 0,
  },
  suggestedStartsAt: new Date(2026, 7, 23, 9, 0).getTime(),
  suggestedEndsAt: new Date(2026, 7, 23, 10, 0).getTime(),
}

describe('SweepModal', () => {
  it('lists each stale task', () => {
    render(<SweepModal items={[item]} pushCounts={{ b1: 0 }} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Unfinished thing')).toBeTruthy()
  })

  it('shows a push count when the work has been moved before', () => {
    render(<SweepModal items={[item]} pushCounts={{ b1: 3 }} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/pushed ×3/i)).toBeTruthy()
  })

  it('reports the chosen action per row', async () => {
    const onApply = vi.fn()
    render(<SweepModal items={[item]} pushCounts={{ b1: 0 }} onApply={onApply} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /roll over/i }))
    expect(onApply).toHaveBeenCalledWith(item, 'rollover')

    await userEvent.click(screen.getByRole('button', { name: /^done$/i }))
    expect(onApply).toHaveBeenCalledWith(item, 'done')

    await userEvent.click(screen.getByRole('button', { name: /drop/i }))
    expect(onApply).toHaveBeenCalledWith(item, 'drop')
  })

  it('does not act on its own', () => {
    const onApply = vi.fn()
    render(<SweepModal items={[item]} pushCounts={{ b1: 0 }} onApply={onApply} onClose={vi.fn()} />)
    expect(onApply).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx vitest run src/renderer/components/tasks/SweepModal.test.tsx`
Expected: FAIL — cannot resolve `./SweepModal`.

- [ ] **Step 7: Create `src/renderer/components/tasks/SweepModal.tsx`**

```tsx
import type { StaleBlock } from '../../../shared/task-rollover'

export type SweepAction = 'rollover' | 'done' | 'drop'

interface Props {
  items: StaleBlock[]
  pushCounts: Record<string, number>
  onApply: (item: StaleBlock, action: SweepAction) => void
  onClose: () => void
}

export function SweepModal({ items, pushCounts, onApply, onClose }: Props) {
  return (
    <div className="sweep-overlay" role="dialog" aria-label="Unfinished work">
      <div className="sweep-modal">
        <div className="sweep-modal-header">
          <span>Unfinished work</span>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sweep-modal-body">
          {items.length === 0 && <div className="sweep-empty">Nothing left hanging.</div>}

          {items.map(item => (
            <div className="sweep-row" key={item.block.id}>
              <div className="sweep-row-info">
                <div className="sweep-row-title">{item.task.title}</div>
                <div className="sweep-row-meta">
                  was {new Date(item.block.startsAt).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {pushCounts[item.block.id] > 0 && (
                    <span className="sweep-pushed"> · pushed ×{pushCounts[item.block.id]}</span>
                  )}
                </div>
              </div>
              <div className="sweep-row-actions">
                <button type="button" onClick={() => onApply(item, 'rollover')}>
                  Roll over
                </button>
                <button type="button" onClick={() => onApply(item, 'done')}>Done</button>
                <button type="button" onClick={() => onApply(item, 'drop')}>Drop</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run it and confirm it passes**

Run: `npx vitest run src/renderer/components/tasks/SweepModal.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 9: Wire the sweep into `TasksView`**

Add a "Review unfinished" button in the capture row that opens the modal, computed from `sweepDay`:

```tsx
  const [sweeping, setSweeping] = useState(false)

  const sweep = useMemo(
    () => sweepDay({ tasks, blocks, now: Date.now() }),
    [tasks, blocks]
  )

  const pushCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const item of sweep.stale) out[item.block.id] = pushCount(item.block.id, blocks)
    return out
  }, [sweep, blocks])

  const applySweep = async (item: StaleBlock, action: SweepAction) => {
    if (action === 'rollover') {
      const created = await window.api.tasksSetBlock({
        taskId: item.task.id,
        startsAt: item.suggestedStartsAt,
        endsAt: item.suggestedEndsAt,
        rolledFrom: item.block.id,
      })
      setBlocks(prev => [...prev, created])
    } else {
      await updateTask(item.task.id, { status: action === 'done' ? 'done' : 'dropped' })
    }
  }
```

Render the trigger only when there is something to review, so it is not permanent chrome:

```tsx
      {sweep.stale.length > 0 && (
        <button type="button" className="tasks-sweep-btn" onClick={() => setSweeping(true)}>
          Review {sweep.stale.length} unfinished
        </button>
      )}

      {sweeping && (
        <SweepModal
          items={sweep.stale}
          pushCounts={pushCounts}
          onApply={applySweep}
          onClose={() => setSweeping(false)}
        />
      )}
```

The imports this step needs in `TasksView.tsx`:

```tsx
import { sweepDay, pushCount, type StaleBlock } from '../../../shared/task-rollover'
import { SweepModal, type SweepAction } from './SweepModal'
```

Add to `TasksView.css`:

```css
.sweep-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  z-index: 100;
}

.sweep-modal {
  width: 480px;
  max-width: calc(100vw - 48px);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.sweep-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.sweep-modal-header button {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.sweep-modal-body {
  overflow-y: auto;
  padding: 4px 0;
}

.sweep-empty {
  padding: 20px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.sweep-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.sweep-row:last-child { border-bottom: none; }

.sweep-row-info { min-width: 0; }

.sweep-row-title {
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-word;
}

.sweep-row-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.sweep-pushed { color: var(--orange); }

.sweep-row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.sweep-row-actions button {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
}

.sweep-row-actions button:hover { background: var(--bg-tertiary); }

.tasks-sweep-btn {
  padding: 5px 10px;
  font-size: 11px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--orange);
  border-radius: 4px;
  cursor: pointer;
}
```

- [ ] **Step 10: Verify by hand, then commit**

Run: `npm run dev` — schedule a block in the past (drag one to an early hour), leave it open, and confirm the review button appears. Roll it over and check the new block lands tomorrow with a push count of 1 on the next sweep.

```bash
npx vitest run && npx tsc --noEmit
git add src/shared/task-rollover.ts src/shared/task-rollover.test.ts src/renderer/components/tasks
git commit -m "feat(tasks): add daily sweep with explicit rollover choices"
```

---

## Done When

- `npx vitest run` and `npx tsc --noEmit` are both clean.
- A Tasks tab exists, reachable by click and by `Cmd+6`, surviving restart.
- You can capture a task in one line, see it parsed live, drag it between columns, drag it onto the day canvas, move and resize the block, run the focus-free core loop, and review unfinished work at the end of a day.
- `~/.devdock/tasks.json` holds tasks, blocks and columns and is written atomically.
- Preset launching still works, now covered by `session-launcher.test.ts`.
- Nothing in `KanbanPanel.tsx`, `KanbanColumn.tsx`, `KanbanCard.tsx`, `kanban-manager.ts` or `useKanban.ts` has changed.

## Deferred to Plan 2

Auto-schedule packer (`task-scheduling.ts`), focus mode and the focus overlay (the
`tasks:focus` channel and `TaskManager.setFocus` already exist and are tested — only the UI
is missing), the macOS Calendar reader with its `Info.plist` keys and busy overlay,
`tasks:delegate` reusing `launchClaudeSession`, and the optional `tasks:decompose` AI path.
