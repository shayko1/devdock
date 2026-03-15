import { ipcMain } from 'electron'
import { coachManager } from '../coach-manager'
import { CoachConfig } from '../../shared/coach-types'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

function getCoachConfigPath() {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'coach-config.json')
}

export function loadCoachConfig() {
  try {
    const configPath = getCoachConfigPath()
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8')
      const cfg = JSON.parse(raw) as CoachConfig
      coachManager.setConfig(cfg)
    }
  } catch { /* use defaults */ }
}

function saveCoachConfig(config: CoachConfig) {
  try {
    const configPath = getCoachConfigPath()
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch { /* ignore */ }
}

export function registerCoachHandlers() {
  ipcMain.handle('coach-get-config', () => coachManager.getConfig())

  ipcMain.handle('coach-set-config', (_event, config: CoachConfig) => {
    coachManager.setConfig(config)
    saveCoachConfig(config)
  })

  ipcMain.handle('coach-get-suggestions', (_event, sessionId: string) => {
    return coachManager.getSuggestions(sessionId)
  })

  ipcMain.handle('coach-get-cost', (_event, sessionId: string) => {
    return coachManager.getCost(sessionId)
  })

  ipcMain.handle('coach-get-total-cost', () => coachManager.getTotalCost())

  ipcMain.handle('coach-dismiss', (_event, sessionId: string, suggestionId: string) => {
    coachManager.dismissSuggestion(sessionId, suggestionId)
  })
}
