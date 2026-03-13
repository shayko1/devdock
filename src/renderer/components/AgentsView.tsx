import React, { useState, useEffect, useCallback } from 'react'
import { AgentInfo } from '../../shared/agent-types'

export function AgentsView() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [logType, setLogType] = useState<'history' | 'stdout'>('history')
  const [triggering, setTriggering] = useState<string | null>(null)
  const [triggerResult, setTriggerResult] = useState<{ agentId: string; success: boolean; error?: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await window.api.scanAgents()
      setAgents(result)
    } catch (err) {
      console.error('Failed to scan agents:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 15000)
    return () => clearInterval(interval)
  }, [refresh])

  const loadLogs = useCallback(async (agentId: string, type: 'history' | 'stdout') => {
    try {
      const result = await window.api.getAgentLogs(agentId, type)
      setLogs(result)
    } catch {
      setLogs([])
    }
  }, [])

  useEffect(() => {
    if (selectedAgent) {
      loadLogs(selectedAgent, logType)
    }
  }, [selectedAgent, logType, loadLogs])

  const handleTrigger = useCallback(async (agentId: string) => {
    setTriggering(agentId)
    setTriggerResult(null)
    try {
      const result = await window.api.triggerAgent(agentId)
      setTriggerResult({ agentId, success: result.success, error: result.error })
      // Clear the result message after 5 seconds
      setTimeout(() => setTriggerResult(prev => prev?.agentId === agentId ? null : prev), 5000)
      // Refresh after a short delay
      setTimeout(refresh, 2000)
    } catch (err) {
      setTriggerResult({ agentId, success: false, error: String(err) })
      setTimeout(() => setTriggerResult(prev => prev?.agentId === agentId ? null : prev), 5000)
    } finally {
      setTriggering(null)
    }
  }, [refresh])

  const formatSchedule = (agent: AgentInfo): string => {
    const s = agent.schedule
    if (s.type === 'socket_mode') return 'Socket Mode (always listening)'
    if (s.type === 'always_on') return 'Always On'
    if (s.type === 'calendar') {
      const h = String(s.hour).padStart(2, '0')
      const m = String(s.minute).padStart(2, '0')
      return `Daily at ${h}:${m}`
    }
    if (s.type === 'interval') {
      const mins = Math.round(s.seconds / 60)
      return mins >= 60 ? `Every ${Math.round(mins / 60)}h` : `Every ${mins}m`
    }
    return 'Unknown'
  }

  const formatTime = (ts: string | null): string => {
    if (!ts) return '--'
    if (ts === 'imminent') return 'Imminent'
    try {
      const d = new Date(ts.replace(' ', 'T'))
      const now = new Date()
      const diffMs = d.getTime() - now.getTime()
      if (Math.abs(diffMs) < 60000) return 'just now'
      if (diffMs > 0) {
        const mins = Math.round(diffMs / 60000)
        return mins >= 60 ? `in ${Math.round(mins / 60)}h ${mins % 60}m` : `in ${mins}m`
      }
      const mins = Math.round(-diffMs / 60000)
      if (mins >= 1440) return `${Math.round(mins / 1440)}d ago`
      return mins >= 60 ? `${Math.round(mins / 60)}h ago` : `${mins}m ago`
    } catch {
      return ts
    }
  }

  const getStatusClass = (agent: AgentInfo): string => {
    if (!agent.status.loaded && agent.scheduleType !== 'unknown') return 'disabled'
    if (agent.status.running) return 'running'
    if (agent.lastResult && /ERR|FAIL/i.test(agent.lastResult)) return 'error'
    return 'idle'
  }

  const getStatusLabel = (agent: AgentInfo): string => {
    const cls = getStatusClass(agent)
    if (cls === 'disabled') return agent.scheduleType === 'socket_mode' ? 'Disconnected' : 'Disabled'
    if (cls === 'running') {
      if (agent.status.runningSource === 'socket_mode') return 'Connected'
      return 'Running'
    }
    if (cls === 'error') return 'Error'
    return 'Idle'
  }

  const renderStateSummary = (agent: AgentInfo) => {
    const s = agent.stateSummary
    const items: string[] = []
    if (s.totalReviewed) items.push(`${s.totalReviewed} PRs reviewed`)
    if (s.totalDigests) items.push(`${s.totalDigests} digests sent`)
    if (s.totalPinged) items.push(`${s.totalPinged} PRs pinged`)
    if (s.totalProcessed) items.push(`${s.totalProcessed} processed`)
    if (s.activeSessions) items.push(`${s.activeSessions} active sessions`)
    if (s.totalSessions) items.push(`${s.totalSessions} total sessions`)
    if (s.totalCost) items.push(`$${Number(s.totalCost).toFixed(2)} cost`)
    if (items.length === 0) return null
    return <span className="agent-stat-summary">{items.join(' · ')}</span>
  }

  if (loading) {
    return (
      <div className="agents-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-muted)' }}>Scanning for agents...</span>
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <div className="agents-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <span style={{ color: 'var(--text-muted)' }}>No agents found</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Agents are detected from ~/.claude/scripts and ~/Library/LaunchAgents/com.claude.*.plist
        </span>
        <button className="btn btn-sm" onClick={refresh}>Rescan</button>
      </div>
    )
  }

  return (
    <div className="agents-view">
      <div className="agents-header">
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          Agents
          <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>
            {agents.length} found
          </span>
        </h2>
        <button className="btn btn-sm" onClick={refresh}>Refresh</button>
      </div>

      <div className="agents-grid">
        {agents.map(agent => {
          const statusClass = getStatusClass(agent)
          const isSelected = selectedAgent === agent.id
          return (
            <div
              key={agent.id}
              className={`agent-card agent-status-${statusClass} ${isSelected ? 'agent-card-selected' : ''}`}
              onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
            >
              <div className="agent-card-header">
                <div className={`agent-dot agent-dot-${statusClass}`} />
                <span className="agent-name">{agent.name}</span>
                <span className={`agent-status-badge agent-badge-${statusClass}`}>
                  {getStatusLabel(agent)}
                </span>
              </div>

              {agent.description && (
                <div className="agent-description">{agent.description}</div>
              )}

              <div className="agent-meta">
                <div className="agent-meta-item">
                  <span className="agent-meta-label">Schedule</span>
                  <span>{formatSchedule(agent)}</span>
                </div>
                <div className="agent-meta-item">
                  <span className="agent-meta-label">Last run</span>
                  <span>{formatTime(agent.lastRun)}</span>
                </div>
                {agent.nextRun && (
                  <div className="agent-meta-item">
                    <span className="agent-meta-label">Next run</span>
                    <span>{formatTime(agent.nextRun)}</span>
                  </div>
                )}
              </div>

              {renderStateSummary(agent)}

              {agent.lastResult && (
                <div className={`agent-last-result ${/ERR|FAIL/i.test(agent.lastResult) ? 'agent-result-error' : 'agent-result-ok'}`}>
                  {agent.lastResult.length > 120 ? agent.lastResult.substring(0, 120) + '...' : agent.lastResult}
                </div>
              )}

              <div className="agent-actions" onClick={e => e.stopPropagation()}>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => handleTrigger(agent.id)}
                  disabled={triggering === agent.id}
                  title="Trigger a manual run"
                >
                  {triggering === agent.id ? 'Starting...' : 'Trigger Run'}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    if (agent.scriptDir) {
                      window.api.openInFinder(agent.scriptDir)
                    }
                  }}
                  disabled={!agent.scriptDir}
                  title="Open script directory in Finder"
                >
                  Open Folder
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    if (agent.logDir) {
                      window.api.openInFinder(agent.logDir)
                    }
                  }}
                  title="Open logs directory"
                >
                  Logs
                </button>
              </div>
              {triggerResult?.agentId === agent.id && (
                <div className={`agent-trigger-result ${triggerResult.success ? 'agent-trigger-ok' : 'agent-trigger-err'}`}>
                  {triggerResult.success
                    ? 'Agent triggered successfully. Check logs for output.'
                    : `Failed: ${triggerResult.error}`}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selectedAgent && (
        <div className="agent-logs-panel">
          <div className="agent-logs-header">
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {agents.find(a => a.id === selectedAgent)?.name} — Logs
            </span>
            <div className="agent-log-tabs">
              <button
                className={`agent-log-tab ${logType === 'history' ? 'active' : ''}`}
                onClick={() => setLogType('history')}
              >
                History
              </button>
              <button
                className={`agent-log-tab ${logType === 'stdout' ? 'active' : ''}`}
                onClick={() => setLogType('stdout')}
              >
                Output
              </button>
            </div>
            <button className="btn btn-sm" onClick={() => loadLogs(selectedAgent, logType)}>
              Refresh
            </button>
          </div>
          <div className="agent-logs-content">
            {logs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 12 }}>No logs available</div>
            ) : (
              <pre className="agent-logs-pre">
                {logs.join('\n')}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
