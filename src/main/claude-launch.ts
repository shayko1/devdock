/**
 * claude-launch.ts — Decides how to start the `claude` CLI for a DevDock session.
 *
 * DevDock owns the Claude session id instead of discovering it afterwards: it
 * claims a UUID with `--session-id` when a session is created, then resumes
 * that exact id on every later launch. Two verified CLI behaviours shape the
 * rules below:
 *
 *   - `claude --resume <id>` for an id with no transcript exits with
 *     "No conversation found with session ID: <id>".
 *   - `claude --session-id <id>` for an id that already has a transcript exits
 *     with "Session ID <id> is already in use."
 *
 * So exactly one of the two flags is ever passed, chosen by whether the
 * transcript exists on disk.
 */

import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

/**
 * Whether `claude` accepts `--session-id`. Kept as an explicit seam so the
 * fallback path stays tested, but not probed at runtime: resolving `claude`
 * from the main process is unreliable (a Finder-launched Electron app has a
 * minimal PATH), and DevDock already depends on comparably old flags such as
 * `--resume` and `--model`.
 */
export const SUPPORTS_SESSION_ID = true

/**
 * Claude Code session ids are UUIDs. The launch plan is a string executed by
 * the session's shell, and ids reaching us from disk are untrusted, so
 * anything that isn't UUID-shaped is refused rather than interpolated.
 */
export function isClaudeSessionId(value: string | null | undefined): boolean {
  if (!value) return false
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
}

/**
 * Claude Code's project-directory name: the working directory path with every
 * non-alphanumeric character replaced by a dash.
 *
 * (Claude Code additionally truncates names over 200 characters and appends a
 * hash of the full path. Paths that long are not handled here — a miss only
 * costs a transcript-existence check, which falls back to starting fresh.)
 */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Where Claude Code stores the transcript for a session started in `cwd`. */
export function transcriptPathFor(cwd: string, claudeSessionId: string): string {
  return join(CLAUDE_PROJECTS_DIR, claudeProjectDirName(cwd), `${claudeSessionId}.jsonl`)
}

export interface LaunchInput {
  /** A session id DevDock already holds for this tab, if any. */
  reservedId: string | null
  /** Whether that id's transcript exists on disk. */
  hasTranscript: boolean
  supportsSessionId: boolean
  /** Id to claim when there is no reserved one. Injected for testability. */
  newId: string
  /** Extra flags, each already prefixed with a space (e.g. ` --model opus`). */
  flags: string
}

export interface LaunchPlan {
  command: string
  /** The id this session will use, or null when Claude Code picks its own. */
  claudeSessionId: string | null
}

export function planClaudeLaunch(input: LaunchInput): LaunchPlan {
  const { reservedId, hasTranscript, supportsSessionId, newId, flags } = input

  if (reservedId && hasTranscript) {
    return { command: `claude --resume ${reservedId}${flags}`, claudeSessionId: reservedId }
  }

  if (supportsSessionId) {
    const id = reservedId ?? newId
    return { command: `claude --session-id ${id}${flags}`, claudeSessionId: id }
  }

  // No way to pin the id at launch — the statusline bridge reports it instead.
  return { command: `claude${flags}`, claudeSessionId: null }
}

/**
 * Plan a launch against the real filesystem: validates the reserved id, checks
 * for its transcript, and mints a new id when needed.
 */
export function resolveClaudeLaunch(opts: {
  cwd: string
  resumeClaudeId?: string | null
  /** Transcript path recorded by the statusline bridge, if we have one. */
  storedTranscriptPath?: string | null
  flags: string
}): LaunchPlan {
  const reservedId = isClaudeSessionId(opts.resumeClaudeId) ? opts.resumeClaudeId! : null

  const hasTranscript =
    reservedId !== null &&
    ((!!opts.storedTranscriptPath && existsSync(opts.storedTranscriptPath)) ||
      existsSync(transcriptPathFor(opts.cwd, reservedId)))

  return planClaudeLaunch({
    reservedId,
    hasTranscript,
    supportsSessionId: SUPPORTS_SESSION_ID,
    newId: randomUUID(),
    flags: opts.flags,
  })
}
