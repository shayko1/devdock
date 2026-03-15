import { ipcMain } from 'electron'
import { detectRtk, installRtkHook, uninstallRtkHook, getRtkGainStats, writeRtkWrapper, setSessionRtkDisabled, isSessionRtkDisabled, cleanupSessionRtkFlag } from '../rtk-manager'

export function registerRtkHandlers() {
  ipcMain.handle('rtk-detect', () => detectRtk())

  ipcMain.handle('rtk-enable', () => {
    const result = installRtkHook()
    if (result.success) writeRtkWrapper()
    return result
  })

  ipcMain.handle('rtk-disable', () => uninstallRtkHook())

  ipcMain.handle('rtk-gain', () => getRtkGainStats())

  ipcMain.handle('rtk-session-toggle', (_event, sessionId: string, disabled: boolean) => {
    setSessionRtkDisabled(sessionId, disabled)
    return { disabled }
  })

  ipcMain.handle('rtk-session-status', (_event, sessionId: string) => {
    return { disabled: isSessionRtkDisabled(sessionId) }
  })

  ipcMain.handle('rtk-session-cleanup', (_event, sessionId: string) => {
    cleanupSessionRtkFlag(sessionId)
  })
}
