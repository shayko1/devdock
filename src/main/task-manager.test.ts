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

// Hoisted so the vi.mock factory below can close over it — mock factories are
// lifted above module-level declarations.
const counter = vi.hoisted(() => ({ value: 0 }))
vi.mock('crypto', () => ({ randomUUID: () => `id-${counter.value++}` }))

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
    counter.value = 0
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

  it('marks completedAt when a task becomes done and clears it when reopened', () => {
    const m = newManager()
    const task = m.createTask(taskInput)

    expect(m.updateTask(task.id, { status: 'done' })!.completedAt).toBeTypeOf('number')
    expect(m.updateTask(task.id, { status: 'open' })!.completedAt).toBeUndefined()
  })

  it('batchBlocks persists a whole packer run in one write', () => {
    const m = newManager()
    const task = m.createTask(taskInput)
    vi.mocked(fs.writeFileSync).mockClear()

    const created = m.batchBlocks([
      { taskId: task.id, startsAt: 1000, endsAt: 2000 },
      { taskId: task.id, startsAt: 3000, endsAt: 4000 },
    ])

    expect(created).toHaveLength(2)
    expect(vi.mocked(fs.writeFileSync).mock.calls).toHaveLength(1)
  })
})
