import { useState, useEffect, useCallback, useRef } from 'react'
import { KanbanColumn } from '../../shared/ipc-types'

export function useKanban() {
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  useEffect(() => {
    window.api.kanbanGetColumns().then(setColumns)
  }, [])

  const persistColumns = useCallback((next: KanbanColumn[]) => {
    setColumns(next)
    window.api.kanbanSaveColumns(next)
  }, [])

  const addColumn = useCallback((name: string) => {
    const maxOrder = columnsRef.current.reduce((max, c) => Math.max(max, c.order), -1)
    const next = [...columnsRef.current, { id: crypto.randomUUID(), name, order: maxOrder + 1 }]
    persistColumns(next)
  }, [persistColumns])

  const renameColumn = useCallback((columnId: string, name: string) => {
    const next = columnsRef.current.map((c) => (c.id === columnId ? { ...c, name } : c))
    persistColumns(next)
  }, [persistColumns])

  const deleteColumn = useCallback((columnId: string) => {
    if (columnsRef.current.length <= 1) return
    const next = columnsRef.current
      .filter((c) => c.id !== columnId)
      .sort((a, b) => a.order - b.order)
      .map((c, i) => ({ ...c, order: i }))
    persistColumns(next)
  }, [persistColumns])

  const moveColumnUp = useCallback((columnId: string) => {
    const sorted = [...columnsRef.current].sort((a, b) => a.order - b.order)
    const index = sorted.findIndex((c) => c.id === columnId)
    if (index <= 0) return
    const prevOrder = sorted[index - 1].order
    sorted[index - 1].order = sorted[index].order
    sorted[index].order = prevOrder
    persistColumns(sorted)
  }, [persistColumns])

  const moveColumnDown = useCallback((columnId: string) => {
    const sorted = [...columnsRef.current].sort((a, b) => a.order - b.order)
    const index = sorted.findIndex((c) => c.id === columnId)
    if (index === -1 || index >= sorted.length - 1) return
    const nextOrder = sorted[index + 1].order
    sorted[index + 1].order = sorted[index].order
    sorted[index].order = nextOrder
    persistColumns(sorted)
  }, [persistColumns])

  /**
   * Drop `draggedId` immediately before or after `targetId` and renumber the
   * whole list, so drag-reordering can span any distance in one gesture
   * (unlike the one-step moveColumnUp/Down).
   */
  const reorderColumn = useCallback(
    (draggedId: string, targetId: string, place: 'before' | 'after') => {
      if (draggedId === targetId) return
      const sorted = [...columnsRef.current].sort((a, b) => a.order - b.order)
      const from = sorted.findIndex((c) => c.id === draggedId)
      if (from === -1 || !sorted.some((c) => c.id === targetId)) return

      const next = [...sorted]
      const [moved] = next.splice(from, 1)
      // Re-find the target after the removal so 'after' lands past it either way.
      const anchor = next.findIndex((c) => c.id === targetId)
      next.splice(place === 'before' ? anchor : anchor + 1, 0, moved)

      if (next.every((c, i) => c.id === sorted[i].id)) return
      persistColumns(next.map((c, i) => ({ ...c, order: i })))
    },
    [persistColumns]
  )

  /** Toggle whether sessions parked in this column are skipped at startup. */
  const toggleColumnManualLoad = useCallback((columnId: string) => {
    const next = columnsRef.current.map((c) =>
      c.id === columnId ? { ...c, manualLoad: !c.manualLoad } : c
    )
    persistColumns(next)
  }, [persistColumns])

  const getSessionColumn = useCallback((columnId?: string) => {
    if (columnId && columnsRef.current.some((c) => c.id === columnId)) return columnId
    const sorted = [...columnsRef.current].sort((a, b) => a.order - b.order)
    return sorted[0]?.id
  }, [])

  return {
    columns,
    addColumn,
    renameColumn,
    deleteColumn,
    moveColumnUp,
    moveColumnDown,
    reorderColumn,
    toggleColumnManualLoad,
    getSessionColumn
  }
}
