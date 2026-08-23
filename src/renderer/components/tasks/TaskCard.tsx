import React from 'react'
import type { Task, TaskBlock } from '../../../shared/ipc-types'
import { formatDuration, formatElapsed, formatTimeRange, dayLabel, isOverdue } from '../../../shared/task-format'
import { focusElapsedSeconds } from '../../../shared/task-time'

interface Props {
  task: Task
  /** The block this task should advertise, from relevantBlockForTask. */
  block?: TaskBlock
  /** How many times this work has been rolled over. */
  pushedCount?: number
  now: number
  onToggleDone: (id: string, done: boolean) => void
  onDelete: (id: string) => void
}

/** Drag payload key, shared with the column and canvas drop handlers. */
export const TASK_DRAG_TYPE = 'application/x-devdock-task-id'

export function TaskCard({ task, block, pushedCount = 0, now, onToggleDone, onDelete }: Props) {
  const done = task.status === 'done'
  const running = block?.focusStartedAt != null
  const overdue = !done && isOverdue(task.dueAt, now)

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  /**
   * The meta row always renders something. A card showing only a title tells
   * you nothing about whether the work is scheduled, sized, or overdue.
   */
  const facts: React.ReactNode[] = []

  if (running && block) {
    facts.push(
      <span className="task-card-running" key="running">
        <span className="task-card-live-dot" aria-hidden="true" />
        {formatElapsed(focusElapsedSeconds(block, now))}
      </span>
    )
  } else if (block) {
    facts.push(
      <span className="task-card-when" key="when">
        {dayLabel(block.startsAt, now)} {formatTimeRange(block.startsAt, block.endsAt)}
      </span>
    )
  } else if (!done && task.status !== 'delegated') {
    facts.push(<span className="task-card-unscheduled" key="unscheduled">Unscheduled</span>)
  }

  if (task.estimateMinutes != null) {
    facts.push(<span key="estimate">{formatDuration(task.estimateMinutes)}</span>)
  }

  if (task.dueAt != null && !done) {
    facts.push(
      <span className={overdue ? 'task-card-overdue' : undefined} key="due">
        {overdue ? 'overdue' : 'due'} {dayLabel(task.dueAt, now)}
      </span>
    )
  }

  if (pushedCount > 0) {
    facts.push(<span className="task-card-pushed" key="pushed">pushed ×{pushedCount}</span>)
  }

  if (task.status === 'delegated') {
    facts.push(<span className="task-card-delegated" key="delegated">delegated</span>)
  }

  return (
    <div
      className={[
        'task-card',
        `task-card-p${task.priority}`,
        done ? 'task-card-done' : '',
        running ? 'task-card-is-running' : '',
      ].filter(Boolean).join(' ')}
      data-testid="task-card"
      draggable={!done}
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
          <span
            className="task-card-priority"
            title={`Priority ${task.priority}`}
            data-testid="task-card-priority"
          >
            P{task.priority}
          </span>
          {facts.map((fact, i) => (
            <React.Fragment key={i}>
              <span className="task-card-sep" aria-hidden="true">·</span>
              {fact}
            </React.Fragment>
          ))}
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
