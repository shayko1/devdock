import { ipcMain } from 'electron'
import { ScrollbackReader } from '../scrollback-manager'

export function registerScrollbackHandlers() {
  ipcMain.handle('scrollback-list-recoverable', () => {
    return ScrollbackReader.listRecoverable()
  })

  ipcMain.handle('scrollback-restore', (_event, sessionId: string) => {
    try {
      const { data, meta } = ScrollbackReader.readScrollback(sessionId)
      return { data: data.toString('base64'), meta }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Scrollback] Restore failed for ${sessionId}:`, message)
      return null
    }
  })

  ipcMain.handle('scrollback-dismiss', (_event, sessionId: string) => {
    ScrollbackReader.cleanup(sessionId)
  })

  ipcMain.handle('scrollback-cleanup-old', () => {
    ScrollbackReader.cleanupOld(7)
  })
}
