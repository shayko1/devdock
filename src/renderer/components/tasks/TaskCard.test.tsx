import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskCard } from './TaskCard'
import type { Task } from '../../../shared/ipc-types'

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

describe('TaskCard', () => {
  it('renders the title and a priority class', () => {
    render(<TaskCard task={makeTask()} onToggleDone={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Review the deck')).toBeTruthy()
    expect(screen.getByTestId('task-card').className).toContain('task-card-p2')
  })

  it('shows the estimate when present', () => {
    render(<TaskCard task={makeTask({ estimateMinutes: 45 })} onToggleDone={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('45m')).toBeTruthy()
  })

  it('calls onToggleDone when the checkbox is clicked', async () => {
    const onToggleDone = vi.fn()
    render(<TaskCard task={makeTask()} onToggleDone={onToggleDone} onDelete={vi.fn()} />)

    await userEvent.click(screen.getByRole('checkbox'))
    expect(onToggleDone).toHaveBeenCalledWith('t1', true)
  })

  it('marks the card done when the task is done', () => {
    render(<TaskCard task={makeTask({ status: 'done' })} onToggleDone={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByTestId('task-card').className).toContain('task-card-done')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('is draggable', () => {
    render(<TaskCard task={makeTask()} onToggleDone={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByTestId('task-card').getAttribute('draggable')).toBe('true')
  })

  it('calls onDelete from the delete button', async () => {
    const onDelete = vi.fn()
    render(<TaskCard task={makeTask()} onToggleDone={vi.fn()} onDelete={onDelete} />)

    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith('t1')
  })

  it('shows a delegated marker for delegated tasks', () => {
    render(<TaskCard task={makeTask({ status: 'delegated' })} onToggleDone={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('delegated')).toBeTruthy()
  })
})
