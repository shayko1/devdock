import React, { useState, useMemo, useRef, useCallback } from 'react'
import { KanbanColumnSection, KanbanSession } from './KanbanColumn'
import type { KanbanColumn, SessionMetrics } from '../../shared/ipc-types'
import './KanbanPanel.css'

const MIN_WIDTH = 200
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 240

interface Props {
  sessions: KanbanSession[]
  columns: KanbanColumn[]
  sessionTitles: Map<string, string>
  activeSessionId: string | null
  waitingSessions: Set<string>
  getSessionMetrics: (id: string) => SessionMetrics | undefined
  isResourceLoading: boolean
  getSessionColumn: (columnId?: string) => string
  onSelectSession: (id: string) => void
  onCloseSession: (id: string, e: React.MouseEvent) => void
  onResumeSession: (id: string) => void
  onMoveSession: (sessionId: string, columnId: string) => void
  onAddColumn: (name: string) => void
  onRenameColumn: (columnId: string, name: string) => void
  onDeleteColumn: (columnId: string) => void
  onMoveColumnUp: (columnId: string) => void
  onMoveColumnDown: (columnId: string) => void
  onNewSession: () => void
}

export function KanbanPanel({
  sessions,
  columns,
  sessionTitles,
  activeSessionId,
  waitingSessions,
  getSessionMetrics,
  isResourceLoading,
  getSessionColumn,
  onSelectSession,
  onCloseSession,
  onResumeSession,
  onMoveSession,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onMoveColumnUp,
  onMoveColumnDown,
  onNewSession,
}: Props) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns]
  )

  const sessionsByColumn = useMemo(() => {
    const map = new Map<string, KanbanSession[]>()
    for (const col of sortedColumns) map.set(col.id, [])
    for (const session of sessions) {
      const columnId = getSessionColumn(session.columnId)
      if (!map.has(columnId)) map.set(columnId, [])
      map.get(columnId)!.push(session)
    }
    return map
  }, [sessions, sortedColumns, getSessionColumn])

  const handleAddColumn = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newColumnName.trim()
    if (trimmed) onAddColumn(trimmed)
    setNewColumnName('')
    setAddingColumn(false)
  }

  const cancelAddColumn = () => {
    setNewColumnName('')
    setAddingColumn(false)
  }

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMouseMove = (ev: MouseEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)))
      setWidth(next)
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [width])

  return (
    <div className="kanban-panel" style={{ width }}>
      <div className="kanban-panel-header">
        <span className="kanban-panel-title">Board</span>
        <button className="sidebar-new-btn" onClick={onNewSession} title="New session">
          +
        </button>
      </div>
      <div className="kanban-panel-body">
        {sortedColumns.map((column, index) => (
          <KanbanColumnSection
            key={column.id}
            column={column}
            sessions={sessionsByColumn.get(column.id) ?? []}
            sessionTitles={sessionTitles}
            activeSessionId={activeSessionId}
            waitingSessions={waitingSessions}
            getSessionMetrics={getSessionMetrics}
            isResourceLoading={isResourceLoading}
            onSelectSession={onSelectSession}
            onCloseSession={onCloseSession}
            onResumeSession={onResumeSession}
            onDrop={onMoveSession}
            onRename={onRenameColumn}
            onDelete={onDeleteColumn}
            onMoveUp={onMoveColumnUp}
            onMoveDown={onMoveColumnDown}
            isFirst={index === 0}
            isLast={index === sortedColumns.length - 1}
          />
        ))}
      </div>
      <div className="kanban-panel-footer">
        {addingColumn ? (
          <form className="kanban-add-form" onSubmit={handleAddColumn}>
            <input
              className="kanban-add-form-input"
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') cancelAddColumn() }}
              placeholder="Column name"
              autoFocus
            />
            <button type="submit" className="kanban-add-form-submit">Add</button>
            <button type="button" className="kanban-add-form-cancel" onClick={cancelAddColumn}>×</button>
          </form>
        ) : (
          <button className="kanban-add-column-btn" onClick={() => setAddingColumn(true)}>
            + Add Column
          </button>
        )}
      </div>
      <div className="kanban-resize-handle" onMouseDown={handleResizeStart} />
    </div>
  )
}
