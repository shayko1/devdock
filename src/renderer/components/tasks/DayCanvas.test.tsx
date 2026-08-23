import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DayCanvas } from './DayCanvas'
import type { Task, TaskBlock } from '../../../shared/ipc-types'

const DAY = new Date(2026, 7, 22, 0, 0, 0).getTime()
const NOW = new Date(2026, 7, 22, 12, 0, 0).getTime()
const at = (h: number, m = 0) => new Date(2026, 7, 22, h, m, 0).getTime()

const task: Task = {
  id: 't1', title: 'Deep work', priority: 1, status: 'open', createdAt: 0, updatedAt: 0,
}

function block(overrides: Partial<TaskBlock> = {}): TaskBlock {
  return {
    id: 'b1', taskId: 't1', startsAt: at(9), endsAt: at(10), focusSeconds: 0, ...overrides,
  }
}

const handlers = {
  onSchedule: vi.fn(),
  onMoveBlock: vi.fn(),
  onResizeBlock: vi.fn(),
  onDeleteBlock: vi.fn(),
  onToggleFocus: vi.fn(),
}

function renderCanvas(props: Partial<Parameters<typeof DayCanvas>[0]> = {}) {
  return render(
    <DayCanvas
      day={DAY} tasks={[task]} blocks={[]} busy={[]} now={NOW}
      {...handlers} {...props}
    />
  )
}

describe('DayCanvas', () => {
  it('renders one row per hour', () => {
    renderCanvas()
    expect(screen.getAllByTestId('canvas-hour')).toHaveLength(24)
  })

  it('names the day being shown', () => {
    renderCanvas()
    expect(screen.getByText('Saturday')).toBeTruthy()
    expect(screen.getByText('22 Aug')).toBeTruthy()
  })

  it('renders a block with its title and time range', () => {
    renderCanvas({ blocks: [block()] })
    expect(screen.getByText('Deep work')).toBeTruthy()
    expect(screen.getByText('09:00–10:00')).toBeTruthy()
  })

  it('positions and sizes the block from its times', () => {
    renderCanvas({ blocks: [block()] })
    const el = screen.getByTestId('canvas-block') as HTMLElement
    // 9h × 60min × 1px from the top, 60min tall.
    expect(el.style.top).toBe('540px')
    expect(el.style.height).toBe('60px')
  })

  it('keeps a short block tall enough to read', () => {
    renderCanvas({ blocks: [block({ endsAt: at(9, 15) })] })
    expect((screen.getByTestId('canvas-block') as HTMLElement).style.height).toBe('22px')
  })

  it('draws a current-time line when showing today', () => {
    renderCanvas()
    const line = screen.getByTestId('canvas-now-line') as HTMLElement
    expect(line.style.top).toBe('720px') // 12:00
  })

  it('omits the current-time line on another day', () => {
    renderCanvas({ day: DAY + 86_400_000 })
    expect(screen.queryByTestId('canvas-now-line')).toBeNull()
  })

  it('shows the running timer on a focused block instead of its range', () => {
    renderCanvas({ blocks: [block({ focusSeconds: 30, focusStartedAt: NOW - 33_000 })] })
    expect(screen.getByText('1:03')).toBeTruthy()
    expect(screen.queryByText('09:00–10:00')).toBeNull()
  })

  it('starts focus on a stopped block', async () => {
    const onToggleFocus = vi.fn()
    renderCanvas({ blocks: [block()], onToggleFocus })

    await userEvent.click(screen.getByRole('button', { name: 'Start focus' }))
    expect(onToggleFocus).toHaveBeenCalledWith('b1', false)
  })

  it('stops focus on a running block', async () => {
    const onToggleFocus = vi.fn()
    renderCanvas({ blocks: [block({ focusStartedAt: NOW })], onToggleFocus })

    await userEvent.click(screen.getByRole('button', { name: 'Stop focus' }))
    expect(onToggleFocus).toHaveBeenCalledWith('b1', true)
  })

  it('unschedules a block', async () => {
    const onDeleteBlock = vi.fn()
    renderCanvas({ blocks: [block()], onDeleteBlock })

    await userEvent.click(screen.getByRole('button', { name: 'Unschedule' }))
    expect(onDeleteBlock).toHaveBeenCalledWith('b1')
  })

  it('reports how much of the day is blocked', () => {
    renderCanvas({ blocks: [block(), block({ id: 'b2', startsAt: at(14), endsAt: at(15, 30) })] })
    expect(screen.getByText('2.5h blocked')).toBeTruthy()
  })

  it('says so when nothing is blocked, and invites a drag', () => {
    renderCanvas()
    expect(screen.getByText('nothing blocked')).toBeTruthy()
    expect(screen.getByText(/drag a task here/i)).toBeTruthy()
  })

  it('renders busy intervals', () => {
    renderCanvas({
      busy: [{ startsAt: at(11), endsAt: at(12), title: 'Standup', allDay: false }],
    })
    expect(screen.getByText('Standup')).toBeTruthy()
  })

  it('ignores all-day busy events', () => {
    renderCanvas({
      busy: [{ startsAt: DAY, endsAt: DAY + 86_400_000, title: 'OOO', allDay: true }],
    })
    expect(screen.queryByText('OOO')).toBeNull()
  })

  it('falls back to a placeholder title for an unknown task', () => {
    renderCanvas({ tasks: [], blocks: [block()] })
    expect(screen.getByText('Untitled')).toBeTruthy()
  })
})
