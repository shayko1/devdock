import React, { useState, useRef, useEffect, useCallback } from 'react'
import { KanbanCard } from './KanbanCard'
import type { KanbanColumn, SessionMetrics } from '../../shared/ipc-types'

/**
 * Drag payload key for a column being reordered. Session cards drag as
 * `text/plain`, so the two gestures never get confused for one another.
 */
export const COLUMN_DRAG_TYPE = 'application/x-devdock-column'

export interface KanbanSession {
  id: string
  folderName: string
  branchName: string | null
  exited?: boolean
  claudeSessionId?: string | null
  dangerousMode?: boolean
  initializing?: boolean
  columnId?: string
  title?: string
  titleManual?: boolean
  /** Parked in a manual-load column: no PTY yet, the card offers "Load". */
  dormant?: boolean
  /** A dormant session whose PTY is currently being started. */
  loading?: boolean
}

interface Props {
  column: KanbanColumn
  sessions: KanbanSession[]
  activeSessionId: string | null
  waitingSessions: Set<string>
  getSessionMetrics: (id: string) => SessionMetrics | undefined
  isResourceLoading: boolean
  generatingTitleIds: Set<string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string, e: React.MouseEvent) => void
  onResumeSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
  onRegenerateSessionTitle: (id: string) => void
  onResetSessionTitle: (id: string) => void
  onDrop: (sessionId: string, columnId: string) => void
  /** Starts a dormant session's PTY on demand. */
  onLoadSession: (id: string) => void
  /** Closes a session's PTY but keeps its card and transcript. */
  onParkSession: (id: string) => void
  onRename: (columnId: string, name: string) => void
  onDelete: (columnId: string) => void
  onMoveUp: (columnId: string) => void
  onMoveDown: (columnId: string) => void
  /** Drops the dragged column immediately before or after this one. */
  onReorder: (draggedId: string, targetId: string, place: 'before' | 'after') => void
  onToggleManualLoad: (columnId: string) => void
  isFirst: boolean
  isLast: boolean
}

export function KanbanColumnSection({
  column,
  sessions,
  activeSessionId,
  waitingSessions,
  getSessionMetrics,
  isResourceLoading,
  generatingTitleIds,
  onSelectSession,
  onCloseSession,
  onResumeSession,
  onRenameSession,
  onRegenerateSessionTitle,
  onResetSessionTitle,
  onDrop,
  onLoadSession,
  onParkSession,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
  onReorder,
  onToggleManualLoad,
  isFirst,
  isLast,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropEdge, setDropEdge] = useState<'before' | 'after' | null>(null)
  const [isDraggingSelf, setIsDraggingSelf] = useState(false)
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

  const isColumnDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(COLUMN_DRAG_TYPE)

  // ── Session card drops (column body) ──

  const handleDragOver = (e: React.DragEvent) => {
    // Let a column drag bubble to the wrapper, which handles reordering.
    if (isColumnDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = () => setIsDragOver(false)

  const handleDropZone = (e: React.DragEvent) => {
    if (isColumnDrag(e)) return
    e.preventDefault()
    setIsDragOver(false)
    const sessionId = e.dataTransfer.getData('text/plain')
    if (sessionId) onDrop(sessionId, column.id)
  }

  // A collapsed column has no body, so the header stands in as its drop zone.
  // Without this a collapsed column is simply not a drop target, and the only
  // way to file a card into one is to expand it first.

  const handleHeaderDragOver = (e: React.DragEvent) => {
    if (!collapsed || isColumnDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleHeaderDragLeave = (e: React.DragEvent) => {
    // The header has children; ignore the leaves fired while crossing them.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsDragOver(false)
  }

  const handleHeaderDrop = (e: React.DragEvent) => {
    if (!collapsed || isColumnDrag(e)) return
    e.preventDefault()
    setIsDragOver(false)
    const sessionId = e.dataTransfer.getData('text/plain')
    // Stays collapsed on purpose — filing a card away should not unfold the
    // column you were keeping shut. The count badge is the confirmation.
    if (sessionId) onDrop(sessionId, column.id)
  }

  const handleCardDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData('text/plain', sessionId)
    e.dataTransfer.effectAllowed = 'move'
  }

  // ── Column reordering (whole column is the drop zone) ──

  const handleColumnDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(COLUMN_DRAG_TYPE, column.id)
    // Some browsers refuse a drag with no text/plain; keep it human-readable.
    e.dataTransfer.setData('text/plain', '')
    e.dataTransfer.effectAllowed = 'move'
    setIsDraggingSelf(true)
  }

  const handleColumnDragEnd = () => {
    setIsDraggingSelf(false)
    setDropEdge(null)
  }

  /** Which half of this column the cursor sits in — the insertion side. */
  const edgeAt = (e: React.DragEvent): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  const handleColumnDragOver = (e: React.DragEvent) => {
    if (!isColumnDrag(e) || isDraggingSelf) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropEdge(edgeAt(e))
  }

  const handleColumnDragLeave = (e: React.DragEvent) => {
    // Ignore the leave events fired while crossing this column's own children.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropEdge(null)
  }

  const handleColumnDrop = (e: React.DragEvent) => {
    if (!isColumnDrag(e)) return
    e.preventDefault()
    const draggedId = e.dataTransfer.getData(COLUMN_DRAG_TYPE)
    // Read the edge off the drop event itself — the indicator state can lag a
    // render behind on a fast drop.
    const place = edgeAt(e)
    setDropEdge(null)
    if (draggedId) onReorder(draggedId, column.id, place)
  }

  return (
    <div
      className={[
        'kanban-column',
        isDraggingSelf ? 'dragging' : '',
        dropEdge ? `drop-${dropEdge}` : '',
      ].filter(Boolean).join(' ')}
      onDragOver={handleColumnDragOver}
      onDragLeave={handleColumnDragLeave}
      onDrop={handleColumnDrop}
    >
      <div
        className={`kanban-column-header ${collapsed && isDragOver ? 'drag-over' : ''}`}
        draggable={!renaming}
        onDragStart={handleColumnDragStart}
        onDragEnd={handleColumnDragEnd}
        onDragOver={handleHeaderDragOver}
        onDragLeave={handleHeaderDragLeave}
        onDrop={handleHeaderDrop}
        onContextMenu={handleContextMenu}
        onDoubleClick={startRename}
        title="Drag to reorder · double-click to rename · right-click for options"
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
        {column.manualLoad && (
          <span
            className="kanban-column-manual"
            title="Sessions here stay unloaded on startup until you open them"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM.5 8a7.5 7.5 0 1 1 15 0 7.5 7.5 0 0 1-15 0zM6 5.25c0-.14.11-.25.25-.25h1c.14 0 .25.11.25.25v5.5a.25.25 0 0 1-.25.25h-1a.25.25 0 0 1-.25-.25v-5.5zm2.5 0c0-.14.11-.25.25-.25h1c.14 0 .25.11.25.25v5.5a.25.25 0 0 1-.25.25h-1a.25.25 0 0 1-.25-.25v-5.5z"/>
            </svg>
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
            <button
              onClick={() => { onToggleManualLoad(column.id); setContextMenu(null) }}
              title="Closes a session when you move it here, and skips loading it on startup. Conversations are kept either way."
            >
              {column.manualLoad ? '✓ ' : ''}Close &amp; park sessions here
            </button>
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
                isActive={activeSessionId === session.id}
                isWaiting={waitingSessions.has(session.id)}
                metrics={getSessionMetrics(session.id)}
                isResourceLoading={isResourceLoading}
                isGeneratingTitle={generatingTitleIds.has(session.id)}
                onSelect={onSelectSession}
                onClose={onCloseSession}
                onResume={onResumeSession}
                onLoad={onLoadSession}
                onPark={onParkSession}
                onRename={onRenameSession}
                onRegenerateTitle={onRegenerateSessionTitle}
                onResetTitle={onResetSessionTitle}
                onDragStart={handleCardDragStart}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
