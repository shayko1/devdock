import React, { useRef } from 'react'
import type { Task, TaskBlock } from '../../../shared/ipc-types'
import { offsetToTime, timeToOffset, SLOT_MINUTES } from '../../../shared/task-time'
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
  onSchedule: (taskId: string, startsAt: number, endsAt: number) => void
  onMoveBlock: (blockId: string, startsAt: number, endsAt: number) => void
  onResizeBlock: (blockId: string, startsAt: number, endsAt: number) => void
  onDeleteBlock: (blockId: string) => void
}

const PX_PER_MINUTE = 1
const DEFAULT_BLOCK_MINUTES = 30
const MS_PER_MINUTE = 60_000

export function DayCanvas({
  day, tasks, blocks, busy,
  onSchedule, onMoveBlock, onResizeBlock, onDeleteBlock,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const titleFor = (taskId: string) => tasks.find(t => t.id === taskId)?.title ?? 'Untitled'

  const offsetWithinGrid = (clientY: number): number => {
    const grid = gridRef.current
    if (!grid) return 0
    return clientY - grid.getBoundingClientRect().top + grid.scrollTop
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

  return (
    <div className="day-canvas">
      <div
        className="day-canvas-grid"
        ref={gridRef}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={handleDrop}
      >
        {Array.from({ length: 24 }, (_, hour) => (
          <div className="day-canvas-hour" data-testid="canvas-hour" key={hour}>
            <span className="day-canvas-hour-label">
              {String(hour).padStart(2, '0')}:00
            </span>
          </div>
        ))}

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

        {blocks.map(block => (
          <div
            className="day-canvas-block"
            data-testid="canvas-block"
            key={block.id}
            style={{
              top: `${timeToOffset(block.startsAt, PX_PER_MINUTE, day)}px`,
              height: `${(block.endsAt - block.startsAt) / MS_PER_MINUTE * PX_PER_MINUTE}px`,
            }}
            onPointerDown={e => startPointerDrag(block, 'move', e)}
          >
            <span className="day-canvas-block-title">{titleFor(block.taskId)}</span>
            <button
              type="button"
              className="day-canvas-block-remove"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => onDeleteBlock(block.id)}
              aria-label="Unschedule"
            >
              ×
            </button>
            <div
              className="day-canvas-block-resize"
              onPointerDown={e => startPointerDrag(block, 'resize', e)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
