import { ipcMain } from 'electron'
import { kanbanManager } from '../kanban-manager'
import { KanbanColumn } from '../../shared/ipc-types'

export function registerKanbanHandlers() {
  ipcMain.handle('kanban:get-columns', () => {
    return kanbanManager.getColumns()
  })

  ipcMain.handle('kanban:save-columns', (_event, columns: KanbanColumn[]) => {
    return kanbanManager.saveColumns(columns)
  })

  ipcMain.handle('kanban:move-session', (_event, sessionId: string, columnId: string) => {
    return kanbanManager.moveSession(sessionId, columnId)
  })
}
