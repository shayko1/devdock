import React, { useState, useEffect, useCallback } from 'react'

interface RtkStatus {
  installed: boolean
  version: string | null
  hookActive: boolean
  path: string | null
}

interface RtkGain {
  totalSaved: number
  savingsPercent: number
  commandCount: number
  raw: string
}

interface Props {
  currentPath: string
  rtkEnabled: boolean
  onSave: (newPath: string, rtkEnabled: boolean) => void
  onClose: () => void
}

export function SettingsModal({ currentPath, rtkEnabled, onSave, onClose }: Props) {
  const [path, setPath] = useState(currentPath)
  const [rtk, setRtk] = useState(rtkEnabled)
  const [rtkStatus, setRtkStatus] = useState<RtkStatus | null>(null)
  const [rtkGain, setRtkGain] = useState<RtkGain | null>(null)
  const [rtkLoading, setRtkLoading] = useState(false)
  const [rtkMessage, setRtkMessage] = useState<string | null>(null)

  const refreshRtkStatus = useCallback(async () => {
    const status = await window.api.rtkDetect()
    setRtkStatus(status)
    if (status.installed) {
      const gain = await window.api.rtkGain()
      setRtkGain(gain)
    }
  }, [])

  useEffect(() => {
    refreshRtkStatus()
  }, [refreshRtkStatus])

  const handleBrowse = async () => {
    const selected = await window.api.selectFolder()
    if (selected) {
      setPath(selected)
    }
  }

  const handleSave = () => {
    if (path.trim()) {
      onSave(path.trim(), rtk)
    }
  }

  const handleToggleRtk = async () => {
    if (!rtkStatus?.installed) return
    setRtkLoading(true)
    setRtkMessage(null)

    if (!rtk) {
      const result = await window.api.rtkEnable()
      if (result.success) {
        setRtk(true)
        setRtkMessage('RTK hook installed. Restart Claude sessions for it to take effect.')
      } else {
        setRtkMessage(`Failed to enable: ${result.output}`)
      }
    } else {
      const result = await window.api.rtkDisable()
      if (result.success) {
        setRtk(false)
        setRtkMessage('RTK hook removed.')
      } else {
        setRtkMessage(`Failed to disable: ${result.output}`)
      }
    }

    setRtkLoading(false)
    await refreshRtkStatus()
  }

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h2>Settings</h2>

        {/* Workspace path */}
        <div style={{ marginBottom: 20 }}>
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

        {/* RTK section */}
        <div style={{
          marginBottom: 20,
          padding: 14,
          borderRadius: 8,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                RTK — Token Compression
              </label>
              <span style={{
                marginLeft: 8,
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 4,
                background: rtkStatus?.installed ? 'var(--green)' : 'var(--text-muted)',
                color: '#000',
                fontWeight: 600
              }}>
                {rtkStatus?.installed ? `v${rtkStatus.version}` : 'Not installed'}
              </span>
            </div>
            {rtkStatus?.installed && (
              <button
                className={`btn btn-sm ${rtk ? 'btn-accent' : 'btn-primary'}`}
                onClick={handleToggleRtk}
                disabled={rtkLoading}
                style={{ minWidth: 80 }}
              >
                {rtkLoading ? '...' : rtk ? 'Disable' : 'Enable'}
              </button>
            )}
          </div>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }}>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.api.openInBrowser('https://github.com/rtk-ai/rtk') }}
              style={{ color: 'var(--blue, #58a6ff)', textDecoration: 'none' }}
            >RTK (Rust Token Killer)</a> reduces LLM token consumption by 60-90% by compressing
            CLI output before it reaches Claude. Single Rust binary, {'<'}10ms overhead.
          </p>

          {!rtkStatus?.installed && (
            <div style={{
              padding: '8px 10px',
              borderRadius: 6,
              background: 'var(--bg-tertiary, var(--bg-primary))',
              fontSize: 11,
              color: 'var(--text-secondary)',
              fontFamily: 'monospace'
            }}>
              Install via: <strong>brew install rtk</strong>
            </div>
          )}

          {rtkStatus?.installed && rtkGain && rtkGain.commandCount > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
              marginTop: 8
            }}>
              <div style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--bg-tertiary, var(--bg-primary))',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>
                  {formatTokens(rtkGain.totalSaved)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>tokens saved</div>
              </div>
              <div style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--bg-tertiary, var(--bg-primary))',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--orange)' }}>
                  {rtkGain.savingsPercent.toFixed(0)}%
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>reduction</div>
              </div>
              <div style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--bg-tertiary, var(--bg-primary))',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {rtkGain.commandCount}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>commands</div>
              </div>
            </div>
          )}

          {rtkMessage && (
            <div style={{
              marginTop: 8,
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 11,
              color: 'var(--text-secondary)',
              background: 'var(--bg-tertiary, var(--bg-primary))'
            }}>
              {rtkMessage}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
