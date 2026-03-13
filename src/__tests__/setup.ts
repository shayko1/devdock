import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Mock window.api for renderer tests
const mockApi = {
  getState: vi.fn(),
  saveState: vi.fn(),
  scanWorkspace: vi.fn(),
  startProject: vi.fn(),
  stopProject: vi.fn(),
  getProcessStatuses: vi.fn().mockResolvedValue([]),
  getLogs: vi.fn(),
  openInBrowser: vi.fn(),
  detectSystemPorts: vi.fn().mockResolvedValue({}),
  killSystemProcess: vi.fn(),
  listWorkspaceFolders: vi.fn().mockResolvedValue([]),
  openInIde: vi.fn(),
  openInFinder: vi.fn(),
  openInTerminal: vi.fn(),
  getGitInfo: vi.fn().mockResolvedValue({ gitBranch: null, gitRemote: null }),
  getGitStatus: vi.fn(),
  openClaudeWorktree: vi.fn(),
  ptyCreate: vi.fn(),
  ptyWrite: vi.fn(),
  ptyResize: vi.fn(),
  ptyDestroy: vi.fn(),
  cleanupWorktree: vi.fn(),
  ptyListSessions: vi.fn(),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  searchFiles: vi.fn(),
  getWorktreeDiff: vi.fn(),
  detectClaudeSessionId: vi.fn(),
  saveTempImage: vi.fn(),
  selectFolder: vi.fn(),
  openBrowser: vi.fn(),
  closeBrowser: vi.fn(),
  isBrowserOpen: vi.fn(),
  onBrowserEvent: vi.fn().mockReturnValue(() => {}),
  onPtyData: vi.fn().mockReturnValue(() => {}),
  onPtyExit: vi.fn().mockReturnValue(() => {}),
  onProcessLog: vi.fn().mockReturnValue(() => {}),
  onProcessStatusChanged: vi.fn().mockReturnValue(() => {}),
  pipelineStart: vi.fn(),
  pipelineCancel: vi.fn(),
  pipelineGetRuns: vi.fn(),
  pipelineGetConfig: vi.fn(),
  pipelineSetConfig: vi.fn(),
  onPipelineEvent: vi.fn().mockReturnValue(() => {}),
  scanAgents: vi.fn(),
  getAgentLogs: vi.fn(),
  triggerAgent: vi.fn(),
}

// Only set window.api in jsdom (renderer tests); Node main process tests have no window
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'api', {
    value: mockApi,
    writable: true,
  })
}
