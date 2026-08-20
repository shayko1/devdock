import { randomUUID } from 'crypto'
import { loadState, saveState } from './store'
import { activeSessions } from './session-history'
import type { KanbanColumn } from '../shared/ipc-types'

const DEFAULT_COLUMNS: Array<Pick<KanbanColumn, 'name' | 'order'>> = [
  { name: 'Backlog', order: 0 },
  { name: 'In Progress', order: 1 },
  { name: 'Done', order: 2 },
  { name: 'Monitor', order: 3 },
]

export class KanbanManager {
  getColumns(): KanbanColumn[] {
    const state = loadState()
    if (state.kanbanColumns && state.kanbanColumns.length > 0) {
      return state.kanbanColumns
    }

    const columns: KanbanColumn[] = DEFAULT_COLUMNS.map(c => ({ id: randomUUID(), ...c }))
    saveState({ ...state, kanbanColumns: columns })
    return columns
  }

  saveColumns(columns: KanbanColumn[]): void {
    const state = loadState()
    const oldIds = new Set((state.kanbanColumns || []).map(c => c.id))
    const newIds = new Set(columns.map(c => c.id))
    const deletedIds = [...oldIds].filter(id => !newIds.has(id))

    saveState({ ...state, kanbanColumns: columns })

    if (deletedIds.length === 0) return

    const deletedSet = new Set(deletedIds)
    for (const session of activeSessions.getAll()) {
      if (session.columnId && deletedSet.has(session.columnId)) {
        activeSessions.set({ ...session, columnId: undefined })
      }
    }
  }

  moveSession(sessionId: string, columnId: string): void {
    const session = activeSessions.getAll().find(s => s.id === sessionId)
    if (!session) return
    activeSessions.set({ ...session, columnId })
  }

  getFirstColumnId(): string {
    const columns = this.getColumns()
    return [...columns].sort((a, b) => a.order - b.order)[0].id
  }
}

export const kanbanManager = new KanbanManager()
