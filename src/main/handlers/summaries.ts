import { ipcMain, shell } from 'electron'
import { summaryManager, SaveSummaryOptions } from '../summary-manager'

export function registerSummaryHandlers() {
  ipcMain.handle('summary-save', (_event, opts: SaveSummaryOptions) => {
    return summaryManager.saveSummary(opts)
  })

  ipcMain.handle('summary-save-from-file', (_event, filePath: string, title: string, projectName: string, projectPath: string, claudeSessionId: string | null, sessionPtyId: string | null) => {
    return summaryManager.saveFromFile(filePath, title, projectName, projectPath, claudeSessionId, sessionPtyId)
  })

  ipcMain.handle('summary-list', (_event, projectName?: string) => {
    return summaryManager.list(projectName)
  })

  ipcMain.handle('summary-get', (_event, id: string) => {
    return summaryManager.get(id)
  })

  ipcMain.handle('summary-delete', (_event, id: string) => {
    return summaryManager.delete(id)
  })

  ipcMain.handle('summary-open-in-browser', (_event, id: string) => {
    const htmlPath = summaryManager.getHtmlPath(id)
    if (htmlPath) {
      shell.openExternal(`file://${htmlPath}`)
      return true
    }
    return false
  })
}
