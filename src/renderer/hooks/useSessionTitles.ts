import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClaudeSession } from './useClaudeSessions'

/**
 * Auto-names sessions so the board shows what each session is *doing* rather
 * than repeating the folder name. Titles come from the session's own Claude
 * transcript via the main-process titler (AI when configured, trimmed first
 * message otherwise).
 *
 * A session's transcript may not exist yet when the session appears, so naming
 * is retried on a slow interval and stops once a session is named, manually
 * renamed, or has burned through its attempts.
 */

/** How often to re-try naming sessions that have nothing to name from yet. */
const RETRY_INTERVAL_MS = 20_000
/** Give up after this many empty attempts so idle sessions stop polling. */
const MAX_ATTEMPTS = 6

interface Options {
  sessions: ClaudeSession[]
  /** Commits a title to session state and disk. */
  setSessionTitle: (sessionId: string, title: string, manual: boolean) => void
}

function attemptKey(session: ClaudeSession): string {
  return `${session.id}:${session.claudeSessionId ?? 'none'}`
}

/**
 * A session is auto-nameable while it is live, unnamed, and the user has not
 * made a choice of their own — including choosing to keep the folder name.
 */
function isEligible(session: ClaudeSession): boolean {
  return !session.exited && !session.initializing && !session.title && !session.titleManual
}

export function useSessionTitles({ sessions, setSessionTitle }: Options) {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())

  // Attempt counts keyed by session + claude id, so a resumed or re-detected
  // session gets a fresh budget instead of inheriting an exhausted one.
  const attemptsRef = useRef<Map<string, number>>(new Map())
  const inFlightRef = useRef<Set<string>>(new Set())
  const sessionsRef = useRef<ClaudeSession[]>(sessions)
  sessionsRef.current = sessions

  const markGenerating = useCallback((sessionId: string, active: boolean) => {
    setGeneratingIds(prev => {
      if (active === prev.has(sessionId)) return prev
      const next = new Set(prev)
      if (active) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }, [])

  const generate = useCallback(async (session: ClaudeSession, force: boolean) => {
    const key = attemptKey(session)
    if (inFlightRef.current.has(session.id)) return
    if (!force) {
      const attempts = attemptsRef.current.get(key) ?? 0
      if (attempts >= MAX_ATTEMPTS) return
      attemptsRef.current.set(key, attempts + 1)
    }

    inFlightRef.current.add(session.id)
    markGenerating(session.id, true)
    try {
      const result = await window.api.sessionTitleGenerate({
        sessionId: session.id,
        folderName: session.folderName,
        cwd: session.worktreePath || session.folderPath,
        claudeSessionId: session.claudeSessionId ?? null,
      })
      if (!result?.title) return

      // The session may have been closed, renamed, or pinned while we waited.
      // An explicit "rename with AI" overrides those; automatic naming yields.
      const current = sessionsRef.current.find(s => s.id === session.id)
      if (!current) return
      if (!force && (current.title || current.titleManual)) return

      setSessionTitle(session.id, result.title, false)
      attemptsRef.current.set(key, MAX_ATTEMPTS)
    } catch {
      /* naming is best-effort — the folder name remains as the label */
    } finally {
      inFlightRef.current.delete(session.id)
      markGenerating(session.id, false)
    }
  }, [markGenerating, setSessionTitle])

  // First pass whenever the session list changes — catches new sessions and
  // sessions that just had their Claude id detected.
  useEffect(() => {
    for (const session of sessions) {
      if (isEligible(session)) generate(session, false)
    }
  }, [sessions, generate])

  // Slow retry for sessions with no transcript yet (nothing typed so far).
  useEffect(() => {
    const pending = sessions.some(
      s => isEligible(s) && (attemptsRef.current.get(attemptKey(s)) ?? 0) < MAX_ATTEMPTS
    )
    if (!pending) return

    const timer = setInterval(() => {
      for (const session of sessionsRef.current) {
        if (isEligible(session)) generate(session, false)
      }
    }, RETRY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [sessions, generate])

  /** Re-name a session from scratch, ignoring any existing title and attempt cap. */
  const regenerateTitle = useCallback((sessionId: string) => {
    const session = sessionsRef.current.find(s => s.id === sessionId)
    if (session) generate(session, true)
  }, [generate])

  return { generatingIds, regenerateTitle }
}
