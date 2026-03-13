import React, { useState, useEffect } from 'react'
import { WorkspaceFolder } from '../../shared/types'

interface Props {
  scanPath: string
  onStart: (folder: WorkspaceFolder, useWorktree: boolean) => void
  onClose: () => void
}

export function NewSessionModal({ scanPath, onStart, onClose }: Props) {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [useWorktree, setUseWorktree] = useState(true)

  useEffect(() => {
    window.api.listWorkspaceFolders(scanPath).then((f) => {
      setFolders(f)
      setLoading(false)
    })
  }, [scanPath])

  const filtered = folders.filter(
    (f) => !search || f.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500, display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          New Claude Session
          <button
            className="btn btn-sm"
            onClick={onClose}
            style={{ fontSize: 16, lineHeight: 1, padding: '2px 8px' }}
          >×</button>
        </h2>
        <input
          className="search-input"
          placeholder="Filter folders..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          style={{ width: '100%', marginBottom: 8 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={useWorktree}
            onChange={(e) => setUseWorktree(e.target.checked)}
          />
          Create git worktree (recommended for isolation)
        </label>
        <div style={{ overflowY: 'auto', maxHeight: '50vh', margin: '0 -24px', padding: '0 24px' }}>
          {loading ? (
            <div style={{ padding: 16, color: 'var(--text-muted)' }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--text-muted)' }}>No folders found</div>
          ) : (
            filtered.map((folder) => (
              <div
                key={folder.path}
                className="new-session-folder-item"
                onClick={() => onStart(folder, useWorktree)}
              >
                <span className="new-session-folder-name">{folder.name}</span>
                <span className="new-session-folder-path">{folder.path}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
