import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClaudeSession } from './useClaudeSessions'

/** Wait before the first title attempt so the transcript has real content. */
const INITIAL_DELAY_MS = 90_000
/** Re-try interval after the initial delay has passed. */
const RETRY_INTERVAL_MS = 30_000
/** Give up after this many attempts so idle sessions stop polling. */
const MAX_ATTEMPTS = 6

interface Options {
  sessions: ClaudeSession[]
  setSessionTitle: (sessionId: string, title: string, manual: boolean) => void
}

function attemptKey(session: ClaudeSession): string {
  return `${session.id}:${session.claudeSessionId ?? 'none'}`
}

function isEligible(session: ClaudeSession): boolean {
  return !session.exited && !session.initializing && !session.title && !session.titleManual
}

export function useSessionTitles({ sessions, setSessionTitle }: Options) {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())

  const attemptsRef = useRef<Map<string, number>>(new Map())
  const inFlightRef = useRef<Set<string>>(new Set())
  const sessionsRef = useRef<ClaudeSession[]>(sessions)
  const firstSeenRef = useRef<Map<string, number>>(new Map())
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
      const firstSeen = firstSeenRef.current.get(key)
      if (firstSeen && Date.now() - firstSeen < INITIAL_DELAY_MS) return

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

      const current = sessionsRef.current.find(s => s.id === session.id)
      if (!current) return
      if (!force && (current.title || current.titleManual)) return

      setSessionTitle(session.id, result.title, false)
      attemptsRef.current.set(key, MAX_ATTEMPTS)
    } catch {
      /* naming is best-effort */
    } finally {
      inFlightRef.current.delete(session.id)
      markGenerating(session.id, false)
    }
  }, [markGenerating, setSessionTitle])

  // Record first-seen time for new sessions (no immediate generation).
  useEffect(() => {
    const now = Date.now()
    for (const session of sessions) {
      const key = attemptKey(session)
      if (!firstSeenRef.current.has(key)) {
        firstSeenRef.current.set(key, now)
      }
    }
  }, [sessions])

  // Periodic timer: waits for the initial delay, then retries at RETRY_INTERVAL.
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

  const regenerateTitle = useCallback((sessionId: string) => {
    const session = sessionsRef.current.find(s => s.id === sessionId)
    if (session) generate(session, true)
  }, [generate])

  return { generatingIds, regenerateTitle }
}
