import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { InitProgress, InitStage } from '../../shared/ipc-types'
import './WorkspaceInitProgress.css'

interface Props {
  sessionId: string
  onReady: () => void
  onCancel: () => void
  onRetry: () => void
}

const STAGE_LABELS: Record<InitStage, string> = {
  pending: 'Starting',
  checking_project: 'Checking project',
  fetching: 'Fetching changes',
  creating_worktree: 'Creating worktree',
  running_setup: 'Running setup',
  spawning_pty: 'Spawning terminal',
  waiting_shell: 'Waiting for shell',
  ready: 'Ready',
  cancelled: 'Cancelled',
  failed: 'Failed',
}

/** Ordered stages for the stepper display */
const VISIBLE_STAGES: InitStage[] = [
  'checking_project',
  'fetching',
  'creating_worktree',
  'running_setup',
  'spawning_pty',
  'waiting_shell',
  'ready',
]

export function WorkspaceInitProgress({ sessionId, onReady, onCancel, onRetry }: Props) {
  const [progress, setProgress] = useState<InitProgress | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const startedAtRef = useRef(Date.now())
  const readyFiredRef = useRef(false)

  useEffect(() => {
    const unsub = window.api.onWorkspaceInitProgress((data: InitProgress) => {
      if (data.sessionId !== sessionId) return
      setProgress(data)
      startedAtRef.current = data.startedAt

      if (data.stage === 'ready' && !readyFiredRef.current) {
        readyFiredRef.current = true
        // Small delay for the "Ready" step to be visible
        setTimeout(onReady, 300)
      }
    })
    return unsub
  }, [sessionId, onReady])

  // Elapsed time counter
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const handleCancel = useCallback(() => {
    window.api.workspaceInitCancel(sessionId)
    onCancel()
  }, [sessionId, onCancel])

  const currentStage = progress?.stage || 'pending'
  const currentIndex = progress?.stageIndex ?? 0
  const isFailed = currentStage === 'failed'
  const isCancelled = currentStage === 'cancelled'
  const isTerminal = isFailed || isCancelled
  const isReady = currentStage === 'ready'

  const formatElapsed = (s: number): string => {
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  // Progress fraction (0-1)
  const totalStages = progress?.totalStages || 8
  const progressFraction = Math.min(currentIndex / (totalStages - 1), 1)

  return (
    <div className="workspace-init-progress">
      <div className="wip-container">
        <div className="wip-header">
          <div className="wip-title">
            {isTerminal ? (isFailed ? 'Initialization Failed' : 'Initialization Cancelled') : 'Setting up workspace...'}
          </div>
          <div className="wip-elapsed">{formatElapsed(elapsed)}</div>
        </div>

        {/* Progress bar */}
        <div className="wip-progress-bar">
          <div
            className={`wip-progress-fill ${isFailed ? 'error' : isCancelled ? 'cancelled' : isReady ? 'success' : ''}`}
            style={{ width: `${progressFraction * 100}%` }}
          />
        </div>

        {/* Stepper */}
        <div className="wip-stepper">
          {VISIBLE_STAGES.map((stage) => {
            const stageIdx = VISIBLE_STAGES.indexOf(stage)
            const currentVisibleIdx = VISIBLE_STAGES.indexOf(currentStage as InitStage)
            const isComplete = !isTerminal && currentVisibleIdx > stageIdx
            const isCurrent = !isTerminal && currentStage === stage
            const isPending = !isTerminal && !isComplete && !isCurrent

            return (
              <div
                key={stage}
                className={`wip-step ${isComplete ? 'complete' : ''} ${isCurrent ? 'current' : ''} ${isPending ? 'pending' : ''}`}
              >
                <div className="wip-step-indicator">
                  {isComplete ? (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                    </svg>
                  ) : isCurrent ? (
                    <div className="wip-spinner" />
                  ) : (
                    <div className="wip-step-dot" />
                  )}
                </div>
                <span className="wip-step-label">{STAGE_LABELS[stage]}</span>
              </div>
            )
          })}
        </div>

        {/* Status message */}
        <div className={`wip-message ${isFailed ? 'error' : ''}`}>
          {progress?.message || 'Preparing...'}
        </div>

        {/* Error details */}
        {isFailed && progress?.error && (
          <div className="wip-error-detail">
            {progress.error}
          </div>
        )}

        {/* Action buttons */}
        <div className="wip-actions">
          {isTerminal ? (
            <>
              <button className="btn btn-sm btn-primary" onClick={onRetry}>
                Retry
              </button>
              <button className="btn btn-sm" onClick={onCancel}>
                Close
              </button>
            </>
          ) : !isReady ? (
            <button className="btn btn-sm" onClick={handleCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
