import React, { useState, useCallback, useEffect, useRef } from 'react'
import { XTerminal } from './XTerminal'
import './TerminalTabView.css'

interface TerminalSession {
  id: string
  title: string
  cwd: string
  exited?: boolean
}

interface Props {
  scanPath: string
}

export function TerminalTabView({ scanPath }: Props) {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const creatingRef = useRef(false)
  const counterRef = useRef(0)

  // Listen for PTY exits
  useEffect(() => {
    const unsub = window.api.onPtyExit(({ sessionId }) => {
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, exited: true } : s))
    })
    return unsub
  }, [])

  const createTerminal = useCallback(async () => {
    if (creatingRef.current) return
    creatingRef.current = true
    counterRef.current++
    const sessionId = `terminal-${Date.now().toString(36)}-${counterRef.current}`
    const cwd = scanPath
    const title = `Terminal ${counterRef.current}`

    try {
      const result = await window.api.ptyCreate({
        sessionId,
        folderName: title,
        folderPath: cwd,
        useWorktree: false,
        tool: 'shell',
      })
      if (result.success) {
        const session: TerminalSession = { id: sessionId, title, cwd }
        setSessions(prev => [...prev, session])
        setActiveId(sessionId)
      }
    } catch (err) {
      console.error('Failed to create terminal session:', err)
    } finally {
      creatingRef.current = false
    }
  }, [scanPath])

  const closeTerminal = useCallback(async (sessionId: string) => {
    await window.api.ptyDestroy(sessionId)
    setSessions(prev => {
      const remaining = prev.filter(s => s.id !== sessionId)
      // If we closed the active one, switch to another
      if (activeId === sessionId && remaining.length > 0) {
        setActiveId(remaining[remaining.length - 1].id)
      } else if (remaining.length === 0) {
        setActiveId(null)
      }
      return remaining
    })
  }, [activeId])

  return (
    <div className="terminal-tab-view">
      {/* Terminal tab bar */}
      <div className="terminal-tab-bar">
        {sessions.map(session => (
          <div
            key={session.id}
            onClick={() => setActiveId(session.id)}
            className={`terminal-tab${session.id === activeId ? ' active' : ''}${session.exited ? ' exited' : ''}`}
          >
            <span className="terminal-tab-title">{session.title}</span>
            {session.exited && <span className="terminal-tab-exited-badge">exited</span>}
            <button
              onClick={(e) => { e.stopPropagation(); closeTerminal(session.id) }}
              className="terminal-tab-close"
              title="Close terminal"
            >✕</button>
          </div>
        ))}
        <button
          onClick={createTerminal}
          className="terminal-tab-new-btn"
          title="New terminal"
        >+</button>
      </div>

      {/* Terminal content */}
      <div className="terminal-content">
        {sessions.length === 0 && (
          <div className="terminal-empty">
            <div className="terminal-empty-title">No terminals open</div>
            <button className="btn btn-sm btn-primary" onClick={createTerminal}>+ New Terminal</button>
          </div>
        )}
        {sessions.map(session => (
          <div
            key={session.id}
            className={`terminal-wrapper ${session.id === activeId ? 'active' : 'inactive'}`}
          >
            <XTerminal sessionId={session.id} active={session.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  )
}
