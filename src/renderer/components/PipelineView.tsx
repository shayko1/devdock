import React, { useState, useEffect, useCallback, useRef } from 'react'
import { PipelineRun, PipelineStage, PipelineConfig, DEFAULT_PIPELINE_CONFIG } from '../../shared/pipeline-types'

interface Props {
  folderName: string
  folderPath: string
  onClose: () => void
  onOpenSession?: (folderName: string, folderPath: string, existingWorktreePath: string) => void
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  planning: 'Planning',
  implementing: 'Implementing',
  validating: 'Validating',
  reviewing: 'Reviewing',
  done: 'Done',
  failed: 'Failed',
  paused: 'Paused'
}

const STAGE_ORDER: PipelineStage[] = ['planning', 'implementing', 'validating', 'reviewing']

function StageIndicator({ currentStage }: { currentStage: PipelineStage }) {
  return (
    <div className="pl-stages">
      {STAGE_ORDER.map((stage, i) => {
        const idx = STAGE_ORDER.indexOf(currentStage)
        const isActive = stage === currentStage
        const isDone = idx > i || currentStage === 'done'
        const isFailed = (currentStage === 'failed' || currentStage === 'paused') && i === idx

        return (
          <React.Fragment key={stage}>
            {i > 0 && <div className={`pl-stage-line ${isDone ? 'done' : ''}`} />}
            <div className={`pl-stage-dot ${isActive ? 'active' : ''} ${isDone ? 'done' : ''} ${isFailed ? 'failed' : ''}`}>
              {isDone && !isActive ? '\u2713' : i + 1}
            </div>
            <div className={`pl-stage-label ${isActive ? 'active' : ''}`}>
              {STAGE_LABELS[stage]}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

export function PipelineView({ folderName, folderPath, onClose, onOpenSession }: Props) {
  const [config, setConfig] = useState<PipelineConfig>({ ...DEFAULT_PIPELINE_CONFIG })
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [taskInput, setTaskInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const logEndRef = useRef<HTMLPreElement | null>(null)

  // Load config and runs
  useEffect(() => {
    window.api.pipelineGetConfig(folderPath).then(setConfig)
    window.api.pipelineGetRuns().then((allRuns: PipelineRun[]) => {
      setRuns(allRuns.filter(r => r.folderPath === folderPath))
    })
  }, [folderPath])

  // Listen for pipeline events
  useEffect(() => {
    const unsub = window.api.onPipelineEvent((run: PipelineRun) => {
      if (run.folderPath === folderPath) {
        setRuns(prev => {
          const idx = prev.findIndex(r => r.id === run.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = run
            return next
          }
          return [...prev, run]
        })
        // Auto-expand the active stage log
        if (run.logs.length > 0) {
          const activeIdx = run.logs.length - 1
          setExpandedLog(`${run.id}-${activeIdx}`)
        }
      }
    })
    return unsub
  }, [folderPath])

  // Auto-scroll log output to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollTop = logEndRef.current.scrollHeight
    }
  })

  const handleStart = useCallback(async () => {
    if (!taskInput.trim()) return
    await window.api.pipelineStart(folderName, folderPath, taskInput.trim())
    setTaskInput('')
  }, [folderName, folderPath, taskInput])

  const handleCancel = useCallback((id: string) => {
    window.api.pipelineCancel(id)
  }, [])

  const handleSaveConfig = useCallback(() => {
    window.api.pipelineSetConfig(folderPath, config)
    setShowSettings(false)
  }, [folderPath, config])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleStart()
    }
  }, [handleStart])

  if (!config.enabled && runs.length === 0) {
    return (
      <div className="pl-view">
        <div className="pl-header">
          <span className="pl-title">Autonomous Pipeline</span>
          <button className="bv-close-btn" onClick={onClose}>\u00d7</button>
        </div>
        <div className="pl-disabled">
          <p>The autonomous pipeline is disabled for this project.</p>
          <p className="pl-disabled-hint">
            When enabled, you can describe a task and the pipeline will plan, implement, validate, and review the changes automatically.
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => {
            setConfig(prev => ({ ...prev, enabled: true }))
            window.api.pipelineSetConfig(folderPath, { ...config, enabled: true })
          }}>
            Enable Pipeline
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pl-view">
      <div className="pl-header">
        <span className="pl-title">Pipeline</span>
        <button
          className={`btn btn-sm ${showSettings ? 'btn-accent' : ''}`}
          onClick={() => setShowSettings(!showSettings)}
          style={{ marginLeft: 'auto', marginRight: 8 }}
        >
          Settings
        </button>
        <button className="bv-close-btn" onClick={onClose}>\u00d7</button>
      </div>

      {showSettings && (
        <div className="pl-settings">
          <div className="pl-setting-row">
            <label>Build command</label>
            <input
              value={config.buildCommand}
              onChange={e => setConfig(prev => ({ ...prev, buildCommand: e.target.value }))}
              placeholder="Auto-detect"
            />
          </div>
          <div className="pl-setting-row">
            <label>Test command</label>
            <input
              value={config.testCommand}
              onChange={e => setConfig(prev => ({ ...prev, testCommand: e.target.value }))}
              placeholder="Auto-detect"
            />
          </div>
          <div className="pl-setting-row">
            <label>Max retries</label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.maxRetries}
              onChange={e => setConfig(prev => ({ ...prev, maxRetries: parseInt(e.target.value) || 3 }))}
            />
          </div>
          <div className="pl-setting-actions">
            <button className="btn btn-sm btn-primary" onClick={handleSaveConfig}>Save</button>
            <button className="btn btn-sm" onClick={() => setShowSettings(false)}>Cancel</button>
            <button className="btn btn-sm btn-danger" onClick={() => {
              setConfig(prev => ({ ...prev, enabled: false }))
              window.api.pipelineSetConfig(folderPath, { ...config, enabled: false })
              setShowSettings(false)
            }} style={{ marginLeft: 'auto' }}>
              Disable
            </button>
          </div>
        </div>
      )}

      <div className="pl-input-area">
        <textarea
          className="pl-task-input"
          value={taskInput}
          onChange={e => setTaskInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the task... (Enter to start, Shift+Enter for new line)"
          rows={3}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleStart}
          disabled={!taskInput.trim()}
        >
          Start Pipeline
        </button>
      </div>

      <div className="pl-runs">
        {runs.length === 0 && (
          <div className="pl-empty">No pipeline runs yet. Describe a task above to start.</div>
        )}
        {[...runs].reverse().map(run => (
          <div key={run.id} className={`pl-run pl-run-${run.stage}`}>
            <div className="pl-run-header">
              <div className="pl-run-task">{run.taskDescription.slice(0, 120)}{run.taskDescription.length > 120 ? '...' : ''}</div>
              <div className="pl-run-meta">
                {run.retryCount > 0 && <span className="pl-retry-badge">Retry {run.retryCount}</span>}
                <span className={`pl-status pl-status-${run.stage}`}>
                  {STAGE_LABELS[run.stage]}
                </span>
                {(run.stage === 'planning' || run.stage === 'implementing' || run.stage === 'validating' || run.stage === 'reviewing') && (
                  <button className="btn btn-sm btn-danger" onClick={() => handleCancel(run.id)}>Cancel</button>
                )}
              </div>
            </div>

            <StageIndicator currentStage={run.stage} />

            {run.implementerBranch && (
              <div className="pl-branch-info">
                <span className="pl-branch-label">Branch:</span>
                <code className="pl-branch-name">{run.implementerBranch}</code>
                <button
                  className="btn btn-sm"
                  onClick={() => navigator.clipboard.writeText(run.implementerBranch!)}
                  title="Copy branch name"
                >
                  Copy
                </button>
                {run.implementerWorktree && (
                  <button
                    className="btn btn-sm"
                    onClick={() => window.api.openInFinder(run.implementerWorktree!)}
                    title="Open worktree folder"
                  >
                    Open Folder
                  </button>
                )}
              </div>
            )}

            {(run.stage === 'done' || run.stage === 'failed' || run.stage === 'paused') && run.implementerBranch && (
              <div className="pl-actions">
                {onOpenSession && run.implementerWorktree && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => onOpenSession(run.folderName, run.folderPath, run.implementerWorktree!)}
                    title="Open a Claude Code session in the pipeline worktree to continue working"
                  >
                    Continue in Claude
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    const cmd = `cd "${run.folderPath}" && git diff ${run.implementerBranch}`
                    navigator.clipboard.writeText(cmd)
                  }}
                  title="Copy git diff command to see all changes"
                >
                  Copy Diff Command
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    const cmd = `cd "${run.folderPath}" && git merge ${run.implementerBranch}`
                    navigator.clipboard.writeText(cmd)
                  }}
                  title="Copy merge command to apply changes to current branch"
                >
                  Copy Merge Command
                </button>
                {run.implementerWorktree && (
                  <button
                    className="btn btn-sm"
                    onClick={() => window.api.openInFinder(run.implementerWorktree!)}
                    title="Open worktree folder in Finder"
                  >
                    Open Folder
                  </button>
                )}
              </div>
            )}

            {run.error && (
              <div className="pl-error">{run.error}</div>
            )}

            {run.logs.length > 0 && (
              <div className="pl-logs">
                {run.logs.map((log, i) => {
                  const isRetryMarker = log.output.startsWith('--- Retry ')
                  return (
                  <div key={i} className={`pl-log-entry ${isRetryMarker ? 'pl-log-retry-marker' : ''}`}>
                    <div
                      className="pl-log-header"
                      onClick={() => setExpandedLog(expandedLog === `${run.id}-${i}` ? null : `${run.id}-${i}`)}
                    >
                      <span className={`pl-log-status ${isRetryMarker ? 'retry' : log.success === true ? 'success' : log.success === false ? 'failed' : 'running'}`}>
                        {isRetryMarker ? '\u21bb' : log.success === true ? '\u2713' : log.success === false ? '\u2717' : '\u25cf'}
                      </span>
                      <span className="pl-log-stage">{isRetryMarker ? log.output.split('\n')[0] : STAGE_LABELS[log.stage]}</span>
                      {log.endedAt && (
                        <span className="pl-log-duration">
                          {Math.round((new Date(log.endedAt).getTime() - new Date(log.startedAt).getTime()) / 1000)}s
                        </span>
                      )}
                      <span className="pl-log-expand">{expandedLog === `${run.id}-${i}` ? '\u25bc' : '\u25b6'}</span>
                    </div>
                    {expandedLog === `${run.id}-${i}` && (
                      <pre
                        className="pl-log-output"
                        ref={!log.endedAt ? logEndRef : undefined}
                      >
                        {log.output || '(no output yet)'}
                      </pre>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
