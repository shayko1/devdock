import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useKanban } from './useKanban'
import type { KanbanColumn } from '../../shared/ipc-types'

function cols(...names: string[]): KanbanColumn[] {
  return names.map((name, order) => ({ id: name.toLowerCase(), name, order }))
}

/** Column names in board order, taken from the last persisted write. */
function savedOrder(): string[] {
  const calls = vi.mocked(window.api.kanbanSaveColumns).mock.calls
  const last = calls[calls.length - 1][0] as KanbanColumn[]
  return [...last].sort((a, b) => a.order - b.order).map(c => c.name)
}

async function mountWith(columns: KanbanColumn[]) {
  vi.mocked(window.api.kanbanGetColumns).mockResolvedValue(columns)
  const hook = renderHook(() => useKanban())
  await waitFor(() => expect(hook.result.current.columns).toHaveLength(columns.length))
  return hook
}

describe('useKanban', () => {
  beforeEach(() => {
    vi.mocked(window.api.kanbanSaveColumns).mockReset().mockResolvedValue(undefined as never)
    vi.mocked(window.api.kanbanGetColumns).mockReset()
  })

  describe('reorderColumn', () => {
    it('drops a middle column past the end and renumbers contiguously', async () => {
      const { result } = await mountWith(cols('Backlog', 'In Progress', 'Done', 'Monitor'))

      act(() => result.current.reorderColumn('done', 'monitor', 'after'))

      expect(savedOrder()).toEqual(['Backlog', 'In Progress', 'Monitor', 'Done'])
      const saved = vi.mocked(window.api.kanbanSaveColumns).mock.calls[0][0] as KanbanColumn[]
      expect(saved.map(c => c.order)).toEqual([0, 1, 2, 3])
    })

    it('drops a column before an earlier one', async () => {
      const { result } = await mountWith(cols('Backlog', 'In Progress', 'Done', 'Monitor'))

      act(() => result.current.reorderColumn('monitor', 'backlog', 'before'))

      expect(savedOrder()).toEqual(['Monitor', 'Backlog', 'In Progress', 'Done'])
    })

    it('ignores a drop that would not change the order', async () => {
      const { result } = await mountWith(cols('Backlog', 'In Progress', 'Done'))

      // "In Progress" already sits directly after "Backlog".
      act(() => result.current.reorderColumn('in progress', 'backlog', 'after'))
      act(() => result.current.reorderColumn('done', 'done', 'before'))

      expect(window.api.kanbanSaveColumns).not.toHaveBeenCalled()
    })

    it('ignores drops referencing an unknown column', async () => {
      const { result } = await mountWith(cols('Backlog', 'Done'))

      act(() => result.current.reorderColumn('ghost', 'done', 'after'))
      act(() => result.current.reorderColumn('done', 'ghost', 'after'))

      expect(window.api.kanbanSaveColumns).not.toHaveBeenCalled()
    })
  })

  describe('toggleColumnManualLoad', () => {
    it('flips the flag on and back off, leaving other columns alone', async () => {
      const { result } = await mountWith(cols('Backlog', 'Done'))

      act(() => result.current.toggleColumnManualLoad('done'))
      let saved = vi.mocked(window.api.kanbanSaveColumns).mock.calls[0][0] as KanbanColumn[]
      expect(saved.find(c => c.id === 'done')?.manualLoad).toBe(true)
      expect(saved.find(c => c.id === 'backlog')?.manualLoad).toBeUndefined()

      act(() => result.current.toggleColumnManualLoad('done'))
      saved = vi.mocked(window.api.kanbanSaveColumns).mock.calls[1][0] as KanbanColumn[]
      expect(saved.find(c => c.id === 'done')?.manualLoad).toBe(false)
    })
  })
})
