import React, { useState, useRef, useEffect } from 'react'
import type { SessionPreset } from '../../../shared/ipc-types'

interface Props {
  preset: SessionPreset
  compact?: boolean
  onLaunch: (preset: SessionPreset) => void
  onEdit: (preset: SessionPreset) => void
  onDelete: (preset: SessionPreset) => void
  onTogglePin: (preset: SessionPreset) => void
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

const MODEL_LABELS: Record<string, string> = {
  sonnet: 'Sonnet',
  opus: 'Opus',
  haiku: 'Haiku',
}

export function PresetCard({ preset, compact, onLaunch, onEdit, onDelete, onTogglePin }: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  if (compact) {
    return (
      <button
        className="preset-chip"
        onClick={() => onLaunch(preset)}
        onContextMenu={handleContextMenu}
        title={`${preset.name} — ${preset.projectName}`}
      >
        {preset.icon && <span className="preset-chip-icon">{preset.icon}</span>}
        <span className="preset-chip-name">{preset.name}</span>
        {contextMenu && (
          <div
            ref={menuRef}
            className="preset-context-menu"
            style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
          >
            <button onClick={(e) => { e.stopPropagation(); onEdit(preset); setContextMenu(null) }}>Edit</button>
            <button onClick={(e) => { e.stopPropagation(); onTogglePin(preset); setContextMenu(null) }}>
              {preset.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button className="danger" onClick={(e) => { e.stopPropagation(); onDelete(preset); setContextMenu(null) }}>Delete</button>
          </div>
        )}
      </button>
    )
  }

  return (
    <div className="preset-card" onContextMenu={handleContextMenu}>
      <div className="preset-card-header" onClick={() => onLaunch(preset)}>
        <span className="preset-card-icon">{preset.icon || '>'}</span>
        <div className="preset-card-title">
          <span className="preset-card-name">{preset.name}</span>
          <span className="preset-card-project">{preset.projectName}</span>
        </div>
        {preset.pinned && <span className="preset-card-pin" title="Pinned">*</span>}
      </div>
      <div className="preset-card-badges">
        {preset.model && MODEL_LABELS[preset.model] && (
          <span className="preset-badge preset-badge-model">{MODEL_LABELS[preset.model]}</span>
        )}
        {preset.useWorktree && (
          <span className="preset-badge preset-badge-wt">WT</span>
        )}
        {preset.dangerousMode && (
          <span className="preset-badge preset-badge-unsafe">UNSAFE</span>
        )}
        {preset.initialCommands && preset.initialCommands.length > 0 && (
          <span className="preset-badge preset-badge-cmds">{preset.initialCommands.length} cmd{preset.initialCommands.length > 1 ? 's' : ''}</span>
        )}
      </div>
      <div className="preset-card-meta">
        {preset.useCount > 0 && (
          <span>Used {preset.useCount}x</span>
        )}
        {preset.lastUsedAt && (
          <span>{formatTimeAgo(preset.lastUsedAt)}</span>
        )}
      </div>
      {contextMenu && (
        <div
          ref={menuRef}
          className="preset-context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={() => { onEdit(preset); setContextMenu(null) }}>Edit</button>
          <button onClick={() => { onTogglePin(preset); setContextMenu(null) }}>
            {preset.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button className="danger" onClick={() => { onDelete(preset); setContextMenu(null) }}>Delete</button>
        </div>
      )}
    </div>
  )
}
