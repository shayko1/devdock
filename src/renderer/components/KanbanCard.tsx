import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ResourceBadge } from './ResourceBadge'
import type { SessionMetrics } from '../../shared/ipc-types'

interface Props {
  session: {
    id: string
    folderName: string
    branchName: string | null
    exited?: boolean
    claudeSessionId?: string | null
    dangerousMode?: boolean
    initializing?: boolean
    title?: string
    titleManual?: boolean
    dormant?: boolean
    loading?: boolean
  }
  isActive: boolean
  isWaiting: boolean
  metrics: SessionMetrics | undefined
  isResourceLoading: boolean
  /** True while the session is being auto-named. */
  isGeneratingTitle: boolean
  onSelect: (id: string) => void
  onClose: (id: string, e: React.MouseEvent) => void
  onResume: (id: string) => void
  /** Starts the PTY for a session parked in a manual-load column. */
  onLoad: (id: string) => void
  /** Closes the PTY but keeps the card and transcript. */
  onPark: (id: string) => void
  onRename: (id: string, title: string) => void
  onRegenerateTitle: (id: string) => void
  onResetTitle: (id: string) => void
  onDragStart: (e: React.DragEvent, sessionId: string) => void
}

export function KanbanCard({
  session,
  isActive,
  isWaiting,
  metrics,
  isResourceLoading,
  isGeneratingTitle,
  onSelect,
  onClose,
  onResume,
  onLoad,
  onPark,
  onRename,
  onRegenerateTitle,
  onResetTitle,
  onDragStart,
}: Props) {
  const isExited = !!session.exited
  const isInitializing = !!session.initializing
  const isDormant = !!session.dormant
  const isLoading = !!session.loading
  const label = session.title || session.folderName
  /** Only show the folder sub-line once the card is showing something else on top. */
  const showProject = !!session.title && session.title !== session.folderName

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(label)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [contextMenu])

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  const startRename = useCallback(() => {
    setDraft(session.title || session.folderName)
    setRenaming(true)
  }, [session.title, session.folderName])

  const commitRename = useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== label) onRename(session.id, trimmed)
    setRenaming(false)
  }, [draft, label, session.id, onRename])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const runMenuAction = (action: () => void) => {
    action()
    setContextMenu(null)
  }

  return (
    <div
      className={`kanban-card ${isActive ? 'active' : ''} ${isExited ? 'exited' : ''} ${isDormant ? 'dormant' : ''} ${isWaiting ? 'waiting' : ''}`}
      draggable={!renaming}
      onDragStart={(e) => onDragStart(e, session.id)}
      onClick={() => { if (!renaming) onSelect(session.id) }}
      onContextMenu={handleContextMenu}
    >
      <div className="kanban-card-row1">
        <span className={`sidebar-status-dot ${isExited || isDormant ? 'exited' : isWaiting ? 'waiting' : 'active'}`} />
        {renaming ? (
          <input
            ref={inputRef}
            className="kanban-card-rename-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') setRenaming(false)
            }}
            aria-label="Session name"
            autoFocus
          />
        ) : (
          <span
            className="kanban-card-name"
            title={`${label} — double-click to rename`}
            onDoubleClick={(e) => { e.stopPropagation(); startRename() }}
          >
            {label}
          </span>
        )}
        {isGeneratingTitle && !renaming && (
          <span className="kanban-card-naming" title="Naming session…">
            <span className="thinking-dots"><span /><span /><span /></span>
          </span>
        )}
        <button
          className="sidebar-card-close"
          onClick={(e) => onClose(session.id, e)}
          title="Close session"
        >
          ×
        </button>
      </div>
      {showProject && (
        <span className="kanban-card-project" title={session.folderName}>{session.folderName}</span>
      )}
      {session.branchName && (
        <div className="kanban-card-branch">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.5 }}>
            <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"/>
          </svg>
          {session.branchName.replace('devdock/claude-', '').slice(0, 20)}
        </div>
      )}
      <div className="kanban-card-badges">
        {!isExited && !isDormant && (
          <ResourceBadge
            metrics={metrics ?? null}
            isLoading={isResourceLoading}
          />
        )}
        {isInitializing && (
          <span className="sidebar-badge-thinking">
            Setting up
            <span className="thinking-dots">
              <span /><span /><span />
            </span>
          </span>
        )}
        {!isExited && !isDormant && !isWaiting && !isInitializing && (
          <span className="sidebar-badge-thinking">
            Thinking
            <span className="thinking-dots">
              <span /><span /><span />
            </span>
          </span>
        )}
        {isDormant && (
          isLoading ? (
            <span className="sidebar-badge-thinking">
              Loading
              <span className="thinking-dots"><span /><span /><span /></span>
            </span>
          ) : (
            <button
              className="sidebar-badge-resume"
              onClick={(e) => { e.stopPropagation(); onLoad(session.id) }}
              title="Start this session and resume its conversation"
            >
              Load
            </button>
          )
        )}
        {session.dangerousMode && !isDormant && (
          <span className="sidebar-badge-unsafe" title="Dangerous mode">UNSAFE</span>
        )}
        {isWaiting && !isDormant && (
          <span className="sidebar-badge-waiting">Waiting</span>
        )}
        {isExited && session.claudeSessionId && (
          <button
            className="sidebar-badge-resume"
            onClick={(e) => { e.stopPropagation(); onResume(session.id) }}
            title="Resume session"
          >
            Resume
          </button>
        )}
        {isExited && !session.claudeSessionId && (
          <span className="sidebar-badge-exited">Ended</span>
        )}
      </div>
      {contextMenu && (
        <div
          ref={menuRef}
          className="kanban-context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!isDormant && !isExited && !isInitializing && session.claudeSessionId && (
            <button
              onClick={() => runMenuAction(() => onPark(session.id))}
              title="Stop the process and free its memory. The conversation is kept — press Load to pick it back up."
            >
              Close, keep conversation
            </button>
          )}
          <button onClick={() => runMenuAction(startRename)}>Rename</button>
          <button onClick={() => runMenuAction(() => onRegenerateTitle(session.id))}>
            Rename with AI
          </button>
          {session.title && (
            <button onClick={() => runMenuAction(() => onResetTitle(session.id))}>
              Reset to folder name
            </button>
          )}
        </div>
      )}
    </div>
  )
}
