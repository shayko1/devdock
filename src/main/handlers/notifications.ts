import { ipcMain } from 'electron'
import { notificationManager } from '../notification-manager'

export function registerNotificationHandlers() {
  ipcMain.handle('notification-set-enabled', (_event, enabled: boolean) => {
    notificationManager.setEnabled(enabled)
  })

  ipcMain.handle('notification-set-quiet-mode', (_event, enabled: boolean) => {
    notificationManager.setQuietMode(enabled)
  })

  ipcMain.handle('notification-get-settings', () => {
    return notificationManager.getSettings()
  })
}
