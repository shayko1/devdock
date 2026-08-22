import { useMemo } from 'react'
import { useTasks } from '../../hooks/useTasks'
import { CaptureBar } from './CaptureBar'
import { TaskCard, TASK_DRAG_TYPE } from './TaskCard'
import { DayCanvas } from './DayCanvas'
import './TasksView.css'

const ONE_DAY_MS = 86_400_000
const DEFAULT_BLOCK_MINUTES = 30

export function TasksView() {
  const {
    tasks, blocks, columns, loading, columnFor,
    createTask, updateTask, deleteTask, setBlocks,
  } = useTasks()

  const todayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [])

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

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns]
  )

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, typeof tasks>()
    for (const col of sortedColumns) map.set(col.id, [])
    for (const task of tasks) {
      const id = columnFor(task.columnId)
      if (!id) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id)!.push(task)
    }
    return map
  }, [tasks, sortedColumns, columnFor])

  if (loading) return <div className="tasks-view tasks-view-loading">Loading tasks…</div>

  return (
    <div className="tasks-view">
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
      <div className="tasks-panes">
      <div className="tasks-board">
        {sortedColumns.map(column => (
          <div
            className="tasks-column"
            key={column.id}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={e => {
              e.preventDefault()
              const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE)
              if (taskId) updateTask(taskId, { columnId: column.id })
            }}
          >
            <div className="tasks-column-header">
              <span className="tasks-column-name" data-testid="task-column-name">
                {column.name}
              </span>
              <span className="tasks-column-count">
                {tasksByColumn.get(column.id)?.length ?? 0}
              </span>
            </div>
            <div className="tasks-column-body">
              {(tasksByColumn.get(column.id) ?? []).map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onToggleDone={(id, done) => updateTask(id, { status: done ? 'done' : 'open' })}
                  onDelete={deleteTask}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
        <DayCanvas
          day={todayStart}
          tasks={tasks}
          blocks={blocks.filter(b => b.startsAt >= todayStart && b.startsAt < todayStart + ONE_DAY_MS)}
          busy={[]}
          onSchedule={schedule}
          onMoveBlock={moveBlock}
          onResizeBlock={moveBlock}
          onDeleteBlock={removeBlock}
        />
      </div>
      {tasks.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">No tasks yet. Capture one to get started.</div>
        </div>
      )}
    </div>
  )
}
