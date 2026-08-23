import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TasksView } from './TasksView'
import type { Task, TaskBlock } from '../../../shared/ipc-types'

const columns = [
  { id: 'c1', name: 'Backlog', order: 0 },
  { id: 'c2', name: 'Today', order: 1 },
]

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'Review the deck', priority: 3, status: 'open',
    columnId: 'c1', createdAt: 0, updatedAt: 0, ...overrides,
  }
}

function mockApi(file: { tasks: Task[]; blocks: TaskBlock[] }) {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    tasksGetAll: vi.fn().mockResolvedValue({ version: 1, columns, ...file }),
    tasksCreate: vi.fn(),
    tasksUpdate: vi.fn(),
    tasksDelete: vi.fn(),
    tasksSaveColumns: vi.fn(),
    tasksSetBlock: vi.fn(),
    tasksDeleteBlock: vi.fn(),
    tasksFocus: vi.fn(),
  }
}

beforeEach(() => mockApi({ tasks: [], blocks: [] }))

describe('TasksView', () => {
  it('renders a column per stored column, in order', async () => {
    render(<TasksView />)
    await waitFor(() => expect(screen.getByText('Backlog')).toBeTruthy())

    const headings = screen.getAllByTestId('task-column-name').map(el => el.textContent)
    expect(headings).toEqual(['Backlog', 'Today'])
  })

  it('invites a first task in the first column rather than stranding an empty state', async () => {
    render(<TasksView />)
    await waitFor(() => expect(screen.getByText(/type a task above to start/i)).toBeTruthy())

    // Every other column still reads as a drop target, so the board looks intentional.
    expect(screen.getByText('Drop a task here')).toBeTruthy()
  })

  it('prompts a drop in empty columns once tasks exist', async () => {
    mockApi({ tasks: [task()], blocks: [] })
    render(<TasksView />)

    await waitFor(() => expect(screen.getByText('Review the deck')).toBeTruthy())
    expect(screen.queryByText(/type a task above to start/i)).toBeNull()
    expect(screen.getAllByText('Drop a task here')).toHaveLength(1)
  })

  it('counts the tasks in each column', async () => {
    mockApi({ tasks: [task(), task({ id: 't2', title: 'Second' })], blocks: [] })
    render(<TasksView />)

    await waitFor(() => expect(screen.getByText('Second')).toBeTruthy())
    expect(screen.getAllByTestId('task-card')).toHaveLength(2)
  })

  it('shows the focus strip only while a block is running', async () => {
    const now = Date.now()
    mockApi({
      tasks: [task()],
      blocks: [{
        id: 'b1', taskId: 't1',
        startsAt: now - 600_000, endsAt: now + 600_000,
        focusSeconds: 0, focusStartedAt: now - 5_000,
      }],
    })
    render(<TasksView />)

    await waitFor(() => expect(screen.getByText('Focusing')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  it('hides the focus strip when nothing is running', async () => {
    mockApi({ tasks: [task()], blocks: [] })
    render(<TasksView />)

    await waitFor(() => expect(screen.getByText('Review the deck')).toBeTruthy())
    expect(screen.queryByText('Focusing')).toBeNull()
  })
})
