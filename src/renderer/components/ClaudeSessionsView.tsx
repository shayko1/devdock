import React, { useState, useCallback, useEffect, useRef } from 'react'
import { XTerminal } from './XTerminal'
import { FileExplorer } from './FileExplorer'
import { FileViewer } from './FileViewer'
import { ChangesView } from './ChangesView'
import { SearchView } from './SearchView'
import { BrowserView } from './BrowserView'
import { PipelineView } from './PipelineView'
import { SessionInfoBar } from './SessionInfoBar'
import { CoachPanel } from './CoachPanel'
import { ChatInputBar } from './ChatInputBar'

interface Session {
  id: string
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  exited?: boolean
  claudeSessionId?: string | null
  dangerousMode?: boolean
}

interface Props {
  sessions: Session[]
  rtkEnabled: boolean
  chatInputEnabled: boolean
  onNewSession: () => void
  onCloseSession: (sessionId: string) => void
  onResumeSession: (sessionId: string) => void
  onOpenPipelineSession?: (folderName: string, folderPath: string, worktreePath: string) => void
}

type SidePanel = 'none' | 'files' | 'file-view' | 'changes' | 'search' | 'browser' | 'pipeline' | 'coach'

export function ClaudeSessionsView({ sessions, rtkEnabled, chatInputEnabled, onNewSession, onCloseSession, onResumeSession, onOpenPipelineSession }: Props) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sidePanel, setSidePanel] = useState<SidePanel>('none')
  const [viewingFile, setViewingFile] = useState<string | null>(null)
  const [viewingLine, setViewingLine] = useState<number | undefined>(undefined)
  const [sideWidth, setSideWidth] = useState(350)
  const [waitingSessions, setWaitingSessions] = useState<Set<string>>(new Set())
  const [rtkDisabledSessions, setRtkDisabledSessions] = useState<Set<string>>(new Set())
  const [rtkAvailable, setRtkAvailable] = useState(false)
  const [coachEnabled, setCoachEnabled] = useState(false)
  const [coachBadge, setCoachBadge] = useState(0)
  const dragging = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rtkEnabled) { setRtkAvailable(false); return }
    window.api.rtkDetect().then(status => setRtkAvailable(status.installed))
  }, [rtkEnabled])

  useEffect(() => {
    window.api.coachGetConfig?.()
      .then(cfg => setCoachEnabled(cfg.enabled && cfg.apiKey.length > 0))
      .catch(() => { /* coach not available */ })
  }, [])

  useEffect(() => {
    if (!coachEnabled || !window.api.onCoachSuggestion) return
    const unsub = window.api.onCoachSuggestion((analysis) => {
      if (sidePanel !== 'coach') {
        setCoachBadge(prev => prev + analysis.suggestions.length)
      }
    })
    return unsub
  }, [coachEnabled, sidePanel])

  const handleToggleRtk = useCallback(async (sessionId: string) => {
    const currentlyDisabled = rtkDisabledSessions.has(sessionId)
    const newDisabled = !currentlyDisabled
    await window.api.rtkSessionToggle(sessionId, newDisabled)
    setRtkDisabledSessions(prev => {
      const next = new Set(prev)
      if (newDisabled) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }, [rtkDisabledSessions])

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

  const toggleCoach = useCallback(() => {
    setSidePanel(prev => {
      if (prev === 'coach') return 'none'
      setCoachBadge(0)
      return 'coach'
    })
    setViewingFile(null)
  }, [])

  const handleChatSend = useCallback((text: string) => {
    if (!activeSessionId) return
    const escaped = text.includes('\n')
      ? `\x1b[200~${text}\x1b[201~`
      : text
    window.api.ptyWrite(activeSessionId, escaped + '\r')
  }, [activeSessionId])

  const handleChatImageUpload = useCallback(async (file: File) => {
    if (!activeSessionId) return
    const buffer = await file.arrayBuffer()
    const result = await window.api.saveTempImage({
      name: file.name,
      data: Array.from(new Uint8Array(buffer)),
      sessionId: activeSessionId,
    })
    if (result.path) {
      window.api.ptyWrite(activeSessionId, result.path)
    }
  }, [activeSessionId])

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
            {session.dangerousMode && (
              <span
                className="claude-session-tab-dangerous"
                title="Dangerous mode — Claude runs commands without permission"
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: 3,
                  background: '#f85149',
                  color: '#fff',
                  letterSpacing: '0.3px',
                  flexShrink: 0
                }}
              >
                UNSAFE
              </span>
            )}
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
        {coachEnabled && (
          <button
            className={`btn btn-sm ${sidePanel === 'coach' ? 'btn-accent' : ''}`}
            onClick={toggleCoach}
            title="Prompt coach — suggestions to improve your prompts"
            style={{ marginRight: 4, position: 'relative' }}
          >
            Coach
            {coachBadge > 0 && sidePanel !== 'coach' && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: 'var(--orange, #d29922)', color: '#000',
                fontSize: 9, fontWeight: 700, borderRadius: 8,
                padding: '1px 5px', minWidth: 14, textAlign: 'center'
              }}>
                {coachBadge}
              </span>
            )}
          </button>
        )}
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
          rtkAvailable={rtkAvailable}
          rtkDisabled={rtkDisabledSessions.has(activeSession.id)}
          onToggleRtk={() => handleToggleRtk(activeSession.id)}
          onShowDiff={handleShowChanges}
          onShowFiles={toggleFiles}
        />
      )}
      <div className="claude-sessions-body" ref={bodyRef}>
        <div className="claude-sessions-terminal">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`claude-session-terminal-wrapper ${chatInputEnabled ? 'with-chat-input' : ''}`}
              style={{ display: activeSessionId === session.id ? 'flex' : 'none', flex: 1, minHeight: 0 }}
            >
              {session.dangerousMode && activeSessionId === session.id && (
                <div style={{
                  height: 3,
                  background: 'linear-gradient(90deg, #f85149, #da3633)',
                  flexShrink: 0
                }} title="Dangerous mode — Claude executes commands without asking permission" />
              )}
              <XTerminal
                sessionId={session.id}
                active={activeSessionId === session.id}
                onWaitingChange={(waiting) => handleWaitingChange(session.id, waiting)}
              />
              {chatInputEnabled && activeSessionId === session.id && !session.exited && (
                <ChatInputBar
                  sessionId={session.id}
                  onSend={handleChatSend}
                  onImageUpload={handleChatImageUpload}
                  disabled={session.exited}
                />
              )}
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
              {sidePanel === 'coach' ? (
                <CoachPanel
                  sessionId={activeSession.id}
                  onClose={() => setSidePanel('none')}
                  onWriteToTerminal={(text) => window.api.ptyWrite(activeSession.id, text)}
                />
              ) : sidePanel === 'pipeline' ? (
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
