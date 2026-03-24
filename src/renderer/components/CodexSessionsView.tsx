import React, { useState, useCallback, useEffect } from 'react'
import { XTerminal } from './XTerminal'
import { MetricsBar } from './MetricsBar'
import { CodexSession } from '../hooks/useCodexSessions'

interface Props {
  sessions: CodexSession[]
  onNewSession: () => void
  onCloseSession: (sessionId: string) => void
}

export function CodexSessionsView({ sessions, onNewSession, onCloseSession }: Props) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Auto-select first session or newly created session
  useEffect(() => {
    if (sessions.length === 0) {
      setActiveSessionId(null)
      return
    }
    if (!activeSessionId || !sessions.find(s => s.id === activeSessionId)) {
      setActiveSessionId(sessions[sessions.length - 1].id)
    }
  }, [sessions, activeSessionId])

  const handleClose = useCallback(async (sessionId: string) => {
    onCloseSession(sessionId)
  }, [onCloseSession])

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null

  if (sessions.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>No Codex sessions</div>
        <div style={{ fontSize: 12 }}>Start a session from the All Folders tab or click below.</div>
        <button className="btn btn-sm btn-primary" onClick={onNewSession}>+ New Codex Session</button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{
        width: 200, flexShrink: 0, borderRight: '1px solid var(--border)',
        background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Sessions</span>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
            onClick={onNewSession}
            title="New Codex session"
          >+</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {sessions.map(session => (
            <div
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              style={{
                padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                background: session.id === activeSessionId ? 'var(--bg-card-hover)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {session.folderName}
                </div>
                {session.branchName && (
                  <div style={{ fontSize: 10, color: 'var(--blue, #58a6ff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ⎇ {session.branchName}
                  </div>
                )}
                {session.exited && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>exited</div>}
                {session.initializing && <div style={{ fontSize: 10, color: 'var(--yellow, #e8a838)' }}>starting…</div>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleClose(session.id) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, flexShrink: 0, padding: 2 }}
                title="Close session"
              >✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* Main terminal area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <MetricsBar sessionIds={sessions.map(s => s.id)} label="Codex" />
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {sessions.map(session => (
            <div
              key={session.id}
              style={{
                position: 'absolute', inset: 0,
                display: session.id === activeSessionId ? 'flex' : 'none',
                flexDirection: 'column',
              }}
            >
              {!session.initializing && (
                <XTerminal sessionId={session.id} active={session.id === activeSessionId} />
              )}
              {session.initializing && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  Starting Codex session…
                </div>
              )}
            </div>
          ))}
          {!activeSession && sessions.length > 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Select a session
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
