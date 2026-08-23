export type MatchKind = 'priority' | 'estimate' | 'date' | 'time'

export interface ParsedTask {
  title: string
  priority: 1 | 2 | 3 | 4
  estimateMinutes?: number
  /** Set when a date was given without a time. */
  dueAt?: number
  /** Set when both a date and a time were given — the caller schedules a block. */
  scheduleAt?: number
  matched: Array<{ start: number; end: number; kind: MatchKind }>
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const PRIORITY_RE = /\bp([1-4])\b/i
const ESTIMATE_RE = /\b(\d+(?:\.\d+)?)(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i
/**
 * Two alternatives: an am/pm time (groups 1-3) or a 24-hour time (groups 4-5).
 * The minute group requires exactly two digits, which is what stops "1:1" in
 * "1:1 with Dana" from being read as a time.
 */
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i
const RELATIVE_DATE_RE = /\b(today|tomorrow)\b/i
const WEEKDAY_RE = /\b(?:(next)\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday)?\b/i

/**
 * Deterministic one-line task capture. No AI: a small, predictable grammar the
 * user can learn, so the same input always produces the same task.
 *
 * Whole-word matches only, first match wins per field, and whatever is left
 * becomes the title. A date plus a time schedules a block; a date alone is a
 * due date.
 */
export function parseTaskInput(text: string, now: number): ParsedTask {
  const matched: ParsedTask['matched'] = []
  /** Character ranges to remove from the title, collected as we match. */
  const cuts: Array<[number, number]> = []

  const take = (m: RegExpExecArray | null, kind: MatchKind): RegExpExecArray | null => {
    if (!m) return null
    matched.push({ start: m.index, end: m.index + m[0].length, kind })
    cuts.push([m.index, m.index + m[0].length])
    return m
  }

  const priorityMatch = take(PRIORITY_RE.exec(text), 'priority')
  const priority = priorityMatch ? (Number(priorityMatch[1]) as 1 | 2 | 3 | 4) : 3

  const estimateMatch = take(ESTIMATE_RE.exec(text), 'estimate')
  let estimateMinutes: number | undefined
  if (estimateMatch) {
    const value = Number(estimateMatch[1])
    const isHours = estimateMatch[2].toLowerCase().startsWith('h')
    estimateMinutes = Math.round(isHours ? value * 60 : value)
  }

  const date = resolveDate(text, now, take)
  const time = resolveTime(text, take)

  let dueAt: number | undefined
  let scheduleAt: number | undefined
  if (date != null) {
    const base = new Date(date)
    if (time) {
      base.setHours(time.hours, time.minutes, 0, 0)
      scheduleAt = base.getTime()
    } else {
      base.setHours(23, 59, 0, 0)
      dueAt = base.getTime()
    }
  }

  return {
    title: stripRanges(text, cuts),
    priority,
    estimateMinutes,
    dueAt,
    scheduleAt,
    matched: matched.sort((a, b) => a.start - b.start),
  }
}

function resolveDate(
  text: string,
  now: number,
  take: (m: RegExpExecArray | null, kind: MatchKind) => RegExpExecArray | null
): number | null {
  const relative = take(RELATIVE_DATE_RE.exec(text), 'date')
  if (relative) {
    const d = new Date(now)
    if (relative[1].toLowerCase() === 'tomorrow') d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  const weekday = take(WEEKDAY_RE.exec(text), 'date')
  if (weekday) {
    const wantsNext = Boolean(weekday[1])
    const target = WEEKDAYS.indexOf(weekday[2].toLowerCase())
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    let delta = (target - d.getDay() + 7) % 7
    if (delta === 0) delta = 7
    if (wantsNext) delta += 7
    d.setDate(d.getDate() + delta)
    return d.getTime()
  }

  return null
}

function resolveTime(
  text: string,
  take: (m: RegExpExecArray | null, kind: MatchKind) => RegExpExecArray | null
): { hours: number; minutes: number } | null {
  const m = take(TIME_RE.exec(text), 'time')
  if (!m) return null

  if (m[3]) {
    let hours = Number(m[1]) % 12
    if (m[3].toLowerCase() === 'pm') hours += 12
    return { hours, minutes: m[2] ? Number(m[2]) : 0 }
  }
  return { hours: Number(m[4]), minutes: Number(m[5]) }
}

/** Removes matched ranges and collapses the whitespace they leave behind. */
function stripRanges(text: string, cuts: Array<[number, number]>): string {
  if (cuts.length === 0) return text.trim()

  // Right to left so earlier offsets stay valid as we splice.
  const ordered = [...cuts].sort((a, b) => b[0] - a[0])
  let out = text
  for (const [start, end] of ordered) {
    out = out.slice(0, start) + ' ' + out.slice(end)
  }
  return out.replace(/\s+/g, ' ').trim()
}
