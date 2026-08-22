import { describe, it, expect } from 'vitest'
import { parseTaskInput } from './task-parse'

// Saturday 2026-08-22, 10:00 local.
const NOW = new Date(2026, 7, 22, 10, 0, 0).getTime()

describe('parseTaskInput', () => {
  it('defaults to priority 3 and keeps the whole text as the title', () => {
    const r = parseTaskInput('Write the quarterly review', NOW)
    expect(r.title).toBe('Write the quarterly review')
    expect(r.priority).toBe(3)
    expect(r.estimateMinutes).toBeUndefined()
    expect(r.dueAt).toBeUndefined()
    expect(r.scheduleAt).toBeUndefined()
  })

  it('extracts priority and strips it from the title', () => {
    const r = parseTaskInput('p1 Fix the build', NOW)
    expect(r.priority).toBe(1)
    expect(r.title).toBe('Fix the build')
  })

  it.each([
    ['45m', 45],
    ['90min', 90],
    ['1h', 60],
    ['1.5h', 90],
    ['2h', 120],
  ])('parses estimate %s as %i minutes', (token, minutes) => {
    const r = parseTaskInput(`Review docs ${token}`, NOW)
    expect(r.estimateMinutes).toBe(minutes)
    expect(r.title).toBe('Review docs')
  })

  it('a date without a time sets dueAt and leaves scheduleAt unset', () => {
    const r = parseTaskInput('Board deck tomorrow', NOW)
    expect(r.scheduleAt).toBeUndefined()
    expect(new Date(r.dueAt!).getDate()).toBe(23)
    expect(r.title).toBe('Board deck')
  })

  it('a date with a time sets scheduleAt', () => {
    const r = parseTaskInput('1:1 with Dana tomorrow 2pm', NOW)
    const scheduled = new Date(r.scheduleAt!)
    expect(scheduled.getDate()).toBe(23)
    expect(scheduled.getHours()).toBe(14)
    expect(scheduled.getMinutes()).toBe(0)
    expect(r.title).toBe('1:1 with Dana')
  })

  it('resolves a weekday name to the next such day', () => {
    const r = parseTaskInput('Retro mon', NOW)
    expect(new Date(r.dueAt!).getDate()).toBe(24)
  })

  it('handles 24-hour and half-hour times', () => {
    const r = parseTaskInput('Standup today 9:30am', NOW)
    const at = new Date(r.scheduleAt!)
    expect(at.getHours()).toBe(9)
    expect(at.getMinutes()).toBe(30)
  })

  it('only matches whole-word tokens', () => {
    const r = parseTaskInput('review 1h1 doc', NOW)
    expect(r.estimateMinutes).toBeUndefined()
    expect(r.title).toBe('review 1h1 doc')
  })

  it('ignores an out-of-range priority', () => {
    const r = parseTaskInput('p5 nonsense', NOW)
    expect(r.priority).toBe(3)
    expect(r.title).toBe('p5 nonsense')
  })

  it('uses the first match when a field appears twice', () => {
    const r = parseTaskInput('Thing 30m 45m', NOW)
    expect(r.estimateMinutes).toBe(30)
  })

  it('collapses whitespace left by stripped tokens', () => {
    const r = parseTaskInput('p2  Deploy   the   thing  1h', NOW)
    expect(r.title).toBe('Deploy the thing')
  })

  it('reports match offsets so the input can highlight them', () => {
    const r = parseTaskInput('p1 ship it', NOW)
    expect(r.matched).toEqual([{ start: 0, end: 2, kind: 'priority' }])
  })

  it('returns an empty title rather than throwing on token-only input', () => {
    const r = parseTaskInput('p1 1h', NOW)
    expect(r.title).toBe('')
    expect(r.priority).toBe(1)
    expect(r.estimateMinutes).toBe(60)
  })

  it('treats a 24-hour time without am/pm correctly', () => {
    const r = parseTaskInput('Deploy today 14:00', NOW)
    const at = new Date(r.scheduleAt!)
    expect(at.getHours()).toBe(14)
    expect(at.getMinutes()).toBe(0)
  })

  it('handles "next monday" as a week further out', () => {
    const r = parseTaskInput('Planning next monday', NOW)
    expect(new Date(r.dueAt!).getDate()).toBe(31)
    expect(r.title).toBe('Planning')
  })
})
