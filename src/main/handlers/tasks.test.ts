/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted so the vi.mock factories below can close over these — mock factories
// are lifted above module-level declarations.
const { handlers, taskManager } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: any[]) => unknown>(),
  taskManager: {
    getAll: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    saveColumns: vi.fn(),
    setBlock: vi.fn(),
    deleteBlock: vi.fn(),
    batchBlocks: vi.fn(),
    setFocus: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: any[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))
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

  it('tasks:delete forwards the id', () => {
    invoke('tasks:delete', 't1')
    expect(taskManager.deleteTask).toHaveBeenCalledWith('t1')
  })

  it('tasks:set-block forwards the block input', () => {
    invoke('tasks:set-block', { taskId: 't1', startsAt: 1, endsAt: 2 })
    expect(taskManager.setBlock).toHaveBeenCalledWith({ taskId: 't1', startsAt: 1, endsAt: 2 })
  })

  it('tasks:batch-blocks forwards the array', () => {
    invoke('tasks:batch-blocks', [{ taskId: 't1', startsAt: 1, endsAt: 2 }])
    expect(taskManager.batchBlocks).toHaveBeenCalledWith([{ taskId: 't1', startsAt: 1, endsAt: 2 }])
  })

  it('tasks:focus forwards block id and action', () => {
    invoke('tasks:focus', { blockId: 'b1', action: 'start' })
    expect(taskManager.setFocus).toHaveBeenCalledWith('b1', 'start')
  })
})
