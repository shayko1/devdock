import { ipcMain } from 'electron'
import { promptEnhancer } from '../prompt-enhancer'
import { EnhancerConfig } from '../../shared/enhancer-types'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

function getEnhancerConfigPath() {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'enhancer-config.json')
}

export function loadEnhancerConfig() {
  try {
    const configPath = getEnhancerConfigPath()
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8')
      const cfg = JSON.parse(raw) as EnhancerConfig
      promptEnhancer.setConfig(cfg)
      return
    }
    // Migrate from old coach-config.json if it exists
    const oldPath = join(app.getPath('userData'), 'coach-config.json')
    if (existsSync(oldPath)) {
      const raw = readFileSync(oldPath, 'utf-8')
      const old = JSON.parse(raw)
      const cfg: EnhancerConfig = {
        enabled: old.enabled ?? false,
        apiKey: old.apiKey ?? '',
        model: old.model ?? 'gpt-4.1-nano',
        baseUrl: old.baseUrl ?? '',
      }
      promptEnhancer.setConfig(cfg)
      // Save as new config
      writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8')
    }
  } catch { /* use defaults */ }
}

function saveEnhancerConfig(config: EnhancerConfig) {
  try {
    const configPath = getEnhancerConfigPath()
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch { /* ignore */ }
}

export function registerEnhancerHandlers() {
  ipcMain.handle('enhancer-get-config', () => promptEnhancer.getConfig())

  ipcMain.handle('enhancer-set-config', (_event, config: EnhancerConfig) => {
    promptEnhancer.setConfig(config)
    saveEnhancerConfig(config)
  })

  ipcMain.handle('enhancer-enhance-prompt', async (_event, sessionId: string, prompt: string) => {
    return promptEnhancer.enhance(sessionId, prompt)
  })

  ipcMain.handle('enhancer-get-cost', (_event, sessionId: string) => {
    return promptEnhancer.getCost(sessionId)
  })

  ipcMain.handle('enhancer-get-total-cost', () => promptEnhancer.getTotalCost())
}
