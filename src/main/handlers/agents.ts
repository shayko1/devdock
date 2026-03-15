import { ipcMain } from 'electron'
import { scanAgents, getAgentLogs, triggerAgent } from '../agent-scanner'

export function registerAgentHandlers() {
  ipcMain.handle('scan-agents', () => scanAgents())

  ipcMain.handle('get-agent-logs', (_event, agentId: string, logType: 'history' | 'stdout') => {
    return getAgentLogs(agentId, logType)
  })

  ipcMain.handle('trigger-agent', (_event, agentId: string) => {
    return triggerAgent(agentId)
  })
}
