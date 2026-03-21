import { BrowserWindow } from 'electron'

export type InitStage =
  | 'pending'
  | 'checking_project'
  | 'fetching'
  | 'creating_worktree'
  | 'running_setup'
  | 'spawning_pty'
  | 'waiting_shell'
  | 'ready'
  | 'cancelled'
  | 'failed'

export interface InitProgress {
  sessionId: string
  stage: InitStage
  stageIndex: number
  totalStages: number
  message: string
  startedAt: number
  error?: string
}

type ProgressCallback = (progress: InitProgress) => void

/** Ordered list of stages in the normal (happy-path) flow */
const STAGE_ORDER: InitStage[] = [
  'pending',
  'checking_project',
  'fetching',
  'creating_worktree',
  'running_setup',
  'spawning_pty',
  'waiting_shell',
  'ready',
]

export class WorkspaceInitInstance {
  readonly sessionId: string
  private stage: InitStage = 'pending'
  private startedAt = Date.now()
  private error?: string
  private callbacks: ProgressCallback[] = []
  private mainWindow: BrowserWindow | null

  constructor(sessionId: string, mainWindow: BrowserWindow | null) {
    this.sessionId = sessionId
    this.mainWindow = mainWindow
  }

  /** Move to the next stage and emit progress */
  advance(stage: InitStage, message?: string): void {
    if (this.stage === 'cancelled' || this.stage === 'failed') return
    this.stage = stage
    this.emit(message ?? this.defaultMessage(stage))
  }

  /** Mark the init as cancelled */
  cancel(): void {
    if (this.stage === 'ready' || this.stage === 'failed') return
    this.stage = 'cancelled'
    this.emit('Cancelled by user')
  }

  /** Mark the init as failed with an error */
  fail(error: string): void {
    if (this.stage === 'cancelled') return
    this.stage = 'failed'
    this.error = error
    this.emit(error)
  }

  /** Check if the user has requested cancellation */
  isCancelled(): boolean {
    return this.stage === 'cancelled'
  }

  /** Register a listener for progress events */
  onProgress(callback: ProgressCallback): void {
    this.callbacks.push(callback)
  }

  /** Get the current progress snapshot */
  getProgress(): InitProgress {
    return {
      sessionId: this.sessionId,
      stage: this.stage,
      stageIndex: this.stageIndex(),
      totalStages: STAGE_ORDER.length,
      message: this.defaultMessage(this.stage),
      startedAt: this.startedAt,
      error: this.error,
    }
  }

  private stageIndex(): number {
    const idx = STAGE_ORDER.indexOf(this.stage)
    return idx >= 0 ? idx : STAGE_ORDER.length - 1
  }

  private defaultMessage(stage: InitStage): string {
    switch (stage) {
      case 'pending': return 'Starting...'
      case 'checking_project': return 'Checking project path...'
      case 'fetching': return 'Fetching latest changes...'
      case 'creating_worktree': return 'Creating git worktree...'
      case 'running_setup': return 'Running setup scripts...'
      case 'spawning_pty': return 'Spawning terminal...'
      case 'waiting_shell': return 'Waiting for shell...'
      case 'ready': return 'Ready'
      case 'cancelled': return 'Cancelled'
      case 'failed': return this.error || 'Failed'
    }
  }

  private emit(message: string): void {
    const progress: InitProgress = {
      sessionId: this.sessionId,
      stage: this.stage,
      stageIndex: this.stageIndex(),
      totalStages: STAGE_ORDER.length,
      message,
      startedAt: this.startedAt,
      error: this.error,
    }

    for (const cb of this.callbacks) {
      try { cb(progress) } catch { /* ignore listener errors */ }
    }

    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('workspace-init-progress', progress)
      }
    } catch { /* window destroyed */ }
  }
}

export class WorkspaceInitTracker {
  private instances = new Map<string, WorkspaceInitInstance>()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  /** Create a tracker instance for a new session init */
  create(sessionId: string): WorkspaceInitInstance {
    // Clean up any stale instance
    this.instances.delete(sessionId)
    const instance = new WorkspaceInitInstance(sessionId, this.mainWindow)
    this.instances.set(sessionId, instance)
    return instance
  }

  /** Cancel an in-progress init by session ID */
  cancel(sessionId: string): boolean {
    const instance = this.instances.get(sessionId)
    if (!instance) return false
    instance.cancel()
    return true
  }

  /** Remove a tracked instance (cleanup) */
  remove(sessionId: string): void {
    this.instances.delete(sessionId)
  }

  /** Get a tracker instance */
  get(sessionId: string): WorkspaceInitInstance | undefined {
    return this.instances.get(sessionId)
  }
}

export const workspaceInitTracker = new WorkspaceInitTracker()
