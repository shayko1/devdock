import React, { useState, useRef, useEffect, useCallback } from 'react'
import { KanbanCard } from './KanbanCard'
import type { KanbanColumn, SessionMetrics } from '../../shared/ipc-types'

export interface KanbanSession {
  id: string
  folderName: string
  branchName: string | null
  exited?: boolean
  claudeSessionId?: string | null
  dangerousMode?: boolean
  initializing?: boolean
  columnId?: string
}

interface Props {
  column: KanbanColumn
  sessions: KanbanSession[]
  sessionTitles: Map<string, string>
  activeSessionId: string | null
  waitingSessions: Set<string>
  getSessionMetrics: (id: string) => SessionMetrics | undefined
  isResourceLoading: boolean
  onSelectSession: (id: string) => void
  onCloseSession: (id: string, e: React.MouseEvent) => void
  onResumeSession: (id: string) => void
  onDrop: (sessionId: string, columnId: string) => void
  onRename: (columnId: string, name: string) => void
  onDelete: (columnId: string) => void
  onMoveUp: (columnId: string) => void
  onMoveDown: (columnId: string) => void
  isFirst: boolean
  isLast: boolean
}

export function KanbanColumnSection({
  column,
  sessions,
  sessionTitles,
  activeSessionId,
  waitingSessions,
  getSessionMetrics,
  isResourceLoading,
  onSelectSession,
  onCloseSession,
  onResumeSession,
  onDrop,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState(column.name)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  useEffect(() => {
    if (renaming) renameInputRef.current?.select()
  }, [renaming])

  const startRename = useCallback(() => {
    setNameValue(column.name)
    setRenaming(true)
  }, [column.name])

  const commitRename = useCallback(() => {
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== column.name) onRename(column.id, trimmed)
    setRenaming(false)
  }, [nameValue, column.id, column.name, onRename])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleDelete = () => {
    if (sessions.length > 0 && !window.confirm(`Delete "${column.name}"? ${sessions.length} session(s) will be moved to another column.`)) {
      return
    }
    onDelete(column.id)
    setContextMenu(null)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = () => setIsDragOver(false)

  const handleDropZone = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const sessionId = e.dataTransfer.getData('text/plain')
    if (sessionId) onDrop(sessionId, column.id)
  }

  const handleCardDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData('text/plain', sessionId)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="kanban-column">
      <div
        className="kanban-column-header"
        onContextMenu={handleContextMenu}
        onDoubleClick={startRename}
      >
        <button
          className="kanban-column-toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        {column.color && <span className="kanban-column-color" style={{ background: column.color }} />}
        {renaming ? (
          <input
            ref={renameInputRef}
            className="kanban-column-rename-input"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') setRenaming(false)
            }}
            autoFocus
          />
        ) : (
          <span className="kanban-column-name" title={column.name}>
            {column.name}
          </span>
        )}
        <span className="kanban-column-count">{sessions.length}</span>
        {contextMenu && (
          <div
            ref={menuRef}
            className="kanban-context-menu"
            style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
          >
            <button onClick={() => { startRename(); setContextMenu(null) }}>Rename</button>
            {!isFirst && (
              <button onClick={() => { onMoveUp(column.id); setContextMenu(null) }}>Move Up</button>
            )}
            {!isLast && (
              <button onClick={() => { onMoveDown(column.id); setContextMenu(null) }}>Move Down</button>
            )}
            <button className="danger" onClick={handleDelete}>Delete</button>
          </div>
        )}
      </div>
      {!collapsed && (
        <div
          className={`kanban-column-body ${isDragOver ? 'drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDropZone}
        >
          {sessions.length === 0 ? (
            <div className="kanban-column-empty">No sessions</div>
          ) : (
            sessions.map((session) => (
              <KanbanCard
                key={session.id}
                session={session}
                title={sessionTitles.get(session.id) ?? session.folderName}
                isActive={activeSessionId === session.id}
                isWaiting={waitingSessions.has(session.id)}
                metrics={getSessionMetrics(session.id)}
                isResourceLoading={isResourceLoading}
                onSelect={onSelectSession}
                onClose={onCloseSession}
                onResume={onResumeSession}
                onDragStart={handleCardDragStart}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
