import { execSync } from 'child_process'

export interface RtkStatus {
  installed: boolean
  version: string | null
  hookActive: boolean
  path: string | null
}

export interface RtkGainStats {
  totalSaved: number
  totalOriginal: number
  totalCompressed: number
  savingsPercent: number
  commandCount: number
  raw: string
}

function exec(cmd: string, timeout = 5000): string | null {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, PATH: getExpandedPath() }
    }).trim()
  } catch {
    return null
  }
}

function getExpandedPath(): string {
  try {
    return execSync('/bin/zsh -ilc "echo $PATH"', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return process.env.PATH || ''
  }
}

export function detectRtk(): RtkStatus {
  const path = exec('which rtk')
  if (!path) {
    return { installed: false, version: null, hookActive: false, path: null }
  }

  const versionOut = exec('rtk --version')
  const version = versionOut?.replace(/^rtk\s+/, '') ?? null

  const hookCheck = exec('rtk init --show 2>&1')
  const hookActive = hookCheck != null && !hookCheck.includes('not installed') && !hookCheck.includes('No hook')

  return { installed: true, version, hookActive, path }
}

export function installRtkHook(): { success: boolean; output: string } {
  try {
    const output = execSync('rtk init -g --auto-patch 2>&1', {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: getExpandedPath() }
    }).trim()
    return { success: true, output }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, output: message }
  }
}

export function uninstallRtkHook(): { success: boolean; output: string } {
  try {
    const output = execSync('rtk init -g --uninstall 2>&1', {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: getExpandedPath() }
    }).trim()
    return { success: true, output }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, output: message }
  }
}

export function getRtkGainStats(): RtkGainStats | null {
  const raw = exec('rtk gain 2>&1', 10000)
  if (!raw) return null

  let totalSaved = 0
  let totalOriginal = 0
  let totalCompressed = 0
  let savingsPercent = 0
  let commandCount = 0

  const savedMatch = raw.match(/saved[:\s]+([0-9,]+)\s*tokens/i)
  if (savedMatch) totalSaved = parseInt(savedMatch[1].replace(/,/g, ''), 10)

  const originalMatch = raw.match(/original[:\s]+([0-9,]+)/i)
  if (originalMatch) totalOriginal = parseInt(originalMatch[1].replace(/,/g, ''), 10)

  const compressedMatch = raw.match(/compressed[:\s]+([0-9,]+)/i)
  if (compressedMatch) totalCompressed = parseInt(compressedMatch[1].replace(/,/g, ''), 10)

  const percentMatch = raw.match(/(-?\d+(?:\.\d+)?)%/)
  if (percentMatch) savingsPercent = parseFloat(percentMatch[1])

  const cmdMatch = raw.match(/(\d+)\s*commands?/i)
  if (cmdMatch) commandCount = parseInt(cmdMatch[1], 10)

  return { totalSaved, totalOriginal, totalCompressed, savingsPercent, commandCount, raw }
}
