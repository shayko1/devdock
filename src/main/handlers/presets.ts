import { ipcMain } from 'electron'
import { presetManager, SessionPreset, SessionPresetCreate } from '../preset-manager'
import { launchClaudeSession } from '../session-launcher'

/** IPC handlers for session preset CRUD and launch. */
export function registerPresetHandlers() {
  ipcMain.handle('preset-list', () => {
    return presetManager.getAll()
  })

  ipcMain.handle('preset-create', (_event, input: SessionPresetCreate) => {
    return presetManager.savePreset(input)
  })

  ipcMain.handle('preset-update', (_event, id: string, partial: Partial<SessionPreset>) => {
    return presetManager.updatePreset(id, partial)
  })

  ipcMain.handle('preset-delete', (_event, id: string) => {
    return presetManager.deletePreset(id)
  })

  ipcMain.handle('preset-get-pinned', () => {
    return presetManager.getPinned()
  })

  ipcMain.handle('preset-get-recent', (_event, limit?: number) => {
    return presetManager.getRecent(limit)
  })

  ipcMain.handle('preset-launch', (_event, opts: {
    presetId: string
    sessionId: string
  }) => {
    const preset = presetManager.getPreset(opts.presetId)
    if (!preset) {
      return { success: false, error: 'Preset not found' }
    }

    const result = launchClaudeSession({
      sessionId: opts.sessionId,
      projectPath: preset.projectPath,
      projectName: preset.projectName,
      useWorktree: preset.useWorktree,
      dangerousMode: preset.dangerousMode,
      model: preset.model,
      initialCommands: preset.initialCommands,
    })

    if (result.success) {
      presetManager.recordUsage(opts.presetId)
    }

    return { ...result, preset }
  })
}
