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

    const { id: _id, createdAt: _createdAt, ...safe } = partial
    const next: Task = { ...this.file.tasks[index], ...safe, updatedAt: Date.now() }

    if (safe.status === 'done') {
      next.completedAt = next.completedAt ?? Date.now()
    } else if (safe.status) {
      next.completedAt = undefined
    }

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
    if (!this.file.blocks.some(b => b.id === blockId)) return null

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
