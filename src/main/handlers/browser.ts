import { ipcMain } from 'electron'
import { openBrowserForSession, closeBrowserForSession, isBrowserOpenForSession, getBridgePort } from '../browser-bridge'

export function registerBrowserHandlers() {
  ipcMain.handle('open-browser', (_event, sessionId: string, url?: string) => {
    openBrowserForSession(sessionId, url)
    return { opened: true }
  })

  ipcMain.handle('close-browser', (_event, sessionId: string) => {
    closeBrowserForSession(sessionId)
    return { closed: true }
  })

  ipcMain.handle('is-browser-open', (_event, sessionId: string) => {
    return isBrowserOpenForSession(sessionId)
  })

  ipcMain.handle('get-browser-bridge-port', () => {
    return getBridgePort()
  })
}
