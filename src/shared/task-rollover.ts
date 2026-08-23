import type { Task, TaskBlock } from './ipc-types'

export interface StaleBlock {
  block: TaskBlock
  task: Task
  suggestedStartsAt: number
  suggestedEndsAt: number
}

export interface SweepResult {
  stale: StaleBlock[]
}

const ONE_DAY_MS = 86_400_000

/**
 * Finds work that was scheduled, has passed, and never got finished or
 * rescheduled. Pure and read-only: it proposes, the user decides. A sweep that
 * rewrote the calendar on its own would make the calendar untrustworthy.
 *
 * The suggestion adds exactly 24 hours rather than reconstructing a local
 * wall-clock time, so across a DST boundary the suggested hour shifts by one.
 * Every suggestion is shown and confirmed, so that is visible rather than
 * silent.
 */
export function sweepDay({
  tasks, blocks, now,
}: { tasks: Task[]; blocks: TaskBlock[]; now: number }): SweepResult {
  const taskById = new Map(tasks.map(t => [t.id, t]))

  const latestEndByTask = new Map<string, number>()
  for (const block of blocks) {
    const current = latestEndByTask.get(block.taskId) ?? -Infinity
    if (block.endsAt > current) latestEndByTask.set(block.taskId, block.endsAt)
  }

  const stale: StaleBlock[] = []

  for (const block of blocks) {
    if (block.endsAt >= now) continue

    const task = taskById.get(block.taskId)
    if (!task || task.status !== 'open') continue

    // Only the task's final block is stale; earlier ones were already followed up.
    if (latestEndByTask.get(block.taskId) !== block.endsAt) continue

    stale.push({
      block,
      task,
      suggestedStartsAt: block.startsAt + ONE_DAY_MS,
      suggestedEndsAt: block.endsAt + ONE_DAY_MS,
    })
  }

  return { stale }
}

/** How many times this block's work has already been pushed. */
export function pushCount(blockId: string, blocks: TaskBlock[]): number {
  const byId = new Map(blocks.map(b => [b.id, b]))
  let count = 0
  let current = byId.get(blockId)

  while (current?.rolledFrom) {
    count += 1
    const next = byId.get(current.rolledFrom)
    if (!next) break
    current = next
  }

  return count
}
