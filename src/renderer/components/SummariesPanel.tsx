import React, { useState, useEffect, useCallback, useRef } from 'react'
import './SummariesPanel.css'

interface SessionSummary {
  id: string
  title: string
  projectName: string
  projectPath: string
  claudeSessionId: string | null
  sessionPtyId: string | null
  createdAt: number
  htmlFileName: string
}

interface Props {
  projectName: string
  projectPath: string
  sessionId: string | null
  claudeSessionId: string | null
  onClose: () => void
  onResumeSession?: (claudeSessionId: string, folderName: string, folderPath: string) => void
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function SummariesPanel({ projectName, projectPath, sessionId, claudeSessionId, onClose, onResumeSession }: Props) {
  const [summaries, setSummaries] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'project'>('all')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [saveFilePath, setSaveFilePath] = useState('')
  const [htmlDetected, setHtmlDetected] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const loadSummaries = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.summaryList(filter === 'project' ? projectName : undefined)
      setSummaries(list)
    } catch { setSummaries([]) }
    setLoading(false)
  }, [filter, projectName])

  useEffect(() => { loadSummaries() }, [loadSummaries])

  // Detect HTML files from terminal output
  useEffect(() => {
    if (!sessionId) return
    const unsub = window.api.onPtyData(({ sessionId: sid, data }) => {
      if (sid !== sessionId) return
      const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
      const htmlMatch = clean.match(/(?:\/[\w./-]+\.html)\b/g)
      if (htmlMatch) {
        const path = htmlMatch[htmlMatch.length - 1]
        if (path.includes('/') && !path.startsWith('http')) {
          setHtmlDetected(path)
        }
      }
    })
    return () => { unsub() }
  }, [sessionId])

  const handleSave = useCallback(async () => {
    if (!saveTitle.trim()) return
    setSaving(true)
    try {
      if (saveFilePath.trim()) {
        await window.api.summarySaveFromFile(
          saveFilePath.trim(), saveTitle.trim(), projectName, projectPath,
          claudeSessionId, sessionId
        )
      }
      setShowSaveForm(false)
      setSaveTitle('')
      setSaveFilePath('')
      loadSummaries()
    } catch { /* ignore */ }
    setSaving(false)
  }, [saveTitle, saveFilePath, projectName, projectPath, claudeSessionId, sessionId, loadSummaries])

  const handleSaveDetected = useCallback(async (filePath: string) => {
    const title = `Summary - ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    setSaving(true)
    try {
      await window.api.summarySaveFromFile(
        filePath, title, projectName, projectPath,
        claudeSessionId, sessionId
      )
      setHtmlDetected(null)
      loadSummaries()
    } catch { /* ignore */ }
    setSaving(false)
  }, [projectName, projectPath, claudeSessionId, sessionId, loadSummaries])

  const handleDelete = useCallback(async (id: string) => {
    await window.api.summaryDelete(id)
    if (previewId === id) { setPreviewId(null); setPreviewHtml(null) }
    loadSummaries()
  }, [previewId, loadSummaries])

  const handlePreview = useCallback(async (id: string) => {
    if (previewId === id) { setPreviewId(null); setPreviewHtml(null); return }
    try {
      const data = await window.api.summaryGet(id)
      if (data) { setPreviewId(id); setPreviewHtml(data.html) }
    } catch { /* ignore */ }
  }, [previewId])

  const handleOpenInBrowser = useCallback((id: string) => {
    window.api.summaryOpenInBrowser(id)
  }, [])

  const handleResume = useCallback((summary: SessionSummary) => {
    if (summary.claudeSessionId && onResumeSession) {
      onResumeSession(summary.claudeSessionId, summary.projectName, summary.projectPath)
    }
  }, [onResumeSession])

  return (
    <div className="summaries-panel">
      <div className="summaries-header">
        <div className="summaries-header-left">
          <span className="summaries-title">Summaries</span>
          <span className="summaries-count">{summaries.length}</span>
        </div>
        <button className="coach-close-btn" onClick={onClose} title="Close">×</button>
      </div>

      {/* HTML file detected banner */}
      {htmlDetected && (
        <div className="summaries-detected">
          <span className="summaries-detected-icon">&#128196;</span>
          <div className="summaries-detected-text">
            <div className="summaries-detected-label">HTML file detected</div>
            <div className="summaries-detected-path" title={htmlDetected}>{htmlDetected.split('/').pop()}</div>
          </div>
          <button
            className="btn btn-xs btn-primary"
            onClick={() => handleSaveDetected(htmlDetected)}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button className="summaries-detected-dismiss" onClick={() => setHtmlDetected(null)}>×</button>
        </div>
      )}

      <div className="summaries-controls">
        <div className="summaries-filter">
          <button
            className={`summaries-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >All</button>
          <button
            className={`summaries-filter-btn ${filter === 'project' ? 'active' : ''}`}
            onClick={() => setFilter('project')}
          >This Project</button>
        </div>
        <button
          className="btn btn-xs"
          onClick={() => { setShowSaveForm(!showSaveForm); setSaveTitle(''); setSaveFilePath('') }}
        >
          + Save
        </button>
      </div>

      {/* Save form */}
      {showSaveForm && (
        <div className="summaries-save-form">
          <input
            className="summaries-input"
            value={saveTitle}
            onChange={e => setSaveTitle(e.target.value)}
            placeholder="Summary title"
            autoFocus
          />
          <input
            className="summaries-input"
            value={saveFilePath}
            onChange={e => setSaveFilePath(e.target.value)}
            placeholder="Path to .html file"
          />
          <div className="summaries-save-actions">
            <button className="btn btn-xs" onClick={() => setShowSaveForm(false)}>Cancel</button>
            <button
              className="btn btn-xs btn-primary"
              onClick={handleSave}
              disabled={saving || !saveTitle.trim() || !saveFilePath.trim()}
            >
              {saving ? 'Saving...' : 'Save Summary'}
            </button>
          </div>
        </div>
      )}

      <div className="summaries-list">
        {loading ? (
          <div className="summaries-empty">Loading summaries...</div>
        ) : summaries.length === 0 ? (
          <div className="summaries-empty">
            <div className="summaries-empty-icon">&#128203;</div>
            <div>No summaries yet</div>
            <div className="summaries-empty-hint">
              Ask Claude to summarize the session as HTML, then save it here for quick access.
            </div>
          </div>
        ) : (
          summaries.map(summary => (
            <div key={summary.id} className={`summaries-card ${previewId === summary.id ? 'expanded' : ''}`}>
              <div className="summaries-card-main" onClick={() => handlePreview(summary.id)}>
                <div className="summaries-card-title">{summary.title}</div>
                <div className="summaries-card-meta">
                  <span>{formatDate(summary.createdAt)}</span>
                  <span className="summaries-card-dot">·</span>
                  <span>{summary.projectName}</span>
                </div>
              </div>
              <div className="summaries-card-actions">
                <button
                  className="summaries-action-btn"
                  onClick={() => handleOpenInBrowser(summary.id)}
                  title="Open in browser"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/><path d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/></svg>
                </button>
                {summary.claudeSessionId && onResumeSession && (
                  <button
                    className="summaries-action-btn resume"
                    onClick={() => handleResume(summary)}
                    title="Resume this session"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/></svg>
                  </button>
                )}
                <button
                  className="summaries-action-btn delete"
                  onClick={() => handleDelete(summary.id)}
                  title="Delete summary"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                </button>
              </div>
              {/* Inline preview */}
              {previewId === summary.id && previewHtml && (
                <div className="summaries-preview">
                  <iframe
                    ref={iframeRef}
                    className="summaries-preview-iframe"
                    srcDoc={previewHtml}
                    sandbox="allow-same-origin"
                    title={`Preview: ${summary.title}`}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
