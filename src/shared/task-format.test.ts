import { describe, it, expect } from 'vitest'
import {
  formatClock, formatTimeRange, formatDuration, formatElapsed, dayLabel, isOverdue,
} from './task-format'

const at = (h: number, m = 0) => new Date(2026, 7, 22, h, m, 0).getTime()

describe('formatClock', () => {
  it('pads to 24-hour HH:MM', () => {
    expect(formatClock(at(9, 5))).toBe('09:05')
    expect(formatClock(at(14, 30))).toBe('14:30')
    expect(formatClock(at(0, 0))).toBe('00:00')
  })
})

describe('formatTimeRange', () => {
  it('joins start and end with an en dash', () => {
    expect(formatTimeRange(at(9), at(10, 15))).toBe('09:00–10:15')
  })
})

describe('formatDuration', () => {
  it.each([
    [45, '45m'],
    [60, '1h'],
    [120, '2h'],
    [90, '1h 30m'],
    [5, '5m'],
  ])('formats %i minutes as %s', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected)
  })
})

describe('formatElapsed', () => {
  it('uses M:SS under an hour', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(45)).toBe('0:45')
    expect(formatElapsed(723)).toBe('12:03')
  })

  it('uses H:MM:SS from an hour up', () => {
    expect(formatElapsed(3600)).toBe('1:00:00')
    expect(formatElapsed(3753)).toBe('1:02:33')
  })

  it('never renders a negative clock', () => {
    expect(formatElapsed(-5)).toBe('0:00')
  })
})

describe('dayLabel', () => {
  const now = at(12)

  it('names today, tomorrow and yesterday', () => {
    expect(dayLabel(at(18), now)).toBe('Today')
    expect(dayLabel(at(18) + 86_400_000, now)).toBe('Tomorrow')
    expect(dayLabel(at(18) - 86_400_000, now)).toBe('Yesterday')
  })

  it('uses a weekday name within the coming week', () => {
    // 2026-08-22 is a Saturday, so +3 days is Tuesday.
    expect(dayLabel(at(9) + 3 * 86_400_000, now)).toBe('Tue')
  })

  it('falls back to a day and month further out', () => {
    expect(dayLabel(new Date(2026, 8, 15, 9).getTime(), now)).toBe('15 Sep')
  })

  it('compares calendar days, not elapsed hours', () => {
    // 23:30 today vs 00:30 tomorrow is one hour apart but a different day.
    expect(dayLabel(at(23, 30), at(23, 0))).toBe('Today')
    expect(dayLabel(at(23, 30) + 3_600_000, at(23, 0))).toBe('Tomorrow')
  })
})

describe('isOverdue', () => {
  it('is true only once the due moment has passed', () => {
    expect(isOverdue(at(11), at(12))).toBe(true)
    expect(isOverdue(at(13), at(12))).toBe(false)
  })

  it('treats an absent due date as not overdue', () => {
    expect(isOverdue(undefined, at(12))).toBe(false)
  })
})
