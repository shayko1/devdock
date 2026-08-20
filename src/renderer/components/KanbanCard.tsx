import React from 'react'
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
  }
  title: string
  isActive: boolean
  isWaiting: boolean
  metrics: SessionMetrics | undefined
  isResourceLoading: boolean
  onSelect: (id: string) => void
  onClose: (id: string, e: React.MouseEvent) => void
  onResume: (id: string) => void
  onDragStart: (e: React.DragEvent, sessionId: string) => void
}

export function KanbanCard({
  session,
  title,
  isActive,
  isWaiting,
  metrics,
  isResourceLoading,
  onSelect,
  onClose,
  onResume,
  onDragStart,
}: Props) {
  const isExited = !!session.exited
  const isInitializing = !!session.initializing

  return (
    <div
      className={`kanban-card ${isActive ? 'active' : ''} ${isExited ? 'exited' : ''} ${isWaiting ? 'waiting' : ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, session.id)}
      onClick={() => onSelect(session.id)}
    >
      <div className="kanban-card-row1">
        <span className={`sidebar-status-dot ${isExited ? 'exited' : isWaiting ? 'waiting' : 'active'}`} />
        <span className="kanban-card-name" title={title}>
          {title}
        </span>
        <button
          className="sidebar-card-close"
          onClick={(e) => onClose(session.id, e)}
          title="Close session"
        >
          ×
        </button>
      </div>
      {title !== session.folderName && (
        <span className="kanban-card-project">{session.folderName}</span>
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
        {!isExited && (
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
        {!isExited && !isWaiting && !isInitializing && (
          <span className="sidebar-badge-thinking">
            Thinking
            <span className="thinking-dots">
              <span /><span /><span />
            </span>
          </span>
        )}
        {session.dangerousMode && (
          <span className="sidebar-badge-unsafe" title="Dangerous mode">UNSAFE</span>
        )}
        {isWaiting && (
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
    </div>
  )
}
