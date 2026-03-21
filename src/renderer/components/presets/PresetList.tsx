import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { SessionPreset, SessionPresetCreate } from '../../../shared/ipc-types'
import { PresetCard } from './PresetCard'
import { PresetEditor } from './PresetEditor'

type SortMode = 'recent' | 'most-used' | 'alpha'

interface Props {
  scanPath: string
  onLaunchPreset: (preset: SessionPreset) => void
  onClose: () => void
}

export function PresetList({ scanPath, onLaunchPreset, onClose }: Props) {
  const [presets, setPresets] = useState<SessionPreset[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [editing, setEditing] = useState<SessionPreset | null | 'new'>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const all = await window.api.presetList()
    setPresets(all)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleEdit = useCallback((preset: SessionPreset) => {
    setEditing(preset)
  }, [])

  const handleDelete = useCallback(async (preset: SessionPreset) => {
    await window.api.presetDelete(preset.id)
    refresh()
  }, [refresh])

  const handleTogglePin = useCallback(async (preset: SessionPreset) => {
    await window.api.presetUpdate(preset.id, { pinned: !preset.pinned })
    refresh()
  }, [refresh])

  const handleSave = useCallback(async (input: SessionPresetCreate) => {
    if (editing && editing !== 'new') {
      await window.api.presetUpdate(editing.id, input)
    } else {
      await window.api.presetCreate(input)
    }
    setEditing(null)
    refresh()
  }, [editing, refresh])

  const filtered = useMemo(() => {
    let list = presets
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.projectName.toLowerCase().includes(q)
      )
    }
    switch (sort) {
      case 'recent':
        list = [...list].sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt))
        break
      case 'most-used':
        list = [...list].sort((a, b) => b.useCount - a.useCount)
        break
      case 'alpha':
        list = [...list].sort((a, b) => a.name.localeCompare(b.name))
        break
    }
    return list
  }, [presets, search, sort])

  return (
    <div className="mcp-panel">
      <div className="mcp-panel-header">
        <div className="mcp-panel-tabs">
          <span className="mcp-panel-tab active">
            Presets ({filtered.length}{search ? ` / ${presets.length}` : ''})
          </span>
        </div>
        <button className="coach-close-btn" onClick={onClose} title="Close">x</button>
      </div>
      <div className="preset-list-controls">
        <input
          className="preset-list-search"
          type="text"
          placeholder="Search presets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <select
          className="preset-list-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
        >
          <option value="recent">Recently used</option>
          <option value="most-used">Most used</option>
          <option value="alpha">A-Z</option>
        </select>
        <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>
          + New
        </button>
      </div>
      <div className="mcp-content">
        {loading ? (
          <div className="mcp-empty">Loading presets...</div>
        ) : filtered.length === 0 ? (
          <div className="mcp-empty">
            <div style={{ fontSize: 18, marginBottom: 8 }}>{'{ }'}</div>
            <div>
              {search
                ? 'No presets match your search.'
                : 'No presets yet.'}
            </div>
            {!search && (
              <button
                className="btn btn-primary"
                onClick={() => setEditing('new')}
                style={{ marginTop: 12 }}
              >
                Create your first preset
              </button>
            )}
          </div>
        ) : (
          <div className="preset-list-grid">
            {filtered.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                onLaunch={onLaunchPreset}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onTogglePin={handleTogglePin}
              />
            ))}
          </div>
        )}
      </div>
      {editing && (
        <PresetEditor
          preset={editing === 'new' ? null : editing}
          scanPath={scanPath}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
