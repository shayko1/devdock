/**
 * Display formatting for tasks and blocks. Pure and locale-independent: the
 * canvas hour rail is a 24-hour instrument, so every time in the tab reads the
 * same way rather than switching format with the host locale.
 */

const MS_PER_DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number) => String(n).padStart(2, '0')

/** 24-hour HH:MM. */
export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatTimeRange(startsAt: number, endsAt: number): string {
  return `${formatClock(startsAt)}–${formatClock(endsAt)}`
}

/** Compact estimate: 45m, 1h, 1h 30m. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (!hours) return `${mins}m`
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

/** Running timer: M:SS under an hour, H:MM:SS above. Clamped at zero. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60

  if (!hours) return `${minutes}:${pad(seconds)}`
  return `${hours}:${pad(minutes)}:${pad(seconds)}`
}

/** Midnight of the day containing ms, local time. */
function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Human day reference. Compares calendar days rather than elapsed time, so
 * 23:30 and 00:30 read as different days even though they are an hour apart.
 */
export function dayLabel(ms: number, now: number): string {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / MS_PER_DAY)

  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'

  const d = new Date(ms)
  if (days > 1 && days < 7) return WEEKDAYS[d.getDay()]
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function isOverdue(dueAt: number | undefined, now: number): boolean {
  return dueAt != null && dueAt < now
}
