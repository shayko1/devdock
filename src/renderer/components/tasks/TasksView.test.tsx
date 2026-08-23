import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TasksView } from './TasksView'

const columns = [
  { id: 'c1', name: 'Backlog', order: 0 },
  { id: 'c2', name: 'Today', order: 1 },
]

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    tasksGetAll: vi.fn().mockResolvedValue({ version: 1, tasks: [], blocks: [], columns }),
    tasksCreate: vi.fn(),
    tasksUpdate: vi.fn(),
    tasksDelete: vi.fn(),
    tasksSaveColumns: vi.fn(),
    tasksSetBlock: vi.fn(),
    tasksDeleteBlock: vi.fn(),
  }
})

describe('TasksView', () => {
  it('renders a column per stored column, in order', async () => {
    render(<TasksView />)
    await waitFor(() => expect(screen.getByText('Backlog')).toBeTruthy())

    const headings = screen.getAllByTestId('task-column-name').map(el => el.textContent)
    expect(headings).toEqual(['Backlog', 'Today'])
  })

  it('shows an empty state when there are no tasks', async () => {
    render(<TasksView />)
    await waitFor(() => expect(screen.getByText(/no tasks yet/i)).toBeTruthy())
  })
})
