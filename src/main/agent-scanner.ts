/**
 * Scans for Claude agents by inspecting LaunchAgent plists and script directories.
 * Extracts actual script paths from plist ProgramArguments for reliable detection.
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, dirname, basename } from 'path'
import { AgentInfo, AgentSchedule } from '../shared/agent-types'

const SCRIPTS_DIR = join(homedir(), '.claude', 'scripts')
const LOGS_DIR = join(homedir(), '.claude', 'logs')
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents')

interface PlistData {
  Label?: string
  ProgramArguments?: string[]
  EnvironmentVariables?: Record<string, string>
  StartInterval?: number
  StartCalendarInterval?: { Hour?: number; Minute?: number; Weekday?: number }
  KeepAlive?: boolean
  Comment?: string
  WorkingDirectory?: string
}

function parsePlist(path: string): PlistData | null {
  try {
    const json = execSync(`plutil -convert json -o - "${path}"`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return JSON.parse(json)
  } catch {
    return null
  }
}

function getLaunchctlInfo(): Map<string, { running: boolean; pid: number | null; exitCode: number | null }> {
  const info = new Map<string, { running: boolean; pid: number | null; exitCode: number | null }>()
  try {
    const result = execSync('launchctl list', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    for (const line of result.split('\n')) {
      if (!line.includes('com.claude.')) continue
      const parts = line.split('\t')
      if (parts.length !== 3) continue
      const [pidStr, exitCodeStr, label] = parts
      info.set(label, {
        running: pidStr !== '-',
        pid: pidStr !== '-' ? parseInt(pidStr, 10) : null,
        exitCode: exitCodeStr !== '-' ? parseInt(exitCodeStr, 10) : null
      })
    }
  } catch { /* ignore */ }
  return info
}

function parseSchedule(plist: PlistData): AgentSchedule {
  if (plist.StartInterval) {
    return { type: 'interval', seconds: plist.StartInterval }
  }
  if (plist.StartCalendarInterval) {
    const cal = plist.StartCalendarInterval
    return {
      type: 'calendar',
      hour: cal.Hour ?? 0,
      minute: cal.Minute ?? 0,
      weekday: cal.Weekday
    }
  }
  if (plist.KeepAlive) {
    return { type: 'always_on' }
  }
  return { type: 'unknown' }
}

/**
 * Extract the script directory from ProgramArguments.
 * e.g. [".../billing-daily-digest/.venv/bin/python3", ".../billing-daily-digest/main.py"]
 * → "$HOME/.claude/scripts/example-agent"
 */
function extractScriptDir(args: string[]): string | null {
  if (!args || args.length < 2) return null
  // The last arg is typically the script file — get its directory
  const scriptFile = args[args.length - 1]
  if (!scriptFile.includes('.claude/scripts')) return null
  const dir = dirname(scriptFile)
  // If the script is at the top level (e.g. polling_hub.py), skip it
  if (dir === SCRIPTS_DIR) return null
  return dir
}

/**
 * Derive a human-friendly agent ID from the script directory name.
 * e.g. "billing-daily-digest" → "daily-digest"
 *      "otto" → "otto"
 *      "slack-reviewer" → "slack-reviewer"
 */
function deriveAgentId(dirName: string): string {
  return dirName.replace(/^billing-/, '')
}

function inferAgentName(dirName: string): string {
  return deriveAgentId(dirName)
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function readLastHistoryLine(logDir: string): { lastRun: string | null; lastResult: string | null } {
  const historyPath = join(logDir, 'history.log')
  if (!existsSync(historyPath)) return { lastRun: null, lastResult: null }
  try {
    const content = readFileSync(historyPath, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim())
    if (lines.length === 0) return { lastRun: null, lastResult: null }
    const last = lines[lines.length - 1]
    const tsStr = last.substring(0, 19).trim()
    const rest = last.substring(19).trim()
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(tsStr)) {
      return { lastRun: tsStr, lastResult: rest }
    }
    return { lastRun: null, lastResult: last }
  } catch {
    return { lastRun: null, lastResult: null }
  }
}

function readStateSummary(agentId: string, dirName: string): Record<string, unknown> {
  // Try multiple state file patterns
  const patterns = [
    join(SCRIPTS_DIR, `.${agentId}-state.json`),
    join(SCRIPTS_DIR, `.${agentId}-sessions.json`),
    join(SCRIPTS_DIR, `.${dirName}-state.json`),
    join(SCRIPTS_DIR, `.${dirName}-sessions.json`)
  ]

  for (const path of patterns) {
    if (!existsSync(path)) continue
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      const summary: Record<string, unknown> = {}

      if (data.last_run) summary.lastRun = data.last_run
      if (data.reviewed_prs) summary.totalReviewed = Object.keys(data.reviewed_prs).length
      if (data.posted_dates) summary.totalDigests = data.posted_dates.length
      if (data.pinged_prs) summary.totalPinged = Object.keys(data.pinged_prs).length
      if (data.processed_prs) summary.totalProcessed = Object.keys(data.processed_prs).length
      if (data.sessions) {
        const active = Object.values(data.sessions).filter(
          (s: any) => s.phase === 'running' || s.phase === 'waiting_for_reply'
        ).length
        summary.activeSessions = active
      }
      if (data.stats) {
        summary.totalSessions = data.stats.total_sessions || 0
        summary.totalCost = data.stats.total_cost_dollars || 0
      }

      return summary
    } catch { /* ignore */ }
  }

  return {}
}

function computeNextRun(schedule: AgentSchedule, lastRun: string | null): string | null {
  if (schedule.type === 'always_on' || schedule.type === 'socket_mode' || schedule.type === 'unknown') {
    return null
  }

  const now = new Date()

  if (schedule.type === 'interval' && lastRun) {
    try {
      const lastDt = new Date(lastRun.replace(' ', 'T'))
      const nextDt = new Date(lastDt.getTime() + schedule.seconds * 1000)
      if (nextDt < now) return 'imminent'
      return nextDt.toISOString().replace('T', ' ').substring(0, 19)
    } catch {
      return null
    }
  }

  if (schedule.type === 'calendar') {
    const todayRun = new Date(now)
    todayRun.setHours(schedule.hour, schedule.minute, 0, 0)
    if (todayRun > now) {
      return todayRun.toISOString().replace('T', ' ').substring(0, 19)
    }
    const nextDt = new Date(todayRun.getTime() + 24 * 60 * 60 * 1000)
    return nextDt.toISOString().replace('T', ' ').substring(0, 19)
  }

  return null
}

export function scanAgents(): AgentInfo[] {
  const agents: AgentInfo[] = []
  const launchctlInfo = getLaunchctlInfo()
  const processedScriptDirs = new Set<string>()

  // Phase 1: Discover agents from LaunchAgent plists
  try {
    const files = readdirSync(LAUNCH_AGENTS_DIR)
    for (const file of files) {
      if (!file.startsWith('com.claude.') || !file.endsWith('.plist')) continue
      // Skip meta plists (socket-hub, etc.)
      if (file.includes('socket-hub')) continue

      const plistPath = join(LAUNCH_AGENTS_DIR, file)
      const plist = parsePlist(plistPath)
      if (!plist) continue

      const label = plist.Label || file.replace('.plist', '')

      // Extract the actual script directory from ProgramArguments
      const scriptDir = extractScriptDir(plist.ProgramArguments || [])
      if (!scriptDir) continue

      const dirName = basename(scriptDir)
      const agentId = deriveAgentId(dirName)
      processedScriptDirs.add(scriptDir)

      // Determine if it's a socket mode / always-on agent
      const isKeepAlive = !!plist.KeepAlive
      const argsStr = (plist.ProgramArguments || []).join(' ')
      const isSocketMode = isKeepAlive && (argsStr.includes('--socket-mode') || argsStr.includes('socket'))

      let schedule: AgentSchedule
      if (isSocketMode) {
        schedule = { type: 'socket_mode' }
      } else if (isKeepAlive) {
        // KeepAlive agents that aren't socket mode (like otto)
        schedule = { type: 'always_on' }
      } else {
        schedule = parseSchedule(plist)
      }

      // Determine running status
      const lcInfo = launchctlInfo.get(label)
      const hubInfo = launchctlInfo.get('com.claude.socket-hub')

      let running = false
      let runningSource: 'scheduled' | 'socket_mode' | null = null
      let loaded = false

      if (isSocketMode || (isKeepAlive && !plist.StartInterval && !plist.StartCalendarInterval)) {
        // Socket mode / always-on: check the socket hub
        running = hubInfo?.running ?? lcInfo?.running ?? false
        runningSource = running ? 'socket_mode' : null
        loaded = running
      } else {
        running = lcInfo?.running ?? false
        runningSource = running ? 'scheduled' : null
        loaded = !!lcInfo
      }

      // Find log directory — try agent ID first, then dir name
      const logDir = existsSync(join(LOGS_DIR, agentId))
        ? join(LOGS_DIR, agentId)
        : existsSync(join(LOGS_DIR, dirName))
          ? join(LOGS_DIR, dirName)
          : join(LOGS_DIR, agentId)

      const { lastRun, lastResult } = readLastHistoryLine(logDir)

      agents.push({
        id: agentId,
        name: inferAgentName(dirName),
        description: plist.Comment || '',
        scriptDir,
        logDir,
        scheduleType: schedule.type as AgentInfo['scheduleType'],
        schedule,
        status: {
          running,
          runningSource,
          loaded,
          exitCode: lcInfo?.exitCode ?? null
        },
        lastRun,
        lastResult,
        nextRun: computeNextRun(schedule, lastRun),
        stateSummary: readStateSummary(agentId, dirName)
      })
    }
  } catch { /* no LaunchAgents dir */ }

  // Phase 2: Scan script directories for agents without plists
  try {
    const entries = readdirSync(SCRIPTS_DIR)
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'common' || entry === 'billing-dashboard') continue
      const fullPath = join(SCRIPTS_DIR, entry)
      try {
        if (!statSync(fullPath).isDirectory()) continue
      } catch { continue }
      if (processedScriptDirs.has(fullPath)) continue

      // Check if it looks like an agent
      let isAgent = false
      try {
        const dirEntries = readdirSync(fullPath)
        isAgent = dirEntries.some(f =>
          f === 'main.py' || f === '__main__.py' ||
          f.endsWith('_agent.py') || f.endsWith('_bot.py') ||
          f.endsWith('_runner.py')
        )
      } catch { continue }

      if (!isAgent) continue

      const agentId = deriveAgentId(entry)
      const logDir = existsSync(join(LOGS_DIR, agentId))
        ? join(LOGS_DIR, agentId)
        : join(LOGS_DIR, entry)
      const { lastRun, lastResult } = readLastHistoryLine(logDir)

      agents.push({
        id: agentId,
        name: inferAgentName(entry),
        description: '',
        scriptDir: fullPath,
        logDir,
        scheduleType: 'unknown',
        schedule: { type: 'unknown' },
        status: { running: false, runningSource: null, loaded: false, exitCode: null },
        lastRun,
        lastResult,
        nextRun: null,
        stateSummary: readStateSummary(agentId, entry)
      })
    }
  } catch { /* ignore */ }

  return agents.sort((a, b) => a.name.localeCompare(b.name))
}

export function getAgentLogs(agentId: string, logType: 'history' | 'stdout' = 'history'): string[] {
  // Try multiple log dir locations
  const possibleDirs = [
    join(LOGS_DIR, agentId),
    join(LOGS_DIR, `billing-${agentId}`)
  ]

  for (const logDir of possibleDirs) {
    const logFile = join(logDir, logType === 'history' ? 'history.log' : 'stdout.log')
    if (!existsSync(logFile)) continue
    try {
      const content = readFileSync(logFile, 'utf-8')
      const lines = content.split('\n')
      return lines.slice(-200)
    } catch { /* ignore */ }
  }

  return []
}

export function triggerAgent(agentId: string): { success: boolean; error?: string } {
  // Find the agent's script dir from plists first
  let scriptDir: string | null = null
  let plistEnv: Record<string, string> = {}

  try {
    const files = readdirSync(LAUNCH_AGENTS_DIR)
    for (const file of files) {
      if (!file.startsWith('com.claude.') || !file.endsWith('.plist')) continue
      const plistPath = join(LAUNCH_AGENTS_DIR, file)
      const plist = parsePlist(plistPath)
      if (!plist?.ProgramArguments) continue

      const dir = extractScriptDir(plist.ProgramArguments)
      if (!dir) continue

      const dirName = basename(dir)
      if (deriveAgentId(dirName) === agentId || dirName === agentId) {
        scriptDir = dir
        plistEnv = plist.EnvironmentVariables || {}
        break
      }
    }
  } catch { /* ignore */ }

  // Fallback: try common directory patterns
  if (!scriptDir) {
    const possibleDirs = [
      join(SCRIPTS_DIR, `billing-${agentId}`),
      join(SCRIPTS_DIR, agentId)
    ]
    for (const dir of possibleDirs) {
      if (existsSync(join(dir, 'main.py')) || existsSync(join(dir, '__main__.py'))) {
        scriptDir = dir
        break
      }
    }
  }

  if (!scriptDir) {
    return { success: false, error: 'Agent script directory not found' }
  }

  // Find the python executable and main script
  const venvPython = existsSync(join(scriptDir, '.venv', 'bin', 'python3'))
    ? join(scriptDir, '.venv', 'bin', 'python3')
    : join(SCRIPTS_DIR, '.venv', 'bin', 'python3') // shared venv

  const mainScript = existsSync(join(scriptDir, 'main.py'))
    ? join(scriptDir, 'main.py')
    : existsSync(join(scriptDir, '__main__.py'))
      ? join(scriptDir, '__main__.py')
      : null

  if (!mainScript) {
    return { success: false, error: 'No main.py or __main__.py found' }
  }

  if (!existsSync(venvPython)) {
    return { success: false, error: 'Python virtual environment not found' }
  }

  try {
    const env: Record<string, string> = {
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      HOME: homedir(),
      ...plistEnv
    }

    const { spawn: spawnChild } = require('child_process')
    const fs = require('fs')
    const logDir = join(LOGS_DIR, agentId)
    fs.mkdirSync(logDir, { recursive: true })

    const logFile = join(logDir, 'stdout.log')
    const fd = fs.openSync(logFile, 'a')
    const child = spawnChild(venvPython, [mainScript], {
      cwd: scriptDir,
      env,
      detached: true,
      stdio: ['ignore', fd, fd]
    })
    child.unref()
    fs.closeSync(fd)

    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
