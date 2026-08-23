import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FocusStrip } from './FocusStrip'
import type { Task, TaskBlock } from '../../../shared/ipc-types'

const NOW = new Date(2026, 7, 22, 12, 0, 0).getTime()
const at = (h: number, m = 0) => new Date(2026, 7, 22, h, m, 0).getTime()

const task: Task = {
  id: 't1', title: 'Draft the Q3 memo', priority: 1, status: 'open', createdAt: 0, updatedAt: 0,
}

function block(overrides: Partial<TaskBlock> = {}): TaskBlock {
  return {
    id: 'b1', taskId: 't1',
    startsAt: at(11, 30), endsAt: at(12, 30),
    focusSeconds: 0, focusStartedAt: NOW - 65_000,
    ...overrides,
  }
}

describe('FocusStrip', () => {
  it('names the task being worked on and its slot', () => {
    render(<FocusStrip block={block()} task={task} now={NOW} onStop={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByText('Draft the Q3 memo')).toBeTruthy()
    expect(screen.getByText('11:30–12:30')).toBeTruthy()
  })

  it('derives elapsed time from the stored stamp rather than counting up', () => {
    render(<FocusStrip block={block()} task={task} now={NOW} onStop={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByText('1:05')).toBeTruthy()
  })

  it('adds banked seconds from earlier stretches', () => {
    render(
      <FocusStrip
        block={block({ focusSeconds: 120 })}
        task={task} now={NOW} onStop={vi.fn()} onDone={vi.fn()}
      />
    )
    expect(screen.getByText('3:05')).toBeTruthy()
  })

  it('stops the timer', async () => {
    const onStop = vi.fn()
    render(<FocusStrip block={block()} task={task} now={NOW} onStop={onStop} onDone={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledWith('b1')
  })

  it('finishes the task', async () => {
    const onDone = vi.fn()
    render(<FocusStrip block={block()} task={task} now={NOW} onStop={vi.fn()} onDone={onDone} />)

    await userEvent.click(screen.getByRole('button', { name: 'Finish task' }))
    expect(onDone).toHaveBeenCalledWith('t1')
  })

  it('survives a missing task without offering to finish it', () => {
    render(<FocusStrip block={block()} task={undefined} now={NOW} onStop={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByText('Untitled')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Finish task' })).toBeNull()
  })
})
