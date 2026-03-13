export type PipelineStage = 'planning' | 'implementing' | 'validating' | 'reviewing' | 'done' | 'failed' | 'paused'

export interface PipelineConfig {
  enabled: boolean
  maxRetries: number
  buildCommand: string
  testCommand: string
}

export interface PipelineRun {
  id: string
  folderName: string
  folderPath: string
  taskDescription: string
  stage: PipelineStage
  retryCount: number
  maxRetries: number
  logs: PipelineStageLog[]
  createdAt: string
  error?: string
  // Worktree paths per agent
  plannerWorktree?: string
  implementerWorktree?: string
  reviewerWorktree?: string
  // Branch names
  implementerBranch?: string
  reviewerBranch?: string
}

export interface PipelineStageLog {
  stage: PipelineStage
  startedAt: string
  endedAt?: string
  output: string
  success?: boolean
  plan?: string
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  enabled: false,
  maxRetries: 3,
  buildCommand: '',
  testCommand: ''
}
