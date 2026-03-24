import React, { useState, useEffect } from 'react'
import { XTerminal } from './XTerminal'
import { MetricsBar } from './MetricsBar'
import { CodexSession } from '../hooks/useCodexSessions'
import './CodexSessionsView.css'

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

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null

  if (sessions.length === 0) {
    return (
      <div className="codex-sessions-empty">
        <div className="codex-sessions-empty-title">No Codex sessions</div>
        <div className="codex-sessions-empty-hint">Start a session from the All Folders tab or click below.</div>
        <button className="btn btn-sm btn-primary" onClick={onNewSession}>+ New Codex Session</button>
      </div>
    )
  }

  return (
    <div className="codex-sessions">
      {/* Sidebar */}
      <div className="codex-sidebar">
        <div className="codex-sidebar-header">
          <span className="codex-sidebar-title">Sessions</span>
          <button
            className="codex-sidebar-new-btn"
            onClick={onNewSession}
            title="New Codex session"
          >+</button>
        </div>
        <div className="codex-sidebar-list">
          {sessions.map(session => (
            <div
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              className={`codex-session-card${session.id === activeSessionId ? ' active' : ''}`}
            >
              <div className="codex-session-card-info">
                <div className="codex-session-card-name">{session.folderName}</div>
                {session.branchName && (
                  <div className="codex-session-card-branch">⎇ {session.branchName}</div>
                )}
                {session.exited && <div className="codex-session-card-exited">exited</div>}
                {session.initializing && <div className="codex-session-card-starting">starting…</div>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onCloseSession(session.id) }}
                className="codex-session-card-close"
                title="Close session"
              >✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* Main terminal area */}
      <div className="codex-main-area">
        <MetricsBar sessionIds={sessions.map(s => s.id)} label="Codex" />
        <div className="codex-terminals">
          {sessions.map(session => (
            <div
              key={session.id}
              className={`codex-terminal-wrapper ${session.id === activeSessionId ? 'active' : 'inactive'}`}
            >
              {!session.initializing && (
                <XTerminal sessionId={session.id} active={session.id === activeSessionId} />
              )}
              {session.initializing && (
                <div className="codex-initializing">Starting Codex session…</div>
              )}
            </div>
          ))}
          {!activeSession && sessions.length > 0 && (
            <div className="codex-no-selection">Select a session</div>
          )}
        </div>
      </div>
    </div>
  )
}
