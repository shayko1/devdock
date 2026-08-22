import { describe, it, expect } from 'vitest'
import { sweepDay, pushCount } from './task-rollover'
import type { Task, TaskBlock } from './ipc-types'

const NOW = new Date(2026, 7, 22, 18, 0, 0).getTime()
const h = (hour: number) => new Date(2026, 7, 22, hour, 0, 0).getTime()

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'Thing', priority: 3, status: 'open',
    createdAt: 0, updatedAt: 0, ...overrides,
  }
}

function block(overrides: Partial<TaskBlock> = {}): TaskBlock {
  return {
    id: 'b1', taskId: 't1', startsAt: h(9), endsAt: h(10), focusSeconds: 0, ...overrides,
  }
}

describe('sweepDay', () => {
  it('flags a finished block whose task is still open', () => {
    const result = sweepDay({ tasks: [task()], blocks: [block()], now: NOW })
    expect(result.stale.map(s => s.block.id)).toEqual(['b1'])
  })

  it('ignores blocks that have not ended yet', () => {
    const result = sweepDay({
      tasks: [task()],
      blocks: [block({ startsAt: h(19), endsAt: h(20) })],
      now: NOW,
    })
    expect(result.stale).toEqual([])
  })

  it('ignores blocks whose task is done', () => {
    const result = sweepDay({ tasks: [task({ status: 'done' })], blocks: [block()], now: NOW })
    expect(result.stale).toEqual([])
  })

  it('ignores blocks whose task already has a later block', () => {
    const result = sweepDay({
      tasks: [task()],
      blocks: [block(), block({ id: 'b2', startsAt: h(20), endsAt: h(21) })],
      now: NOW,
    })
    expect(result.stale).toEqual([])
  })

  it('suggests the same time tomorrow', () => {
    const result = sweepDay({ tasks: [task()], blocks: [block()], now: NOW })
    const suggested = new Date(result.stale[0].suggestedStartsAt)
    expect(suggested.getDate()).toBe(23)
    expect(suggested.getHours()).toBe(9)
  })

  it('preserves the original duration in the suggestion', () => {
    const result = sweepDay({
      tasks: [task()],
      blocks: [block({ startsAt: h(9), endsAt: h(11) })],
      now: NOW,
    })
    const { suggestedStartsAt, suggestedEndsAt } = result.stale[0]
    expect(suggestedEndsAt - suggestedStartsAt).toBe(2 * 3_600_000)
  })

  it('ignores delegated tasks — they are not on your calendar', () => {
    const result = sweepDay({ tasks: [task({ status: 'delegated' })], blocks: [block()], now: NOW })
    expect(result.stale).toEqual([])
  })

  it('ignores a block whose task no longer exists', () => {
    const result = sweepDay({ tasks: [], blocks: [block()], now: NOW })
    expect(result.stale).toEqual([])
  })
})

describe('pushCount', () => {
  it('is zero for a block that was never rolled over', () => {
    expect(pushCount('b1', [block()])).toBe(0)
  })

  it('counts the length of the rolledFrom chain', () => {
    const chain = [
      block({ id: 'b1' }),
      block({ id: 'b2', rolledFrom: 'b1' }),
      block({ id: 'b3', rolledFrom: 'b2' }),
    ]
    expect(pushCount('b3', chain)).toBe(2)
  })

  it('stops on a dangling rolledFrom instead of looping forever', () => {
    expect(pushCount('b2', [block({ id: 'b2', rolledFrom: 'gone' })])).toBe(1)
  })

  it('is zero for an unknown block id', () => {
    expect(pushCount('nope', [block()])).toBe(0)
  })
})
