import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskCard } from './TaskCard'
import type { Task, TaskBlock } from '../../../shared/ipc-types'

const NOW = new Date(2026, 7, 22, 12, 0, 0).getTime()
const at = (h: number, m = 0) => new Date(2026, 7, 22, h, m, 0).getTime()

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Review the deck',
    priority: 2,
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeBlock(overrides: Partial<TaskBlock> = {}): TaskBlock {
  return {
    id: 'b1', taskId: 't1', startsAt: at(14), endsAt: at(15), focusSeconds: 0, ...overrides,
  }
}

const handlers = { onToggleDone: vi.fn(), onDelete: vi.fn() }

function renderCard(props: Partial<Parameters<typeof TaskCard>[0]> = {}) {
  return render(
    <TaskCard task={makeTask()} now={NOW} {...handlers} {...props} />
  )
}

describe('TaskCard', () => {
  it('renders the title and a priority class', () => {
    renderCard()
    expect(screen.getByText('Review the deck')).toBeTruthy()
    expect(screen.getByTestId('task-card').className).toContain('task-card-p2')
  })

  it('always shows the priority, including the default P3', () => {
    renderCard({ task: makeTask({ priority: 3 }) })
    expect(screen.getByTestId('task-card-priority').textContent).toBe('P3')
  })

  it('says a task is unscheduled when it has no block', () => {
    renderCard()
    expect(screen.getByText('Unscheduled')).toBeTruthy()
  })

  it('shows when the work is scheduled instead of "unscheduled"', () => {
    renderCard({ block: makeBlock() })
    expect(screen.getByText('Today 14:00')).toBeTruthy()
    expect(screen.queryByText('Unscheduled')).toBeNull()
  })

  it('labels a block on another day relatively', () => {
    renderCard({ block: makeBlock({ startsAt: at(9) + 86_400_000, endsAt: at(10) + 86_400_000 }) })
    expect(screen.getByText('Tomorrow 09:00')).toBeTruthy()
  })

  it('shows a live elapsed timer while the block is running', () => {
    renderCard({ block: makeBlock({ focusSeconds: 60, focusStartedAt: NOW - 63_000 }) })
    expect(screen.getByText('2:03')).toBeTruthy()
    expect(screen.getByTestId('task-card').className).toContain('task-card-is-running')
  })

  it('shows the estimate', () => {
    renderCard({ task: makeTask({ estimateMinutes: 90 }) })
    expect(screen.getByText('1h 30m')).toBeTruthy()
  })

  it('flags an overdue due date', () => {
    renderCard({ task: makeTask({ dueAt: at(9) }) })
    expect(screen.getByText('overdue Today')).toBeTruthy()
  })

  it('shows a future due date without the overdue wording', () => {
    renderCard({ task: makeTask({ dueAt: at(9) + 86_400_000 }) })
    expect(screen.getByText('due Tomorrow')).toBeTruthy()
  })

  it('reports how many times the work has been pushed', () => {
    renderCard({ pushedCount: 3 })
    expect(screen.getByText('pushed ×3')).toBeTruthy()
  })

  it('calls onToggleDone when the checkbox is clicked', async () => {
    const onToggleDone = vi.fn()
    renderCard({ onToggleDone })

    await userEvent.click(screen.getByRole('checkbox'))
    expect(onToggleDone).toHaveBeenCalledWith('t1', true)
  })

  it('marks the card done and stops it being draggable', () => {
    renderCard({ task: makeTask({ status: 'done' }) })
    const card = screen.getByTestId('task-card')

    expect(card.className).toContain('task-card-done')
    expect(card.getAttribute('draggable')).toBe('false')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('hides due and unscheduled noise once the task is done', () => {
    renderCard({ task: makeTask({ status: 'done', dueAt: at(9) }) })
    expect(screen.queryByText(/overdue/)).toBeNull()
    expect(screen.queryByText('Unscheduled')).toBeNull()
  })

  it('is draggable while open', () => {
    renderCard()
    expect(screen.getByTestId('task-card').getAttribute('draggable')).toBe('true')
  })

  it('calls onDelete from the delete button', async () => {
    const onDelete = vi.fn()
    renderCard({ onDelete })

    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith('t1')
  })

  it('shows a delegated marker for delegated tasks', () => {
    renderCard({ task: makeTask({ status: 'delegated' }) })
    expect(screen.getByText('delegated')).toBeTruthy()
  })
})
