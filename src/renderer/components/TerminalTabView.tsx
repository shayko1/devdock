import React, { useState, useCallback, useEffect, useRef } from 'react'
import { XTerminal } from './XTerminal'

interface TerminalSession {
  id: string
  title: string
  cwd: string
  exited?: boolean
}

interface Props {
  scanPath: string
}

let terminalCounter = 0

export function TerminalTabView({ scanPath }: Props) {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const creatingRef = useRef(false)

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
    terminalCounter++
    const sessionId = `terminal-${Date.now().toString(36)}-${terminalCounter}`
    const cwd = scanPath || (typeof process !== 'undefined' ? process.env.HOME || '~' : '~')
    const title = `Terminal ${terminalCounter}`

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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Terminal tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px',
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, overflowX: 'auto',
      }}>
        {sessions.map(session => (
          <div
            key={session.id}
            onClick={() => setActiveId(session.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
              background: session.id === activeId ? 'var(--bg-card-hover)' : 'transparent',
              border: session.id === activeId ? '1px solid var(--border)' : '1px solid transparent',
              fontSize: 11, color: session.exited ? 'var(--text-muted)' : 'var(--text-primary)',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            <span>{session.title}</span>
            {session.exited && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>exited</span>}
            <button
              onClick={(e) => { e.stopPropagation(); closeTerminal(session.id) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 11, padding: '0 1px', lineHeight: 1,
              }}
              title="Close terminal"
            >✕</button>
          </div>
        ))}
        <button
          onClick={createTerminal}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 4,
            cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14,
            padding: '2px 8px', flexShrink: 0, lineHeight: 1,
          }}
          title="New terminal"
        >+</button>
      </div>

      {/* Terminal content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {sessions.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
            color: 'var(--text-secondary)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>No terminals open</div>
            <button className="btn btn-sm btn-primary" onClick={createTerminal}>+ New Terminal</button>
          </div>
        )}
        {sessions.map(session => (
          <div
            key={session.id}
            style={{
              position: 'absolute', inset: 0,
              display: session.id === activeId ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <XTerminal sessionId={session.id} active={session.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  )
}
