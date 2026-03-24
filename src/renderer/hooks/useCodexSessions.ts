import { useState, useCallback, useEffect } from 'react'
import { WorkspaceFolder } from '../../shared/types'

export interface CodexSession {
  id: string
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  exited?: boolean
  initializing?: boolean
}

interface UseCodexSessionsOptions {
  onSessionActivated?: () => void
}

export function useCodexSessions({ onSessionActivated }: UseCodexSessionsOptions = {}) {
  const [sessions, setSessions] = useState<CodexSession[]>([])

  // Listen for PTY exits
  useEffect(() => {
    const unsub = window.api.onPtyExit(({ sessionId }) => {
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, exited: true } : s))
    })
    return unsub
  }, [])

  const startSession = useCallback(async (folder: WorkspaceFolder, useWorktree: boolean) => {
    const sessionId = `codex-${Date.now().toString(36)}`

    const placeholder: CodexSession = {
      id: sessionId,
      folderName: folder.name,
      folderPath: folder.path,
      worktreePath: null,
      branchName: null,
      initializing: true,
    }
    setSessions(prev => [...prev, placeholder])
    onSessionActivated?.()

    try {
      const result = await window.api.ptyCreate({
        sessionId,
        folderName: folder.name,
        folderPath: folder.path,
        useWorktree,
        tool: 'codex',
      })
      if (result.success) {
        setSessions(prev => prev.map(s =>
          s.id === sessionId
            ? { ...s, folderName: result.folderName || folder.name, worktreePath: result.worktreePath ?? null, branchName: result.branchName ?? null, initializing: false }
            : s
        ))
      } else {
        setSessions(prev => prev.filter(s => s.id !== sessionId))
        if (result.error !== 'Cancelled') alert(`Failed to create Codex session: ${result.error}`)
      }
    } catch (err) {
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      alert(`Error creating Codex session: ${err}`)
    }
  }, [onSessionActivated])

  const closeSession = useCallback(async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    await window.api.ptyDestroy(sessionId)

    if (session?.worktreePath) {
      const keep = confirm(
        `Session "${session.folderName}" used a git worktree.\n\nKeep the worktree branch for later?\n\n• OK = Keep\n• Cancel = Delete worktree`
      )
      if (!keep) {
        await window.api.cleanupWorktree(session.worktreePath, session.folderPath || '')
      }
    }

    setSessions(prev => prev.filter(s => s.id !== sessionId))
  }, [sessions])

  return { sessions, startSession, closeSession }
}
