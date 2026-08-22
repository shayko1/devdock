import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SweepModal } from './SweepModal'
import type { StaleBlock } from '../../../shared/task-rollover'

const item: StaleBlock = {
  block: {
    id: 'b1', taskId: 't1',
    startsAt: new Date(2026, 7, 22, 9, 0).getTime(),
    endsAt: new Date(2026, 7, 22, 10, 0).getTime(),
    focusSeconds: 0,
  },
  task: {
    id: 't1', title: 'Unfinished thing', priority: 2, status: 'open',
    createdAt: 0, updatedAt: 0,
  },
  suggestedStartsAt: new Date(2026, 7, 23, 9, 0).getTime(),
  suggestedEndsAt: new Date(2026, 7, 23, 10, 0).getTime(),
}

describe('SweepModal', () => {
  it('lists each stale task', () => {
    render(<SweepModal items={[item]} pushCounts={{ b1: 0 }} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Unfinished thing')).toBeTruthy()
  })

  it('shows a push count when the work has been moved before', () => {
    render(<SweepModal items={[item]} pushCounts={{ b1: 3 }} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/pushed ×3/i)).toBeTruthy()
  })

  it('hides the push count when the work has never moved', () => {
    render(<SweepModal items={[item]} pushCounts={{ b1: 0 }} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText(/pushed/i)).toBeNull()
  })

  it('reports the chosen action per row', async () => {
    const onApply = vi.fn()
    render(<SweepModal items={[item]} pushCounts={{ b1: 0 }} onApply={onApply} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /roll over/i }))
    expect(onApply).toHaveBeenCalledWith(item, 'rollover')

    await userEvent.click(screen.getByRole('button', { name: /^done$/i }))
    expect(onApply).toHaveBeenCalledWith(item, 'done')

    await userEvent.click(screen.getByRole('button', { name: /drop/i }))
    expect(onApply).toHaveBeenCalledWith(item, 'drop')
  })

  it('does not act on its own', () => {
    const onApply = vi.fn()
    render(<SweepModal items={[item]} pushCounts={{ b1: 0 }} onApply={onApply} onClose={vi.fn()} />)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows an empty message when nothing is stale', () => {
    render(<SweepModal items={[]} pushCounts={{}} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/nothing left hanging/i)).toBeTruthy()
  })
})
