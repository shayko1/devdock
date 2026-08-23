import React, { useEffect, useRef } from 'react'
import type { Task, TaskBlock } from '../../../shared/ipc-types'
import { offsetToTime, timeToOffset, focusElapsedSeconds, SLOT_MINUTES } from '../../../shared/task-time'
import { formatClock, formatElapsed, formatTimeRange } from '../../../shared/task-format'
import { TASK_DRAG_TYPE } from './TaskCard'

export interface BusyInterval {
  startsAt: number
  endsAt: number
  title: string
  allDay: boolean
}

interface Props {
  /** Midnight of the rendered day, local time. */
  day: number
  tasks: Task[]
  blocks: TaskBlock[]
  busy: BusyInterval[]
  now: number
  onSchedule: (taskId: string, startsAt: number, endsAt: number) => void
  onMoveBlock: (blockId: string, startsAt: number, endsAt: number) => void
  onResizeBlock: (blockId: string, startsAt: number, endsAt: number) => void
  onDeleteBlock: (blockId: string) => void
  onToggleFocus: (blockId: string, running: boolean) => void
}

const PX_PER_MINUTE = 1
const DEFAULT_BLOCK_MINUTES = 30
const MS_PER_MINUTE = 60_000
const ONE_DAY_MS = 86_400_000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function DayCanvas({
  day, tasks, blocks, busy, now,
  onSchedule, onMoveBlock, onResizeBlock, onDeleteBlock, onToggleFocus,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const titleFor = (taskId: string) => tasks.find(t => t.id === taskId)?.title ?? 'Untitled'

  const isToday = now >= day && now < day + ONE_DAY_MS
  const nowOffset = timeToOffset(now, PX_PER_MINUTE, day)

  /** Open on the working part of the day rather than at midnight. */
  const scrollToNow = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: Math.max(0, nowOffset - 90), behavior: 'smooth' })
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isToday) return
    el.scrollTop = Math.max(0, timeToOffset(Date.now(), PX_PER_MINUTE, day) - 90)
    // Mount-only: re-running on every tick would fight the user's scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  const offsetWithinGrid = (clientY: number): number => {
    const grid = gridRef.current
    if (!grid) return 0
    return clientY - grid.getBoundingClientRect().top
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE)
    if (!taskId) return

    const minutes = tasks.find(t => t.id === taskId)?.estimateMinutes ?? DEFAULT_BLOCK_MINUTES
    const startsAt = offsetToTime(offsetWithinGrid(e.clientY), PX_PER_MINUTE, day)
    onSchedule(taskId, startsAt, startsAt + minutes * MS_PER_MINUTE)
  }

  /**
   * Shared pointer loop for moving a whole block and for dragging its bottom
   * edge. Deltas are quantised to whole slots so a block can never land
   * off-grid, and nothing is written unless the times actually changed.
   */
  const startPointerDrag = (
    block: TaskBlock,
    mode: 'move' | 'resize',
    e: React.PointerEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const originY = e.clientY
    const originalStart = block.startsAt
    const originalEnd = block.endsAt
    let next = { startsAt: originalStart, endsAt: originalEnd }

    const onMove = (ev: PointerEvent) => {
      const slots = Math.round((ev.clientY - originY) / PX_PER_MINUTE / SLOT_MINUTES)
      const deltaMs = slots * SLOT_MINUTES * MS_PER_MINUTE

      if (mode === 'move') {
        next = { startsAt: originalStart + deltaMs, endsAt: originalEnd + deltaMs }
      } else {
        const minEnd = originalStart + SLOT_MINUTES * MS_PER_MINUTE
        next = { startsAt: originalStart, endsAt: Math.max(minEnd, originalEnd + deltaMs) }
      }
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (next.startsAt === originalStart && next.endsAt === originalEnd) return
      if (mode === 'move') onMoveBlock(block.id, next.startsAt, next.endsAt)
      else onResizeBlock(block.id, next.startsAt, next.endsAt)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const dayDate = new Date(day)
  const scheduledMinutes = blocks.reduce(
    (total, b) => total + (b.endsAt - b.startsAt) / MS_PER_MINUTE, 0
  )

  return (
    <div className="day-canvas">
      <header className="day-canvas-header">
        <div className="day-canvas-date">
          <span className="day-canvas-weekday">{WEEKDAYS[dayDate.getDay()]}</span>
          <span className="day-canvas-daynum">
            {dayDate.getDate()} {MONTHS[dayDate.getMonth()]}
          </span>
        </div>
        <div className="day-canvas-header-right">
          <span className="day-canvas-load" title="Time blocked today">
            {scheduledMinutes > 0 ? `${Math.round(scheduledMinutes / 60 * 10) / 10}h blocked` : 'nothing blocked'}
          </span>
          {isToday && (
            <button
              type="button"
              className="day-canvas-now-btn"
              onClick={scrollToNow}
              title="Scroll to the current time"
            >
              {formatClock(now)}
            </button>
          )}
        </div>
      </header>

      <div
        className="day-canvas-scroll"
        ref={scrollRef}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={handleDrop}
      >
        <div className="day-canvas-grid" ref={gridRef}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div className="day-canvas-hour" data-testid="canvas-hour" key={hour}>
              <span className="day-canvas-hour-label">{String(hour).padStart(2, '0')}</span>
              <span className="day-canvas-halfhour" aria-hidden="true" />
            </div>
          ))}

          {/* Everything before now is behind you — dim it so the remaining day reads clearly. */}
          {isToday && nowOffset > 0 && (
            <div className="day-canvas-past" style={{ height: `${nowOffset}px` }} aria-hidden="true" />
          )}

          {busy.filter(b => !b.allDay).map((interval, i) => (
            <div
              className="day-canvas-busy"
              key={`busy-${i}`}
              style={{
                top: `${timeToOffset(interval.startsAt, PX_PER_MINUTE, day)}px`,
                height: `${Math.max(
                  SLOT_MINUTES * PX_PER_MINUTE,
                  (interval.endsAt - interval.startsAt) / MS_PER_MINUTE * PX_PER_MINUTE
                )}px`,
              }}
            >
              <span className="day-canvas-busy-title">{interval.title}</span>
            </div>
          ))}

          {blocks.map(block => {
            const running = block.focusStartedAt != null
            const height = (block.endsAt - block.startsAt) / MS_PER_MINUTE * PX_PER_MINUTE
            return (
              <div
                className={`day-canvas-block${running ? ' day-canvas-block-running' : ''}`}
                data-testid="canvas-block"
                key={block.id}
                style={{
                  top: `${timeToOffset(block.startsAt, PX_PER_MINUTE, day)}px`,
                  height: `${Math.max(height, 22)}px`,
                }}
                onPointerDown={e => startPointerDrag(block, 'move', e)}
              >
                <div className="day-canvas-block-main">
                  <span className="day-canvas-block-title">{titleFor(block.taskId)}</span>
                  <span className="day-canvas-block-time">
                    {running
                      ? formatElapsed(focusElapsedSeconds(block, now))
                      : formatTimeRange(block.startsAt, block.endsAt)}
                  </span>
                </div>
                <div className="day-canvas-block-actions">
                  <button
                    type="button"
                    className="day-canvas-block-btn"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => onToggleFocus(block.id, running)}
                    aria-label={running ? 'Stop focus' : 'Start focus'}
                    title={running ? 'Stop focus' : 'Start focus'}
                  >
                    {running ? '■' : '▶'}
                  </button>
                  <button
                    type="button"
                    className="day-canvas-block-btn"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => onDeleteBlock(block.id)}
                    aria-label="Unschedule"
                    title="Unschedule"
                  >
                    ×
                  </button>
                </div>
                <div
                  className="day-canvas-block-resize"
                  onPointerDown={e => startPointerDrag(block, 'resize', e)}
                />
              </div>
            )
          })}

          {isToday && (
            <div
              className="day-canvas-now"
              style={{ top: `${nowOffset}px` }}
              data-testid="canvas-now-line"
              aria-hidden="true"
            >
              <span className="day-canvas-now-dot" />
            </div>
          )}
        </div>

        {blocks.length === 0 && (
          <p className="day-canvas-hint">Drag a task here to block out time for it.</p>
        )}
      </div>
    </div>
  )
}
