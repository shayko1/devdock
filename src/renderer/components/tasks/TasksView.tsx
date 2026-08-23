import { useEffect, useMemo, useState } from 'react'
import { useTasks } from '../../hooks/useTasks'
import type { Task } from '../../../shared/ipc-types'
import { sweepDay, pushCount, type StaleBlock } from '../../../shared/task-rollover'
import { relevantBlockForTask, runningBlock } from '../../../shared/task-time'
import { SweepModal, type SweepAction } from './SweepModal'
import { CaptureBar } from './CaptureBar'
import { FocusStrip } from './FocusStrip'
import { TaskCard, TASK_DRAG_TYPE } from './TaskCard'
import { DayCanvas } from './DayCanvas'
import './TasksView.css'

const ONE_DAY_MS = 86_400_000
const DEFAULT_BLOCK_MINUTES = 30
/** Drives the now-line, the focus timer, and relative day labels. */
const TICK_MS = 1000

export function TasksView() {
  const {
    tasks, blocks, columns, loading, columnFor,
    createTask, updateTask, deleteTask, setBlocks,
  } = useTasks()

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const todayStart = useMemo(() => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
    // Recomputed only when the day rolls over, not every tick.
  }, [Math.floor(now / ONE_DAY_MS)]) // eslint-disable-line react-hooks/exhaustive-deps

  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [sweeping, setSweeping] = useState(false)

  const schedule = async (taskId: string, startsAt: number, endsAt: number) => {
    const created = await window.api.tasksSetBlock({ taskId, startsAt, endsAt })
    setBlocks(prev => [...prev, created])
  }

  const moveBlock = async (id: string, startsAt: number, endsAt: number) => {
    const block = blocks.find(b => b.id === id)
    if (!block) return
    const updated = await window.api.tasksSetBlock({ id, taskId: block.taskId, startsAt, endsAt })
    setBlocks(prev => prev.map(b => (b.id === id ? updated : b)))
  }

  const removeBlock = async (id: string) => {
    if (await window.api.tasksDeleteBlock(id)) {
      setBlocks(prev => prev.filter(b => b.id !== id))
    }
  }

  /**
   * Starting a block stops any other in the same write, so the whole block
   * list is refetched rather than patching one entry.
   */
  const toggleFocus = async (blockId: string, running: boolean) => {
    await window.api.tasksFocus(blockId, running ? 'stop' : 'start')
    const file = await window.api.tasksGetAll()
    setBlocks(file.blocks)
  }

  const sweep = useMemo(
    () => sweepDay({ tasks, blocks, now }),
    // Deliberately keyed off the minute, not the tick — recomputing every
    // second would rebuild the modal's contents under the user's cursor.
    [tasks, blocks, Math.floor(now / 60_000)] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const pushCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const block of blocks) {
      const count = pushCount(block.id, blocks)
      if (count > 0) out[block.taskId] = Math.max(out[block.taskId] ?? 0, count)
    }
    return out
  }, [blocks])

  const applySweep = async (item: StaleBlock, action: SweepAction) => {
    if (action === 'rollover') {
      const created = await window.api.tasksSetBlock({
        taskId: item.task.id,
        startsAt: item.suggestedStartsAt,
        endsAt: item.suggestedEndsAt,
        rolledFrom: item.block.id,
      })
      setBlocks(prev => [...prev, created])
    } else {
      await updateTask(item.task.id, { status: action === 'done' ? 'done' : 'dropped' })
    }
  }

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns]
  )

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const col of sortedColumns) map.set(col.id, [])
    for (const task of tasks) {
      const id = columnFor(task.columnId)
      if (!id) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id)!.push(task)
    }
    return map
  }, [tasks, sortedColumns, columnFor])

  const focused = runningBlock(blocks)
  const dayBlocks = blocks.filter(
    b => b.startsAt >= todayStart && b.startsAt < todayStart + ONE_DAY_MS
  )

  if (loading) return <div className="tasks-view tasks-view-loading">Loading tasks…</div>

  const isFirstRun = tasks.length === 0

  return (
    <div className="tasks-view">
      <div className="tasks-toolbar">
        <CaptureBar
          onCapture={async parsed => {
            const task = await createTask({
              title: parsed.title,
              priority: parsed.priority,
              estimateMinutes: parsed.estimateMinutes,
              dueAt: parsed.dueAt,
              status: 'open',
            })
            if (parsed.scheduleAt) {
              const minutes = parsed.estimateMinutes ?? DEFAULT_BLOCK_MINUTES
              await schedule(task.id, parsed.scheduleAt, parsed.scheduleAt + minutes * 60_000)
            }
          }}
        />
        {sweep.stale.length > 0 && (
          <button type="button" className="tasks-sweep-btn" onClick={() => setSweeping(true)}>
            {sweep.stale.length} unfinished
          </button>
        )}
      </div>

      {focused && (
        <FocusStrip
          block={focused}
          task={tasks.find(t => t.id === focused.taskId)}
          now={now}
          onStop={id => toggleFocus(id, true)}
          onDone={async taskId => {
            await toggleFocus(focused.id, true)
            await updateTask(taskId, { status: 'done' })
          }}
        />
      )}

      {sweeping && (
        <SweepModal
          items={sweep.stale}
          pushCounts={Object.fromEntries(sweep.stale.map(s => [s.block.id, pushCount(s.block.id, blocks)]))}
          onApply={applySweep}
          onClose={() => setSweeping(false)}
        />
      )}

      <div className="tasks-panes">
        <div className="tasks-board">
          {sortedColumns.map((column, index) => {
            const columnTasks = tasksByColumn.get(column.id) ?? []
            return (
              <section
                className={`tasks-column${dropTarget === column.id ? ' is-drop-target' : ''}`}
                key={column.id}
                onDragOver={e => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dropTarget !== column.id) setDropTarget(column.id)
                }}
                onDragLeave={() => setDropTarget(prev => (prev === column.id ? null : prev))}
                onDrop={e => {
                  e.preventDefault()
                  setDropTarget(null)
                  const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE)
                  if (taskId) updateTask(taskId, { columnId: column.id })
                }}
              >
                <div className="tasks-column-header">
                  <span className="tasks-column-name" data-testid="task-column-name">
                    {column.name}
                  </span>
                  <span className="tasks-column-count">{columnTasks.length}</span>
                </div>

                <div className="tasks-column-body">
                  {columnTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      block={relevantBlockForTask(task.id, blocks, now)}
                      pushedCount={pushCounts[task.id] ?? 0}
                      now={now}
                      onToggleDone={(id, done) => updateTask(id, { status: done ? 'done' : 'open' })}
                      onDelete={deleteTask}
                    />
                  ))}

                  {columnTasks.length === 0 && (
                    <p className="tasks-column-empty">
                      {isFirstRun && index === 0
                        ? 'Type a task above to start. Try “p1 Ship the deck tomorrow 2pm 45m”.'
                        : 'Drop a task here'}
                    </p>
                  )}
                </div>
              </section>
            )
          })}
        </div>

        <DayCanvas
          day={todayStart}
          tasks={tasks}
          blocks={dayBlocks}
          busy={[]}
          now={now}
          onSchedule={schedule}
          onMoveBlock={moveBlock}
          onResizeBlock={moveBlock}
          onDeleteBlock={removeBlock}
          onToggleFocus={toggleFocus}
        />
      </div>
    </div>
  )
}
