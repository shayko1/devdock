import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KanbanColumnSection, COLUMN_DRAG_TYPE, type KanbanSession } from './KanbanColumn'
import type { KanbanColumn } from '../../shared/ipc-types'

const COLUMN: KanbanColumn = { id: 'done', name: 'Done', order: 2 }

const HEADER_TITLE = 'Drag to reorder · double-click to rename · right-click for options'

function session(overrides: Partial<KanbanSession> = {}): KanbanSession {
  return { id: 's1', folderName: 'devdock', branchName: null, ...overrides }
}

/** A session card being dragged: text/plain only, like KanbanCard sets. */
function cardDrag(sessionId: string) {
  return {
    types: ['text/plain'],
    getData: (type: string) => (type === 'text/plain' ? sessionId : ''),
    setData: vi.fn(),
    dropEffect: '',
    effectAllowed: '',
  }
}

/** A column being dragged for reordering: carries the column type too. */
function columnDrag(columnId: string) {
  return {
    types: [COLUMN_DRAG_TYPE, 'text/plain'],
    getData: (type: string) => (type === COLUMN_DRAG_TYPE ? columnId : ''),
    setData: vi.fn(),
    dropEffect: '',
    effectAllowed: '',
  }
}

function renderColumn(props: Partial<React.ComponentProps<typeof KanbanColumnSection>> = {}) {
  const handlers = {
    onDrop: vi.fn(),
    onReorder: vi.fn(),
    onSelectSession: vi.fn(),
    onCloseSession: vi.fn(),
    onResumeSession: vi.fn(),
    onLoadSession: vi.fn(),
    onParkSession: vi.fn(),
    onRenameSession: vi.fn(),
    onRegenerateSessionTitle: vi.fn(),
    onResetSessionTitle: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onToggleManualLoad: vi.fn(),
  }
  render(
    <KanbanColumnSection
      column={COLUMN}
      sessions={[]}
      activeSessionId={null}
      waitingSessions={new Set()}
      getSessionMetrics={() => undefined}
      isResourceLoading={false}
      generatingTitleIds={new Set()}
      isFirst={false}
      isLast={false}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

/** Fold the column shut via its toggle, as a user would. */
function collapse() {
  fireEvent.click(screen.getByTitle('Collapse'))
  expect(screen.getByTitle('Expand')).toBeInTheDocument()
}

describe('KanbanColumnSection — dropping onto a collapsed column', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a session card dropped on a collapsed column', () => {
    const { onDrop } = renderColumn()
    collapse()

    const header = screen.getByTitle(HEADER_TITLE)
    const dataTransfer = cardDrag('s1')
    fireEvent.dragOver(header, { dataTransfer })
    fireEvent.drop(header, { dataTransfer })

    expect(onDrop).toHaveBeenCalledWith('s1', 'done')
  })

  it('stays collapsed after the drop', () => {
    renderColumn()
    collapse()

    const header = screen.getByTitle(HEADER_TITLE)
    fireEvent.drop(header, { dataTransfer: cardDrag('s1') })

    // Still folded — filing a card away must not unfold the column.
    expect(screen.getByTitle('Expand')).toBeInTheDocument()
  })

  it('does not mistake a column reorder drag for a card drop', () => {
    const { onDrop, onReorder } = renderColumn()
    collapse()

    const header = screen.getByTitle(HEADER_TITLE)
    const dataTransfer = columnDrag('backlog')
    fireEvent.dragOver(header, { dataTransfer })
    fireEvent.drop(header, { dataTransfer })

    expect(onDrop).not.toHaveBeenCalled()
    // It bubbles to the wrapper and reorders instead.
    expect(onReorder).toHaveBeenCalledWith('backlog', 'done', expect.any(String))
  })

  it('still accepts drops in the body when expanded', () => {
    const { onDrop } = renderColumn({ sessions: [session()] })

    const body = document.querySelector('.kanban-column-body')!
    const dataTransfer = cardDrag('s1')
    fireEvent.dragOver(body, { dataTransfer })
    fireEvent.drop(body, { dataTransfer })

    expect(onDrop).toHaveBeenCalledWith('s1', 'done')
  })

  it('ignores a card dropped on an expanded header, leaving the body to handle it', () => {
    const { onDrop } = renderColumn()

    const header = screen.getByTitle(HEADER_TITLE)
    fireEvent.drop(header, { dataTransfer: cardDrag('s1') })

    expect(onDrop).not.toHaveBeenCalled()
  })
})
