import { ipcMain } from 'electron'
import { loadState, saveState } from '../store'
import { scanWorkspace } from '../scanner'
import { AppState, Project } from '../../shared/types'

export function registerStateHandlers() {
  ipcMain.handle('get-state', () => loadState())

  ipcMain.handle('save-state', (_event, state: AppState) => {
    saveState(state)
    return true
  })

  ipcMain.handle('scan-workspace', (_event, scanPath: string, maxDepth?: number) => {
    return scanWorkspace(scanPath, maxDepth)
  })
}
