import { useMemo } from 'react'
import { useTasks } from '../../hooks/useTasks'
import { CaptureBar } from './CaptureBar'
import './TasksView.css'

export function TasksView() {
  const { tasks, columns, loading, columnFor, createTask } = useTasks()

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
        onCapture={parsed => {
          // parsed.scheduleAt is honoured once the day canvas exists (Task 8);
          // until then a captured time only sets the task's due date.
          createTask({
            title: parsed.title,
            priority: parsed.priority,
            estimateMinutes: parsed.estimateMinutes,
            dueAt: parsed.dueAt,
            status: 'open',
          })
        }}
      />
      <div className="tasks-board">
        {sortedColumns.map(column => (
          <div className="tasks-column" key={column.id}>
            <div className="tasks-column-header">
              <span className="tasks-column-name" data-testid="task-column-name">
                {column.name}
              </span>
              <span className="tasks-column-count">
                {tasksByColumn.get(column.id)?.length ?? 0}
              </span>
            </div>
          </div>
        ))}
      </div>
      {tasks.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">No tasks yet. Capture one to get started.</div>
        </div>
      )}
    </div>
  )
}
