import { ipcMain } from 'electron'
import { pipelineManager } from '../pipeline-manager'

export function registerPipelineHandlers() {
  ipcMain.handle('pipeline-start', (_event, folderName: string, folderPath: string, taskDescription: string) => {
    return pipelineManager.startPipeline(folderName, folderPath, taskDescription)
  })

  ipcMain.handle('pipeline-cancel', (_event, pipelineId: string) => {
    pipelineManager.cancelPipeline(pipelineId)
  })

  ipcMain.handle('pipeline-get-runs', () => {
    return pipelineManager.getAllRuns()
  })

  ipcMain.handle('pipeline-get-config', (_event, folderPath: string) => {
    return pipelineManager.getConfig(folderPath)
  })

  ipcMain.handle('pipeline-set-config', (_event, folderPath: string, config: any) => {
    pipelineManager.setConfig(folderPath, config)
  })
}
