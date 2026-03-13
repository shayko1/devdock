import React, { useState } from 'react'

interface Props {
  currentPath: string
  onSave: (newPath: string) => void
  onClose: () => void
}

export function SettingsModal({ currentPath, onSave, onClose }: Props) {
  const [path, setPath] = useState(currentPath)

  const handleBrowse = async () => {
    const selected = await window.api.selectFolder()
    if (selected) {
      setPath(selected)
    }
  }

  const handleSave = () => {
    if (path.trim()) {
      onSave(path.trim())
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <h2>Settings</h2>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
            Workspace Path
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            The root directory that DevDock scans for projects and folders.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="search-input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/your/workspace"
              style={{ flex: 1 }}
            />
            <button className="btn btn-sm" onClick={handleBrowse}>
              Browse
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
