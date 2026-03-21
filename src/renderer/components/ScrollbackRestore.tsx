import React, { useEffect, useState } from 'react'
import type { RecoverableSession } from '../../shared/ipc-types'
import './ScrollbackRestore.css'

interface Props {
  onRestore: (sessionId: string, data: string) => void
  onDismissAll: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    return `${diffDay}d ago`
  } catch {
    return iso
  }
}

function folderName(cwd: string): string {
  const parts = cwd.split('/')
  return parts[parts.length - 1] || cwd
}

export function ScrollbackRestore({ onRestore, onDismissAll }: Props) {
  const [sessions, setSessions] = useState<RecoverableSession[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.scrollbackListRecoverable().then((list) => {
      if (!cancelled) {
        setSessions(list)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading || sessions.length === 0) return null

  const handleRestore = async (sessionId: string) => {
    setRestoring(sessionId)
    try {
      const result = await window.api.scrollbackRestore(sessionId)
      if (result) {
        onRestore(sessionId, result.data)
      }
      // Remove from list after restore
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
    } catch (err) {
      console.error('[ScrollbackRestore] Restore failed:', err)
    } finally {
      setRestoring(null)
    }
  }

  const handleDismiss = async (sessionId: string) => {
    try {
      await window.api.scrollbackDismiss(sessionId)
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
    } catch (err) {
      console.error('[ScrollbackRestore] Dismiss failed:', err)
    }
  }

  const handleDismissAll = async () => {
    try {
      await Promise.all(sessions.map(s => window.api.scrollbackDismiss(s.sessionId)))
      setSessions([])
      onDismissAll()
    } catch (err) {
      console.error('[ScrollbackRestore] Dismiss all failed:', err)
    }
  }

  return (
    <div className="scrollback-restore-banner">
      <div className="scrollback-restore-header">
        <span className="scrollback-restore-title">
          Recoverable Sessions ({sessions.length})
        </span>
        <button
          className="scrollback-restore-dismiss-all"
          onClick={handleDismissAll}
        >
          Dismiss All
        </button>
      </div>
      <div className="scrollback-restore-list">
        {sessions.map(s => (
          <div key={s.sessionId} className="scrollback-restore-item">
            <div className="scrollback-restore-info">
              <span className="scrollback-restore-folder">{folderName(s.cwd)}</span>
              <span className="scrollback-restore-meta">
                {formatTime(s.lastWriteAt)} &middot; {formatBytes(s.totalBytes)}
              </span>
            </div>
            <div className="scrollback-restore-actions">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => handleRestore(s.sessionId)}
                disabled={restoring === s.sessionId}
              >
                {restoring === s.sessionId ? 'Restoring...' : 'Restore'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => handleDismiss(s.sessionId)}
                disabled={restoring === s.sessionId}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
