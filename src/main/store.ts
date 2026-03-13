import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { AppState } from '../shared/types'

const getStorePath = () => {
  const userDataPath = app.getPath('userData')
  mkdirSync(userDataPath, { recursive: true })
  return join(userDataPath, 'state.json')
}

const defaultState: AppState = {
  projects: [],
  tags: [],
  scanPath: join(process.env.HOME || '~', 'Workspace')
}

export function loadState(): AppState {
  const storePath = getStorePath()
  if (!existsSync(storePath)) {
    return { ...defaultState }
  }

  try {
    const raw = readFileSync(storePath, 'utf-8')
    return JSON.parse(raw) as AppState
  } catch {
    return { ...defaultState }
  }
}

export function saveState(state: AppState): void {
  const storePath = getStorePath()
  writeFileSync(storePath, JSON.stringify(state, null, 2), 'utf-8')
}
