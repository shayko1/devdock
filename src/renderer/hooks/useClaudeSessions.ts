import { useState, useCallback, useRef, useEffect } from 'react'
import { WorkspaceFolder } from '../../shared/types'

export interface ClaudeSession {
  id: string
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  exited?: boolean
  claudeSessionId?: string | null
  dangerousMode?: boolean
  pendingRecap?: boolean
  /** Card label. Absent means "show the folder name". */
  title?: string
  /** True when the user chose the label — auto-naming leaves it alone. */
  titleManual?: boolean
  initializing?: boolean
  columnId?: string
}

interface UseClaudeSessionsOptions {
  dangerousMode: boolean
  defaultModel?: string
  onSessionActivated?: () => void
  onNewSessionModalClosed?: () => void
}

function generateSessionId(): string {
  return `claude-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
}

export function useClaudeSessions({ dangerousMode, defaultModel, onSessionActivated, onNewSessionModalClosed }: UseClaudeSessionsOptions) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([])

  // Auto-resume sessions on startup
  const autoResumeRef = useRef(false)
  useEffect(() => {
    if (autoResumeRef.current) return
    autoResumeRef.current = true
    localStorage.removeItem('devdock-claude-sessions')

    const restoreSessions = async () => {
      const saved = await window.api.activeSessionsGetAll()
      if (saved.length === 0) return
      onSessionActivated?.()

      // Restore all sessions first, then batch-add to state so the
      // active-session effect can find the preferred session in one pass.
      // IMPORTANT: reuse the original session id so ChatInputBar's per-session
      // cache (model, effort, context) rehydrates correctly.
      const restored: ClaudeSession[] = []
      for (const rec of saved) {
        try {
          const result = await window.api.ptyCreate({
            sessionId: rec.id,
            folderName: rec.folderName,
            folderPath: rec.folderPath,
            useWorktree: false,
            resumeClaudeId: rec.claudeSessionId || undefined,
            existingWorktreePath: rec.worktreePath || undefined,
            dangerousMode: rec.dangerousMode,
          })
          if (result.success) {
            restored.push({
              id: rec.id,
              folderName: result.folderName || rec.folderName,
              folderPath: rec.folderPath,
              worktreePath: result.worktreePath ?? rec.worktreePath,
              branchName: result.branchName ?? rec.branchName,
              claudeSessionId: rec.claudeSessionId ?? null,
              dangerousMode: rec.dangerousMode,
              columnId: rec.columnId,
              title: rec.title,
              titleManual: rec.titleManual,
            })
            // Refresh the active-session record (worktree/branch may have changed)
            window.api.activeSessionsSet({
              id: rec.id,
              claudeSessionId: rec.claudeSessionId,
              folderName: rec.folderName,
              folderPath: rec.folderPath,
              worktreePath: result.worktreePath ?? rec.worktreePath,
              branchName: result.branchName ?? rec.branchName,
              dangerousMode: rec.dangerousMode,
              columnId: rec.columnId,
              title: rec.title,
              titleManual: rec.titleManual,
            })
          } else {
            window.api.activeSessionsRemove(rec.id)
          }
        } catch {
          window.api.activeSessionsRemove(rec.id)
        }
      }
      if (restored.length > 0) {
        setSessions(restored)
      }
    }
    restoreSessions()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for PTY exits
  useEffect(() => {
    const unsub = window.api.onPtyExit(({ sessionId }) => {
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, exited: true } : s))
    })
    return unsub
  }, [])

  // Claude reports its own session id through the statusline bridge, including
  // after /clear or /resume changes it. The main process persists it; this only
  // mirrors it into card state. No polling, no guessing which transcript is ours.
  useEffect(() => {
    const unsub = window.api.onStatuslineData(({ sessionId, claudeSessionId }) => {
      if (!claudeSessionId) return
      setSessions(prev => prev.map(s =>
        s.id === sessionId && s.claudeSessionId !== claudeSessionId
          ? { ...s, claudeSessionId }
          : s
      ))
    })
    return () => { unsub() }
  }, [])

  const startSession = useCallback(async (folder: WorkspaceFolder, useWorktree: boolean) => {
    const sessionId = `claude-${Date.now().toString(36)}`
    const isDangerous = dangerousMode

    let firstColumnId: string | undefined
    try {
      const cols = await window.api.kanbanGetColumns()
      if (cols.length > 0) {
        const sorted = [...cols].sort((a, b) => a.order - b.order)
        firstColumnId = sorted[0].id
      }
    } catch { /* kanban not ready yet */ }

    // Add session immediately in initializing state so the UI shows progress
    const placeholderSession: ClaudeSession = {
      id: sessionId,
      folderName: folder.name,
      folderPath: folder.path,
      worktreePath: null,
      branchName: null,
      claudeSessionId: null,
      dangerousMode: isDangerous,
      initializing: true,
      columnId: firstColumnId,
    }
    setSessions(prev => [...prev, placeholderSession])
    onNewSessionModalClosed?.()
    onSessionActivated?.()

    try {
      const result = await window.api.ptyCreate({
        sessionId,
        folderName: folder.name,
        folderPath: folder.path,
        useWorktree,
        dangerousMode: isDangerous,
        model: defaultModel || undefined,
      })
      if (result.success) {
        // Update from initializing to live session
        setSessions(prev => prev.map(s =>
          s.id === sessionId
            ? {
                ...s,
                folderName: result.folderName || folder.name,
                worktreePath: result.worktreePath ?? null,
                branchName: result.branchName ?? null,
                claudeSessionId: result.claudeSessionId ?? null,
                initializing: false,
              }
            : s
        ))

        window.api.activeSessionsSet({
          id: sessionId,
          claudeSessionId: result.claudeSessionId ?? null,
          folderName: result.folderName || folder.name,
          folderPath: folder.path,
          worktreePath: result.worktreePath ?? null,
          branchName: result.branchName ?? null,
          dangerousMode: isDangerous,
          columnId: firstColumnId,
        })
      } else {
        // Remove the placeholder session on failure
        setSessions(prev => prev.filter(s => s.id !== sessionId))
        if (result.error !== 'Cancelled') {
          alert(`Failed to create session: ${result.error}`)
        }
      }
    } catch (err) {
      // Remove the placeholder session on error
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      alert(`Error creating session: ${err}`)
    }
  }, [dangerousMode, defaultModel, onSessionActivated, onNewSessionModalClosed])

  const resumeSession = useCallback(async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (!session || !session.claudeSessionId) return

    const newPtyId = `claude-${Date.now().toString(36)}`
    try {
      const result = await window.api.ptyCreate({
        sessionId: newPtyId,
        folderName: session.folderName,
        folderPath: session.folderPath,
        useWorktree: false,
        resumeClaudeId: session.claudeSessionId,
        existingWorktreePath: session.worktreePath || undefined,
        dangerousMode: session.dangerousMode
      })
      if (result.success) {
        setSessions(prev => prev.map(s =>
          s.id === sessionId
            ? { ...s, id: newPtyId, exited: false, worktreePath: result.worktreePath ?? s.worktreePath, branchName: result.branchName ?? s.branchName }
            : s
        ))

        window.api.activeSessionsRemove(sessionId)
        window.api.activeSessionsSet({
          id: newPtyId,
          claudeSessionId: result.claudeSessionId ?? session.claudeSessionId,
          folderName: session.folderName,
          folderPath: session.folderPath,
          worktreePath: result.worktreePath ?? session.worktreePath,
          branchName: result.branchName ?? session.branchName,
          dangerousMode: session.dangerousMode,
          columnId: session.columnId,
          title: session.title,
          titleManual: session.titleManual,
        })
      } else {
        alert(`Failed to resume session: ${result.error}`)
      }
    } catch (err) {
      alert(`Error resuming session: ${err}`)
    }
  }, [sessions])

  const openPipelineSession = useCallback(async (pipelineFolderName: string, pipelineFolderPath: string, worktreePath: string) => {
    const sessionId = `claude-${Date.now().toString(36)}`
    const isDangerous = dangerousMode
    try {
      const result = await window.api.ptyCreate({
        sessionId,
        folderName: pipelineFolderName,
        folderPath: pipelineFolderPath,
        useWorktree: false,
        existingWorktreePath: worktreePath,
        dangerousMode: isDangerous
      })
      if (result.success) {
        const newSession: ClaudeSession = {
          id: sessionId,
          folderName: result.folderName || pipelineFolderName,
          folderPath: pipelineFolderPath,
          worktreePath: result.worktreePath ?? worktreePath,
          branchName: result.branchName ?? null,
          claudeSessionId: result.claudeSessionId ?? null,
          dangerousMode: isDangerous
        }
        setSessions(prev => [...prev, newSession])
        onSessionActivated?.()

        window.api.activeSessionsSet({
          id: sessionId,
          claudeSessionId: newSession.claudeSessionId ?? null,
          folderName: newSession.folderName,
          folderPath: newSession.folderPath,
          worktreePath: newSession.worktreePath,
          branchName: newSession.branchName,
          dangerousMode: isDangerous,
        })
      }
    } catch (err) {
      alert(`Error opening pipeline session: ${err}`)
    }
  }, [dangerousMode, onSessionActivated])

  const resumeFromHistory = useCallback(async (claudeSessionId: string, folderName: string, folderPath: string, worktreePath?: string | null) => {
    if (sessions.some(s => s.claudeSessionId === claudeSessionId && !s.exited)) return

    const newId = `claude-${Date.now().toString(36)}`
    const isDangerous = dangerousMode
    try {
      const result = await window.api.ptyCreate({
        sessionId: newId,
        folderName,
        folderPath,
        useWorktree: false,
        resumeClaudeId: claudeSessionId,
        existingWorktreePath: worktreePath || undefined,
        dangerousMode: isDangerous,
      })
      if (result.success) {
        const newSession: ClaudeSession = {
          id: newId,
          folderName: result.folderName || folderName,
          folderPath,
          worktreePath: result.worktreePath ?? worktreePath ?? null,
          branchName: result.branchName ?? null,
          claudeSessionId,
          dangerousMode: isDangerous,
          pendingRecap: true,
        }
        setSessions(prev => [...prev, newSession])
        onSessionActivated?.()

        window.api.activeSessionsSet({
          id: newId,
          claudeSessionId,
          folderName,
          folderPath,
          worktreePath: newSession.worktreePath,
          branchName: newSession.branchName,
          dangerousMode: isDangerous,
        })
      } else {
        alert(`Failed to resume: ${result.error}`)
      }
    } catch (err) {
      alert(`Error resuming from history: ${err}`)
    }
  }, [sessions, dangerousMode, onSessionActivated])

  const closeSession = useCallback(async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    await window.api.ptyDestroy(sessionId)

    if (session?.worktreePath) {
      const keep = confirm(
        `Session "${session.folderName}" used a git worktree.\n\n` +
        `Keep the worktree branch for later?\n\n` +
        `• OK = Keep worktree (you can use it later)\n` +
        `• Cancel = Delete worktree and branch`
      )
      if (!keep) {
        await window.api.cleanupWorktree(session.worktreePath, session.folderPath || '')
      }
    }

    window.api.activeSessionsRemove(sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
  }, [sessions])

  const launchPreset = useCallback(async (presetId: string) => {
    const sessionId = `claude-${Date.now().toString(36)}`
    try {
      const result = await window.api.presetLaunch({ presetId, sessionId })
      if (result.success && result.preset) {
        const preset = result.preset
        const newSession: ClaudeSession = {
          id: sessionId,
          folderName: result.folderName || preset.projectName,
          folderPath: preset.projectPath,
          worktreePath: result.worktreePath ?? null,
          branchName: result.branchName ?? null,
          claudeSessionId: result.claudeSessionId ?? null,
          dangerousMode: preset.dangerousMode,
        }
        setSessions(prev => [...prev, newSession])
        onSessionActivated?.()

        window.api.activeSessionsSet({
          id: sessionId,
          claudeSessionId: newSession.claudeSessionId ?? null,
          folderName: newSession.folderName,
          folderPath: newSession.folderPath,
          worktreePath: newSession.worktreePath,
          branchName: newSession.branchName,
          dangerousMode: preset.dangerousMode,
        })
      } else {
        alert(`Failed to launch preset: ${result.error}`)
      }
    } catch (err) {
      alert(`Error launching preset: ${err}`)
    }
  }, [onSessionActivated])

  const updateSessionColumn = useCallback((sessionId: string, columnId: string) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, columnId } : s))
    window.api.kanbanMoveSession(sessionId, columnId)
  }, [])

  /**
   * Set a session's card title. `manual` records that the user chose it, which
   * pins the title against auto-naming. Callers decide whether the write is
   * allowed — see useSessionTitles for the auto-naming policy.
   */
  const setSessionTitle = useCallback((sessionId: string, title: string, manual: boolean) => {
    const trimmed = title.trim()
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? { ...s, title: trimmed || undefined, titleManual: manual }
        : s
    ))
    window.api.activeSessionsSetTitle(sessionId, trimmed || null, manual)
  }, [])

  /**
   * Pin a session back to its folder name. Counts as a manual choice so
   * auto-naming does not immediately re-title it.
   */
  const clearSessionTitle = useCallback((sessionId: string) => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, title: undefined, titleManual: true } : s
    ))
    window.api.activeSessionsSetTitle(sessionId, null, true)
  }, [])

  return {
    sessions,
    startSession,
    resumeSession,
    openPipelineSession,
    resumeFromHistory,
    closeSession,
    launchPreset,
    updateSessionColumn,
    setSessionTitle,
    clearSessionTitle,
  }
}
