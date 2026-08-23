import type { Task, TaskBlock } from '../../../shared/ipc-types'
import { focusElapsedSeconds } from '../../../shared/task-time'
import { formatElapsed, formatTimeRange } from '../../../shared/task-format'

interface Props {
  block: TaskBlock
  task: Task | undefined
  now: number
  onStop: (blockId: string) => void
  onDone: (taskId: string) => void
}

/**
 * Shown only while a block's timer is running. The elapsed value is derived
 * from the block's stored start stamp, never counted up in the renderer, so it
 * survives a reload, a second window, and a closed laptop.
 */
export function FocusStrip({ block, task, now, onStop, onDone }: Props) {
  const elapsed = focusElapsedSeconds(block, now)

  return (
    <div className="focus-strip" role="status" aria-live="off">
      <span className="focus-strip-dot" aria-hidden="true" />
      <span className="focus-strip-label">Focusing</span>
      <span className="focus-strip-title">{task?.title ?? 'Untitled'}</span>
      <span className="focus-strip-slot">{formatTimeRange(block.startsAt, block.endsAt)}</span>

      <span className="focus-strip-timer" aria-label={`${Math.floor(elapsed / 60)} minutes elapsed`}>
        {formatElapsed(elapsed)}
      </span>

      <button type="button" className="focus-strip-btn" onClick={() => onStop(block.id)}>
        Stop
      </button>
      {task && (
        <button
          type="button"
          className="focus-strip-btn focus-strip-btn-primary"
          onClick={() => onDone(task.id)}
        >
          Finish task
        </button>
      )}
    </div>
  )
}
