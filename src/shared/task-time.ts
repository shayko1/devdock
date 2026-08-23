/** Canvas granularity. Blocks always start and end on a slot boundary. */
export const SLOT_MINUTES = 15

const MS_PER_MINUTE = 60_000

/**
 * Rounds a timestamp down to the enclosing slot boundary.
 *
 * This floors against the epoch, which lands on a wall-clock boundary because
 * 15 minutes divides an hour and every current timezone offset is a whole
 * quarter-hour. If that ever stops holding, snap relative to the day start.
 */
export function snapToSlot(ms: number, slotMinutes: number = SLOT_MINUTES): number {
  const slotMs = slotMinutes * MS_PER_MINUTE
  return Math.floor(ms / slotMs) * slotMs
}

/** Vertical pixel offset within the canvas → snapped timestamp. */
export function offsetToTime(offsetPx: number, pxPerMinute: number, dayStart: number): number {
  const minutes = Math.max(0, offsetPx) / pxPerMinute
  return snapToSlot(dayStart + minutes * MS_PER_MINUTE)
}

/** Timestamp → vertical pixel offset within the canvas. */
export function timeToOffset(ms: number, pxPerMinute: number, dayStart: number): number {
  return ((ms - dayStart) / MS_PER_MINUTE) * pxPerMinute
}

/**
 * Live focus time for a block: banked seconds plus the stretch currently
 * running. The stamp is on disk, so this survives a quit mid-focus.
 */
export function focusElapsedSeconds(
  block: { focusSeconds: number; focusStartedAt?: number },
  now: number
): number {
  if (block.focusStartedAt == null) return block.focusSeconds
  return block.focusSeconds + Math.max(0, Math.floor((now - block.focusStartedAt) / 1000))
}

/** The one block with a running timer, if any. TaskManager guarantees at most one. */
export function runningBlock<T extends { focusStartedAt?: number }>(blocks: T[]): T | undefined {
  return blocks.find(b => b.focusStartedAt != null)
}

/**
 * The block a task card should advertise: the one running now, else the one
 * currently in progress, else the next upcoming, else the most recent past.
 * Answers "when is this happening?" rather than just "does it have a block?".
 */
export function relevantBlockForTask<T extends {
  taskId: string; startsAt: number; endsAt: number; focusStartedAt?: number
}>(taskId: string, blocks: T[], now: number): T | undefined {
  const mine = blocks.filter(b => b.taskId === taskId)
  if (mine.length === 0) return undefined

  const running = mine.find(b => b.focusStartedAt != null)
  if (running) return running

  const current = mine.find(b => b.startsAt <= now && b.endsAt > now)
  if (current) return current

  const upcoming = mine.filter(b => b.startsAt > now).sort((a, b) => a.startsAt - b.startsAt)
  if (upcoming.length) return upcoming[0]

  return [...mine].sort((a, b) => b.endsAt - a.endsAt)[0]
}
