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
