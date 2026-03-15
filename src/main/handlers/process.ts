import { ipcMain, shell } from 'electron'
import { processManager, detectSystemPorts, killSystemProcess } from '../process-manager'
import { Project } from '../../shared/types'

export function registerProcessHandlers() {
  ipcMain.handle('start-project', async (_event, project: Project) => {
    return processManager.startProject(project)
  })

  ipcMain.handle('stop-project', (_event, projectId: string) => {
    return processManager.stopProject(projectId)
  })

  ipcMain.handle('get-process-statuses', () => {
    return processManager.getAllStatuses()
  })

  ipcMain.handle('get-logs', (_event, projectId: string) => {
    return processManager.getLogs(projectId)
  })

  ipcMain.handle('open-in-browser', (_event, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('detect-system-ports', (_event, ports: number[]) => {
    const portMap = detectSystemPorts(ports)
    const result: Record<number, { port: number; pid: number; command: string }> = {}
    for (const [port, info] of portMap) {
      result[port] = info
    }
    return result
  })

  ipcMain.handle('kill-system-process', (_event, pid: number) => {
    return killSystemProcess(pid)
  })
}
