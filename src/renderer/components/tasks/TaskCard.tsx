import React from 'react'
import type { Task } from '../../../shared/ipc-types'

interface Props {
  task: Task
  onToggleDone: (id: string, done: boolean) => void
  onDelete: (id: string) => void
}

/** Drag payload key, shared with the column and canvas drop handlers. */
export const TASK_DRAG_TYPE = 'application/x-devdock-task-id'

export function TaskCard({ task, onToggleDone, onDelete }: Props) {
  const done = task.status === 'done'

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={`task-card task-card-p${task.priority}${done ? ' task-card-done' : ''}`}
      data-testid="task-card"
      draggable
      onDragStart={handleDragStart}
    >
      <input
        type="checkbox"
        className="task-card-check"
        checked={done}
        onChange={e => onToggleDone(task.id, e.target.checked)}
        aria-label={`Mark "${task.title}" done`}
      />
      <div className="task-card-body">
        <div className="task-card-title">{task.title}</div>
        <div className="task-card-meta">
          {task.estimateMinutes != null && <span>{task.estimateMinutes}m</span>}
          {task.dueAt != null && <span>due {new Date(task.dueAt).toLocaleDateString()}</span>}
          {task.status === 'delegated' && <span className="task-card-delegated">delegated</span>}
        </div>
      </div>
      <button
        type="button"
        className="task-card-delete"
        onClick={() => onDelete(task.id)}
        aria-label={`Delete "${task.title}"`}
      >
        ×
      </button>
    </div>
  )
}
