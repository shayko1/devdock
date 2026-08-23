import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DayCanvas } from './DayCanvas'
import type { Task, TaskBlock } from '../../../shared/ipc-types'

const DAY = new Date(2026, 7, 22, 0, 0, 0).getTime()

const task: Task = {
  id: 't1', title: 'Deep work', priority: 1, status: 'open', createdAt: 0, updatedAt: 0,
}

function block(overrides: Partial<TaskBlock> = {}): TaskBlock {
  return {
    id: 'b1',
    taskId: 't1',
    startsAt: new Date(2026, 7, 22, 9, 0, 0).getTime(),
    endsAt: new Date(2026, 7, 22, 10, 0, 0).getTime(),
    focusSeconds: 0,
    ...overrides,
  }
}

const noop = vi.fn()

const baseProps = {
  onSchedule: noop,
  onMoveBlock: noop,
  onResizeBlock: noop,
  onDeleteBlock: noop,
}

describe('DayCanvas', () => {
  it('renders one row per hour', () => {
    render(<DayCanvas day={DAY} tasks={[]} blocks={[]} busy={[]} {...baseProps} />)
    expect(screen.getAllByTestId('canvas-hour')).toHaveLength(24)
  })

  it('renders a block with the task title', () => {
    render(<DayCanvas day={DAY} tasks={[task]} blocks={[block()]} busy={[]} {...baseProps} />)
    expect(screen.getByText('Deep work')).toBeTruthy()
  })

  it('positions and sizes the block from its times', () => {
    render(<DayCanvas day={DAY} tasks={[task]} blocks={[block()]} busy={[]} {...baseProps} />)
    const el = screen.getByTestId('canvas-block') as HTMLElement
    // 9h × 60min × 1px from the top, 60min tall.
    expect(el.style.top).toBe('540px')
    expect(el.style.height).toBe('60px')
  })

  it('falls back to a placeholder title for an unknown task', () => {
    render(<DayCanvas day={DAY} tasks={[]} blocks={[block()]} busy={[]} {...baseProps} />)
    expect(screen.getByText('Untitled')).toBeTruthy()
  })

  it('renders busy intervals', () => {
    render(
      <DayCanvas
        day={DAY} tasks={[]} blocks={[]}
        busy={[{
          startsAt: new Date(2026, 7, 22, 11, 0, 0).getTime(),
          endsAt: new Date(2026, 7, 22, 12, 0, 0).getTime(),
          title: 'Standup',
          allDay: false,
        }]}
        {...baseProps}
      />
    )
    expect(screen.getByText('Standup')).toBeTruthy()
  })

  it('ignores all-day busy events', () => {
    render(
      <DayCanvas
        day={DAY} tasks={[]} blocks={[]}
        busy={[{ startsAt: DAY, endsAt: DAY + 86_400_000, title: 'OOO', allDay: true }]}
        {...baseProps}
      />
    )
    expect(screen.queryByText('OOO')).toBeNull()
  })
})
