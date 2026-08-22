import { describe, it, expect } from 'vitest'
import { snapToSlot, offsetToTime, timeToOffset, SLOT_MINUTES } from './task-time'

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
