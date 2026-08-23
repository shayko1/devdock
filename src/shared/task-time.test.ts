import { describe, it, expect } from 'vitest'
import {
  snapToSlot, offsetToTime, timeToOffset, SLOT_MINUTES,
  focusElapsedSeconds, runningBlock, relevantBlockForTask,
} from './task-time'

const DAY_START = new Date(2026, 7, 22, 0, 0, 0).getTime()
const PX_PER_MINUTE = 1

describe('task-time', () => {
  it('uses 15-minute slots by default', () => {
    expect(SLOT_MINUTES).toBe(15)
  })

  it('snaps down to the nearest slot boundary', () => {
    const t = new Date(2026, 7, 22, 9, 7, 0).getTime()
    expect(new Date(snapToSlot(t)).getMinutes()).toBe(0)
  })

  it('snaps to the correct slot inside the hour', () => {
    const t = new Date(2026, 7, 22, 9, 38, 0).getTime()
    expect(new Date(snapToSlot(t)).getMinutes()).toBe(30)
  })

  it('converts a pixel offset to a snapped time', () => {
    const t = offsetToTime(547, PX_PER_MINUTE, DAY_START)
    const d = new Date(t)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(0)
  })

  it('round-trips a snapped time through an offset', () => {
    const t = new Date(2026, 7, 22, 14, 30, 0).getTime()
    const offset = timeToOffset(t, PX_PER_MINUTE, DAY_START)
    expect(offsetToTime(offset, PX_PER_MINUTE, DAY_START)).toBe(t)
  })

  it('clamps a negative offset to the start of the day', () => {
    expect(offsetToTime(-50, PX_PER_MINUTE, DAY_START)).toBe(DAY_START)
  })

  it('timeToOffset is zero at the start of the day', () => {
    expect(timeToOffset(DAY_START, PX_PER_MINUTE, DAY_START)).toBe(0)
  })
})

const h = (hour: number) => new Date(2026, 7, 22, hour, 0, 0).getTime()

function blk(over: Partial<{ id: string; taskId: string; startsAt: number; endsAt: number; focusSeconds: number; focusStartedAt?: number }> = {}) {
  return {
    id: 'b1', taskId: 't1', startsAt: h(9), endsAt: h(10), focusSeconds: 0, ...over,
  }
}

describe('focusElapsedSeconds', () => {
  it('returns banked seconds when the timer is stopped', () => {
    expect(focusElapsedSeconds({ focusSeconds: 90 }, h(12))).toBe(90)
  })

  it('adds the running stretch to the banked total', () => {
    const started = h(12)
    expect(focusElapsedSeconds({ focusSeconds: 30, focusStartedAt: started }, started + 65_000)).toBe(95)
  })

  it('never goes backwards if the clock jumps behind the stamp', () => {
    const started = h(12)
    expect(focusElapsedSeconds({ focusSeconds: 10, focusStartedAt: started }, started - 5_000)).toBe(10)
  })
})

describe('runningBlock', () => {
  it('finds the block with a live timer', () => {
    const running = blk({ id: 'b2', focusStartedAt: h(9) })
    expect(runningBlock([blk(), running])?.id).toBe('b2')
  })

  it('is undefined when nothing is running', () => {
    expect(runningBlock([blk(), blk({ id: 'b2' })])).toBeUndefined()
  })
})

describe('relevantBlockForTask', () => {
  it('is undefined for a task with no blocks', () => {
    expect(relevantBlockForTask('nope', [blk()], h(12))).toBeUndefined()
  })

  it('prefers a running block over everything else', () => {
    const running = blk({ id: 'running', startsAt: h(7), endsAt: h(8), focusStartedAt: h(7) })
    const upcoming = blk({ id: 'upcoming', startsAt: h(15), endsAt: h(16) })
    expect(relevantBlockForTask('t1', [upcoming, running], h(12))?.id).toBe('running')
  })

  it('prefers the block happening right now', () => {
    const current = blk({ id: 'current', startsAt: h(11), endsAt: h(13) })
    const upcoming = blk({ id: 'upcoming', startsAt: h(15), endsAt: h(16) })
    expect(relevantBlockForTask('t1', [upcoming, current], h(12))?.id).toBe('current')
  })

  it('otherwise picks the soonest upcoming block', () => {
    const soon = blk({ id: 'soon', startsAt: h(14), endsAt: h(15) })
    const later = blk({ id: 'later', startsAt: h(18), endsAt: h(19) })
    expect(relevantBlockForTask('t1', [later, soon], h(12))?.id).toBe('soon')
  })

  it('falls back to the most recent past block', () => {
    const older = blk({ id: 'older', startsAt: h(6), endsAt: h(7) })
    const recent = blk({ id: 'recent', startsAt: h(9), endsAt: h(10) })
    expect(relevantBlockForTask('t1', [older, recent], h(12))?.id).toBe('recent')
  })

  it('ignores blocks belonging to other tasks', () => {
    const mine = blk({ id: 'mine', startsAt: h(15), endsAt: h(16) })
    const theirs = blk({ id: 'theirs', taskId: 't2', startsAt: h(13), endsAt: h(14) })
    expect(relevantBlockForTask('t1', [theirs, mine], h(12))?.id).toBe('mine')
  })
})
