import React, { useState, useEffect, useCallback } from 'react'
import type { SessionPreset, SessionPresetCreate } from '../../../shared/ipc-types'
import { PresetCard } from './PresetCard'
import { PresetEditor } from './PresetEditor'

interface Props {
  scanPath: string
  onLaunchPreset: (preset: SessionPreset) => void
  onShowAllPresets: () => void
}

export function PresetBar({ scanPath, onLaunchPreset, onShowAllPresets }: Props) {
  const [pinnedPresets, setPinnedPresets] = useState<SessionPreset[]>([])
  const [recentPresets, setRecentPresets] = useState<SessionPreset[]>([])
  const [editing, setEditing] = useState<SessionPreset | null | 'new'>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const [pinned, recent] = await Promise.all([
      window.api.presetGetPinned(),
      window.api.presetGetRecent(3),
    ])
    setPinnedPresets(pinned)
    // Only show recent that are not already pinned
    const pinnedIds = new Set(pinned.map(p => p.id))
    setRecentPresets(recent.filter(r => !pinnedIds.has(r.id)))
    setLoaded(true)
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

  const displayPresets = [...pinnedPresets, ...recentPresets]

  if (!loaded) return null

  if (displayPresets.length === 0) {
    return (
      <div className="preset-bar preset-bar-empty">
        <button className="preset-bar-hint" onClick={() => setEditing('new')}>
          + Save a preset for quick launch
        </button>
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

  return (
    <div className="preset-bar">
      <div className="preset-bar-chips">
        {displayPresets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            compact
            onLaunch={onLaunchPreset}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onTogglePin={handleTogglePin}
          />
        ))}
        <button
          className="preset-bar-add"
          onClick={() => setEditing('new')}
          title="Create new preset"
        >+</button>
        {displayPresets.length > 0 && (
          <button
            className="preset-bar-all"
            onClick={onShowAllPresets}
            title="View all presets"
          >...</button>
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
