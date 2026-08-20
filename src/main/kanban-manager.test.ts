/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppState } from '../shared/types'
import type { ActiveSession } from '../shared/ipc-types'

vi.mock('./store', () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}))

vi.mock('./session-history', () => ({
  activeSessions: {
    getAll: vi.fn(),
    set: vi.fn(),
  },
}))

let uuidCounter = 0
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => `test-uuid-${uuidCounter++}`),
}))

import { loadState, saveState } from './store'
import { activeSessions } from './session-history'
import { KanbanManager } from './kanban-manager'

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    projects: [],
    tags: [],
    scanPath: '/tmp',
    ...overrides,
  }
}

function makeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'session-1',
    claudeSessionId: null,
    folderName: 'foo',
    folderPath: '/foo',
    worktreePath: null,
    branchName: null,
    ...overrides,
  }
}

describe('KanbanManager', () => {
  let manager: KanbanManager

  beforeEach(() => {
    vi.clearAllMocks()
    uuidCounter = 0
    manager = new KanbanManager()
  })

  describe('getColumns', () => {
    it('returns default 4 columns when state has none, and saves them', () => {
      vi.mocked(loadState).mockReturnValue(makeState())

      const result = manager.getColumns()

      expect(result).toHaveLength(4)
      expect(result.map(c => c.name)).toEqual(['Backlog', 'In Progress', 'Done', 'Monitor'])
      expect(result.map(c => c.order)).toEqual([0, 1, 2, 3])
      expect(result.every(c => typeof c.id === 'string' && c.id.length > 0)).toBe(true)
      expect(saveState).toHaveBeenCalledWith(
        expect.objectContaining({ kanbanColumns: result })
      )
    })

    it('returns existing columns from state without re-saving', () => {
      const existing = [
        { id: 'col-1', name: 'Custom', order: 0 },
      ]
      vi.mocked(loadState).mockReturnValue(makeState({ kanbanColumns: existing }))

      const result = manager.getColumns()

      expect(result).toEqual(existing)
      expect(saveState).not.toHaveBeenCalled()
    })
  })

  describe('saveColumns', () => {
    it('persists columns to state', () => {
      const newColumns = [{ id: 'col-1', name: 'Backlog', order: 0 }]
      vi.mocked(loadState).mockReturnValue(makeState({ kanbanColumns: [] }))
      vi.mocked(activeSessions.getAll).mockReturnValue([])

      manager.saveColumns(newColumns)

      expect(saveState).toHaveBeenCalledWith(
        expect.objectContaining({ kanbanColumns: newColumns })
      )
    })

    it('clears columnId on sessions referencing deleted columns', () => {
      const oldColumns = [
        { id: 'col-1', name: 'Backlog', order: 0 },
        { id: 'col-2', name: 'Done', order: 1 },
      ]
      const newColumns = [
        { id: 'col-1', name: 'Backlog', order: 0 },
      ]
      vi.mocked(loadState).mockReturnValue(makeState({ kanbanColumns: oldColumns }))

      const sessionOnDeletedCol = makeSession({ id: 'session-1', columnId: 'col-2' })
      const sessionOnKeptCol = makeSession({ id: 'session-2', columnId: 'col-1' })
      vi.mocked(activeSessions.getAll).mockReturnValue([sessionOnDeletedCol, sessionOnKeptCol])

      manager.saveColumns(newColumns)

      expect(activeSessions.set).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', columnId: undefined })
      )
      expect(activeSessions.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-2' })
      )
    })
  })

  describe('moveSession', () => {
    it('updates columnId on target session', () => {
      const session = makeSession({ id: 'session-1', columnId: 'col-1' })
      vi.mocked(activeSessions.getAll).mockReturnValue([session])

      manager.moveSession('session-1', 'col-2')

      expect(activeSessions.set).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1', columnId: 'col-2' })
      )
    })

    it('does nothing when session is not found', () => {
      vi.mocked(activeSessions.getAll).mockReturnValue([])

      manager.moveSession('nonexistent', 'col-2')

      expect(activeSessions.set).not.toHaveBeenCalled()
    })
  })

  describe('getFirstColumnId', () => {
    it('returns the id of the lowest-order column', () => {
      const columns = [
        { id: 'col-3', name: 'Monitor', order: 3 },
        { id: 'col-1', name: 'Backlog', order: 0 },
        { id: 'col-2', name: 'In Progress', order: 1 },
      ]
      vi.mocked(loadState).mockReturnValue(makeState({ kanbanColumns: columns }))

      const result = manager.getFirstColumnId()

      expect(result).toBe('col-1')
    })
  })
})
