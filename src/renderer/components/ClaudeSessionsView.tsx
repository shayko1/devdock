import React, { useState, useCallback, useEffect, useRef } from 'react'
import { XTerminal } from './XTerminal'
import { FileExplorer } from './FileExplorer'
import { FileViewer } from './FileViewer'
import { ChangesView } from './ChangesView'
import { SearchView } from './SearchView'
import { BrowserView } from './BrowserView'
import { PipelineView } from './PipelineView'
import { SessionInfoBar } from './SessionInfoBar'

interface Session {
  id: string
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  exited?: boolean
  claudeSessionId?: string | null
}

interface Props {
  sessions: Session[]
  onNewSession: () => void
  onCloseSession: (sessionId: string) => void
  onResumeSession: (sessionId: string) => void
  onOpenPipelineSession?: (folderName: string, folderPath: string, worktreePath: string) => void
}

type SidePanel = 'none' | 'files' | 'file-view' | 'changes' | 'search' | 'browser' | 'pipeline'

export function ClaudeSessionsView({ sessions, onNewSession, onCloseSession, onResumeSession, onOpenPipelineSession }: Props) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sidePanel, setSidePanel] = useState<SidePanel>('none')
  const [viewingFile, setViewingFile] = useState<string | null>(null)
  const [viewingLine, setViewingLine] = useState<number | undefined>(undefined)
  const [sideWidth, setSideWidth] = useState(350)
  const [waitingSessions, setWaitingSessions] = useState<Set<string>>(new Set())
  const dragging = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const handleWaitingChange = useCallback((sessionId: string, waiting: boolean) => {
    setWaitingSessions(prev => {
      const next = new Set(prev)
      if (waiting) {
        next.add(sessionId)
      } else {
        next.delete(sessionId)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (sessions.length === 0) {
      setActiveSessionId(null)
    } else if (!activeSessionId || !sessions.find(s => s.id === activeSessionId)) {
      setActiveSessionId(sessions[sessions.length - 1].id)
    }
  }, [sessions, activeSessionId])

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id)
    setViewingFile(null)
    if (sidePanel === 'file-view') setSidePanel('files')
  }, [sidePanel])

  const handleClose = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onCloseSession(sessionId)
  }, [onCloseSession])

  const activeSession = sessions.find(s => s.id === activeSessionId)
  const sessionRoot = activeSession?.worktreePath || activeSession?.folderPath || ''

  const handleFileSelect = useCallback((filePath: string, line?: number) => {
    setViewingFile(filePath)
    setViewingLine(line)
    setSidePanel('file-view')
  }, [])

  const toggleFiles = useCallback(() => {
    setSidePanel(prev => prev === 'none' ? 'files' : 'none')
    setViewingFile(null)
  }, [])

  const handleShowChanges = useCallback(() => {
    setSidePanel('changes')
    setViewingFile(null)
  }, [])

  const toggleSearch = useCallback(() => {
    setSidePanel(prev => prev === 'search' ? 'none' : 'search')
    setViewingFile(null)
  }, [])

  const toggleBrowser = useCallback(() => {
    setSidePanel(prev => prev === 'browser' ? 'none' : 'browser')
    setViewingFile(null)
  }, [])

  const togglePipeline = useCallback(() => {
    setSidePanel(prev => prev === 'pipeline' ? 'none' : 'pipeline')
    setViewingFile(null)
  }, [])

  // Drag resize logic
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startWidth = sideWidth

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX - ev.clientX
      const newWidth = Math.max(200, Math.min(800, startWidth + delta))
      setSideWidth(newWidth)
    }
    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sideWidth])

  if (sessions.length === 0) {
    return (
      <div className="claude-sessions-empty">
        <div className="claude-sessions-empty-text">
          No active Claude sessions.
        </div>
        <div className="claude-sessions-empty-hint">
          Click "Claude" on any folder in the All Folders tab to start a session,
          or use the button below.
        </div>
        <button className="btn btn-primary" onClick={onNewSession}>
          New Claude Session
        </button>
      </div>
    )
  }

  return (
    <div className="claude-sessions">
      <div className="claude-sessions-tabs">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`claude-session-tab ${activeSessionId === session.id ? 'active' : ''} ${session.exited ? 'exited' : ''} ${waitingSessions.has(session.id) && !session.exited ? 'waiting' : ''}`}
            onClick={() => handleSelectSession(session.id)}
          >
            {waitingSessions.has(session.id) && !session.exited && (
              <span className="claude-session-tab-waiting" title="Waiting for your input">
                <span className="waiting-dot" />
              </span>
            )}
            <span className="claude-session-tab-name">{session.folderName}</span>
            {session.branchName && (
              <span className="claude-session-tab-branch">
                {session.branchName.replace('devdock/claude-', '').slice(0, 15)}
              </span>
            )}
            {session.exited && session.claudeSessionId && (
              <button
                className="claude-session-tab-resume"
                onClick={(e) => { e.stopPropagation(); onResumeSession(session.id) }}
                title="Resume session"
              >
                Resume
              </button>
            )}
            <button
              className="claude-session-tab-close"
              onClick={(e) => handleClose(session.id, e)}
              title="Close session"
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="btn btn-sm claude-sessions-new-btn"
          onClick={onNewSession}
          title="New Claude session"
        >
          +
        </button>
        <div style={{ flex: 1 }} />
        <button
          className={`btn btn-sm ${sidePanel === 'pipeline' ? 'btn-accent' : ''}`}
          onClick={togglePipeline}
          title="Autonomous pipeline"
          style={{ marginRight: 4 }}
        >
          Pipeline
        </button>
        <button
          className={`btn btn-sm ${sidePanel === 'browser' ? 'btn-accent' : ''}`}
          onClick={toggleBrowser}
          title="Toggle embedded browser"
          style={{ marginRight: 4 }}
        >
          Browser
        </button>
        <button
          className={`btn btn-sm ${sidePanel === 'search' ? 'btn-accent' : ''}`}
          onClick={toggleSearch}
          title="Search in files"
          style={{ marginRight: 4 }}
        >
          Search
        </button>
        <button
          className={`btn btn-sm ${sidePanel !== 'none' && sidePanel !== 'search' ? 'btn-accent' : ''}`}
          onClick={toggleFiles}
          title="Toggle file explorer"
          style={{ marginRight: 4 }}
        >
          Files
        </button>
      </div>
      {activeSession && (
        <SessionInfoBar
          folderName={activeSession.folderName}
          folderPath={activeSession.folderPath}
          worktreePath={activeSession.worktreePath}
          branchName={activeSession.branchName}
          onShowDiff={handleShowChanges}
          onShowFiles={toggleFiles}
        />
      )}
      <div className="claude-sessions-body" ref={bodyRef}>
        <div className="claude-sessions-terminal">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="claude-session-terminal-wrapper"
              style={{ display: activeSessionId === session.id ? 'flex' : 'none', flex: 1, minHeight: 0 }}
            >
              <XTerminal
                sessionId={session.id}
                active={activeSessionId === session.id}
                onWaitingChange={(waiting) => handleWaitingChange(session.id, waiting)}
              />
              {session.exited && activeSessionId === session.id && (
                <div className="claude-session-exited-overlay">
                  <div className="claude-session-exited-msg">Session ended</div>
                  {session.claudeSessionId && (
                    <button
                      className="btn btn-primary"
                      onClick={() => onResumeSession(session.id)}
                    >
                      Resume Session
                    </button>
                  )}
                  <button
                    className="btn btn-sm"
                    onClick={() => onCloseSession(session.id)}
                    style={{ marginTop: 8 }}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {sidePanel !== 'none' && activeSession && (
          <>
            <div className="side-resize-handle" onMouseDown={onDragStart} />
            <div className="claude-sessions-side" style={{ width: sideWidth }}>
              {sidePanel === 'pipeline' ? (
                <PipelineView
                  folderName={activeSession.folderName}
                  folderPath={activeSession.folderPath}
                  onClose={() => setSidePanel('none')}
                  onOpenSession={onOpenPipelineSession}
                />
              ) : sidePanel === 'browser' ? (
                <BrowserView
                  sessionId={activeSession.id}
                  onClose={() => setSidePanel('none')}
                />
              ) : sidePanel === 'search' ? (
                <SearchView
                  rootPath={sessionRoot}
                  onFileSelect={handleFileSelect}
                  onClose={() => setSidePanel('none')}
                />
              ) : sidePanel === 'changes' && activeSession.worktreePath ? (
                <ChangesView
                  worktreePath={activeSession.worktreePath}
                  onClose={() => setSidePanel('files')}
                />
              ) : sidePanel === 'file-view' && viewingFile ? (
                <FileViewer
                  filePath={viewingFile}
                  scrollToLine={viewingLine}
                  onClose={() => { setSidePanel('files'); setViewingFile(null); setViewingLine(undefined) }}
                />
              ) : (
                <FileExplorer
                  rootPath={sessionRoot}
                  onFileSelect={handleFileSelect}
                  onShowChanges={handleShowChanges}
                  hasWorktree={!!activeSession.worktreePath}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
