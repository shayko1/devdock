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
