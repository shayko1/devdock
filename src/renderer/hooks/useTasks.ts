import { useState, useEffect, useCallback, useRef } from 'react'
import type { KanbanColumn, Task, TaskBlock, TaskCreate } from '../../shared/ipc-types'

/**
 * Task board state. The main process is authoritative — every mutation goes
 * over IPC and persists before local state is updated, so a reload always
 * matches what is on disk.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [blocks, setBlocks] = useState<TaskBlock[]>([])
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [loading, setLoading] = useState(true)

  const columnsRef = useRef(columns)
  columnsRef.current = columns

  useEffect(() => {
    let cancelled = false
    window.api.tasksGetAll().then(file => {
      if (cancelled) return
      setTasks(file.tasks)
      setBlocks(file.blocks)
      setColumns(file.columns)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const createTask = useCallback(async (input: TaskCreate) => {
    const task = await window.api.tasksCreate(input)
    setTasks(prev => [...prev, task])
    return task
  }, [])

  const updateTask = useCallback(async (id: string, partial: Partial<Task>) => {
    const updated = await window.api.tasksUpdate(id, partial)
    if (updated) setTasks(prev => prev.map(t => (t.id === id ? updated : t)))
    return updated
  }, [])

  const deleteTask = useCallback(async (id: string) => {
    const ok = await window.api.tasksDelete(id)
    if (ok) {
      setTasks(prev => prev.filter(t => t.id !== id))
      setBlocks(prev => prev.filter(b => b.taskId !== id))
    }
    return ok
  }, [])

  const saveColumns = useCallback(async (next: KanbanColumn[]) => {
    setColumns(next)
    const saved = await window.api.tasksSaveColumns(next)
    setColumns(saved)
  }, [])

  /** Resolves a possibly-dangling columnId to a real one, mirroring useKanban. */
  const columnFor = useCallback((columnId?: string) => {
    if (columnId && columnsRef.current.some(c => c.id === columnId)) return columnId
    return [...columnsRef.current].sort((a, b) => a.order - b.order)[0]?.id
  }, [])

  return {
    tasks, blocks, columns, loading,
    createTask, updateTask, deleteTask, saveColumns, columnFor,
    setBlocks,
  }
}
