export interface AgentInfo {
  id: string
  name: string
  description: string
  scriptDir: string
  logDir: string
  scheduleType: 'interval' | 'calendar' | 'socket_mode' | 'unknown'
  schedule: AgentSchedule
  status: AgentStatus
  lastRun: string | null
  lastResult: string | null
  nextRun: string | null
  stateSummary: Record<string, unknown>
}

export interface AgentStatus {
  running: boolean
  runningSource: 'scheduled' | 'socket_mode' | 'manual' | null
  loaded: boolean
  exitCode: number | null
}

export type AgentSchedule =
  | { type: 'interval'; seconds: number }
  | { type: 'calendar'; hour: number; minute: number; weekday?: number }
  | { type: 'socket_mode'; scanIntervalSeconds?: number }
  | { type: 'always_on' }
  | { type: 'unknown' }

export interface AgentLogEntry {
  timestamp: string
  message: string
}
