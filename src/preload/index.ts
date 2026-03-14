import { contextBridge, ipcRenderer } from 'electron'
import { AppState, ProcessStatus, Project, WorkspaceFolder } from '../shared/types'
import { AgentInfo } from '../shared/agent-types'
import { CoachConfig, CoachSuggestion, CoachAnalysis, CoachSessionCost } from '../shared/coach-types'

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('get-state'),
  saveState: (state: AppState): Promise<boolean> => ipcRenderer.invoke('save-state', state),
  scanWorkspace: (scanPath: string, maxDepth?: number): Promise<Project[]> => ipcRenderer.invoke('scan-workspace', scanPath, maxDepth),
  startProject: (project: Project): Promise<ProcessStatus> => ipcRenderer.invoke('start-project', project),
  stopProject: (projectId: string): Promise<boolean> => ipcRenderer.invoke('stop-project', projectId),
  getProcessStatuses: (): Promise<ProcessStatus[]> => ipcRenderer.invoke('get-process-statuses'),
  getLogs: (projectId: string): Promise<string[]> => ipcRenderer.invoke('get-logs', projectId),
  openInBrowser: (url: string): Promise<void> => ipcRenderer.invoke('open-in-browser', url),
  detectSystemPorts: (ports: number[]): Promise<Record<number, { port: number; pid: number; command: string }>> =>
    ipcRenderer.invoke('detect-system-ports', ports),
  killSystemProcess: (pid: number): Promise<boolean> => ipcRenderer.invoke('kill-system-process', pid),
  listWorkspaceFolders: (scanPath: string): Promise<WorkspaceFolder[]> =>
    ipcRenderer.invoke('list-workspace-folders', scanPath),
  openInIde: (projectPath: string, ide: 'cursor' | 'zed'): Promise<boolean> =>
    ipcRenderer.invoke('open-in-ide', projectPath, ide),
  openInFinder: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke('open-in-finder', projectPath),
  openInTerminal: (projectPath: string): Promise<boolean> =>
    ipcRenderer.invoke('open-in-terminal', projectPath),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  getGitInfo: (folderPath: string): Promise<{ gitBranch: string | null; gitRemote: string | null }> =>
    ipcRenderer.invoke('get-git-info', folderPath),
  getGitStatus: (folderPath: string): Promise<{
    branch: string | null; baseBranch: string | null; remote: string | null
    filesChanged: number; insertions: number; deletions: number
    commitsAhead: number; uncommitted: number; isGitRepo: boolean
  }> => ipcRenderer.invoke('get-git-status', folderPath),
  openClaudeWorktree: (projectPath: string, projectName: string): Promise<{ success: boolean; worktreePath?: string; branchName?: string; baseBranch?: string; error?: string }> =>
    ipcRenderer.invoke('open-claude-worktree', projectPath, projectName),

  // PTY (embedded terminal) API
  ptyCreate: (opts: { sessionId: string; folderName: string; folderPath: string; useWorktree: boolean; resumeClaudeId?: string; existingWorktreePath?: string; dangerousMode?: boolean }): Promise<{ success: boolean; id?: string; folderName?: string; worktreePath?: string | null; branchName?: string | null; error?: string }> =>
    ipcRenderer.invoke('pty-create', opts),
  ptyWrite: (sessionId: string, data: string): void => {
    ipcRenderer.send('pty-write', sessionId, data)
  },
  ptyResize: (sessionId: string, cols: number, rows: number): void => {
    ipcRenderer.send('pty-resize', sessionId, cols, rows)
  },
  ptyDestroy: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('pty-destroy', sessionId),
  cleanupWorktree: (worktreePath: string, folderPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('cleanup-worktree', worktreePath, folderPath),
  ptyListSessions: (): Promise<{ id: string; folderName: string; worktreePath: string | null; branchName: string | null }[]> =>
    ipcRenderer.invoke('pty-list-sessions'),
  // File explorer
  listDirectory: (dirPath: string): Promise<{ name: string; path: string; isDir: boolean; size: number }[]> =>
    ipcRenderer.invoke('list-directory', dirPath),
  readFile: (filePath: string): Promise<{ content?: string; error?: string }> =>
    ipcRenderer.invoke('read-file', filePath),
  searchFiles: (rootPath: string, query: string): Promise<{ results: { file: string; relativePath: string; matches: { line: number; text: string }[] }[]; error?: string }> =>
    ipcRenderer.invoke('search-files', rootPath, query),
  getWorktreeDiff: (worktreePath: string): Promise<{ diff?: string; error?: string }> =>
    ipcRenderer.invoke('get-worktree-diff', worktreePath),
  detectClaudeSessionId: (cwd: string): Promise<{ sessionId: string | null }> =>
    ipcRenderer.invoke('detect-claude-session-id', cwd),
  saveTempImage: (opts: { name: string; data: number[]; sessionId: string }): Promise<{ path?: string; error?: string }> =>
    ipcRenderer.invoke('save-temp-image', opts),

  // Browser bridge
  openBrowser: (sessionId: string, url?: string): Promise<{ opened: boolean }> =>
    ipcRenderer.invoke('open-browser', sessionId, url),
  closeBrowser: (sessionId: string): Promise<{ closed: boolean }> =>
    ipcRenderer.invoke('close-browser', sessionId),
  isBrowserOpen: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('is-browser-open', sessionId),
  onBrowserEvent: (callback: (data: { sessionId: string; event: string; data: any }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; event: string; data: any }) => callback(data)
    ipcRenderer.on('browser-event', handler)
    return () => ipcRenderer.removeListener('browser-event', handler)
  },

  onPtyData: (callback: (data: { sessionId: string; data: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; data: string }) => callback(data)
    ipcRenderer.on('pty-data', handler)
    return () => ipcRenderer.removeListener('pty-data', handler)
  },
  onPtyExit: (callback: (data: { sessionId: string; exitCode: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; exitCode: number }) => callback(data)
    ipcRenderer.on('pty-exit', handler)
    return () => ipcRenderer.removeListener('pty-exit', handler)
  },

  onProcessLog: (callback: (data: { projectId: string; line: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { projectId: string; line: string }) => callback(data)
    ipcRenderer.on('process-log', handler)
    return () => ipcRenderer.removeListener('process-log', handler)
  },

  onProcessStatusChanged: (callback: (status: ProcessStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ProcessStatus) => callback(status)
    ipcRenderer.on('process-status-changed', handler)
    return () => ipcRenderer.removeListener('process-status-changed', handler)
  },

  // Pipeline
  pipelineStart: (folderName: string, folderPath: string, taskDescription: string): Promise<any> =>
    ipcRenderer.invoke('pipeline-start', folderName, folderPath, taskDescription),
  pipelineCancel: (pipelineId: string): Promise<void> =>
    ipcRenderer.invoke('pipeline-cancel', pipelineId),
  pipelineGetRuns: (): Promise<any[]> =>
    ipcRenderer.invoke('pipeline-get-runs'),
  pipelineGetConfig: (folderPath: string): Promise<any> =>
    ipcRenderer.invoke('pipeline-get-config', folderPath),
  pipelineSetConfig: (folderPath: string, config: any): Promise<void> =>
    ipcRenderer.invoke('pipeline-set-config', folderPath, config),
  onPipelineEvent: (callback: (run: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, run: any) => callback(run)
    ipcRenderer.on('pipeline-event', handler)
    return () => ipcRenderer.removeListener('pipeline-event', handler)
  },

  // RTK (Rust Token Killer) — optional token compression
  rtkDetect: (): Promise<{ installed: boolean; version: string | null; hookActive: boolean; path: string | null }> =>
    ipcRenderer.invoke('rtk-detect'),
  rtkEnable: (): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke('rtk-enable'),
  rtkDisable: (): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke('rtk-disable'),
  rtkGain: (): Promise<{ totalSaved: number; totalOriginal: number; totalCompressed: number; savingsPercent: number; commandCount: number; raw: string } | null> =>
    ipcRenderer.invoke('rtk-gain'),
  rtkSessionToggle: (sessionId: string, disabled: boolean): Promise<{ disabled: boolean }> =>
    ipcRenderer.invoke('rtk-session-toggle', sessionId, disabled),
  rtkSessionStatus: (sessionId: string): Promise<{ disabled: boolean }> =>
    ipcRenderer.invoke('rtk-session-status', sessionId),

  // Agent scanner
  scanAgents: (): Promise<AgentInfo[]> => ipcRenderer.invoke('scan-agents'),
  getAgentLogs: (agentId: string, logType: 'history' | 'stdout'): Promise<string[]> =>
    ipcRenderer.invoke('get-agent-logs', agentId, logType),
  triggerAgent: (agentId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trigger-agent', agentId),

  // Coach (prompt improvement assistant)
  coachGetConfig: (): Promise<CoachConfig> =>
    ipcRenderer.invoke('coach-get-config'),
  coachSetConfig: (config: CoachConfig): Promise<void> =>
    ipcRenderer.invoke('coach-set-config', config),
  coachGetSuggestions: (sessionId: string): Promise<CoachSuggestion[]> =>
    ipcRenderer.invoke('coach-get-suggestions', sessionId),
  coachGetCost: (sessionId: string): Promise<CoachSessionCost> =>
    ipcRenderer.invoke('coach-get-cost', sessionId),
  coachGetTotalCost: (): Promise<CoachSessionCost> =>
    ipcRenderer.invoke('coach-get-total-cost'),
  coachDismiss: (sessionId: string, suggestionId: string): Promise<void> =>
    ipcRenderer.invoke('coach-dismiss', sessionId, suggestionId),
  onCoachSuggestion: (callback: (data: CoachAnalysis) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CoachAnalysis) => callback(data)
    ipcRenderer.on('coach-suggestion', handler)
    return () => ipcRenderer.removeListener('coach-suggestion', handler)
  },

  // MCP & Skills
  mcpGetConfig: (projectPath?: string): Promise<{ scope: string; path: string; servers: Record<string, any> }[]> =>
    ipcRenderer.invoke('mcp-get-config', projectPath),
  mcpSaveConfig: (filePath: string, servers: Record<string, any>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('mcp-save-config', filePath, servers),
  skillsList: (projectPath?: string): Promise<{ name: string; scope: string; path: string; description: string }[]> =>
    ipcRenderer.invoke('skills-list', projectPath),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
