import { vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom'

// In-memory localStorage: Node may expose a broken Storage (e.g. --localstorage-file) where getItem is not a function.
const lsStore: Record<string, string> = {}

function makeLocalStorage(): Storage {
  return {
    get length() {
      return Object.keys(lsStore).length
    },
    clear() {
      for (const k of Object.keys(lsStore)) delete lsStore[k]
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(lsStore, key) ? lsStore[key] : null
    },
    key(index: number) {
      const keys = Object.keys(lsStore)
      return index >= 0 && index < keys.length ? keys[index] : null
    },
    removeItem(key: string) {
      delete lsStore[key]
    },
    setItem(key: string, value: string) {
      lsStore[key] = String(value)
    },
  } as Storage
}

vi.stubGlobal('localStorage', makeLocalStorage())

beforeEach(() => {
  try {
    globalThis.localStorage.clear()
  } catch {
    /* ignore */
  }
})

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
  bulkGitPullWorkspace: vi.fn().mockResolvedValue({ entries: [] }),
  onBulkGitPullProgress: vi.fn().mockReturnValue(() => {}),
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
  onStatuslineData: vi.fn().mockReturnValue(() => {}),
  onProcessLog: vi.fn().mockReturnValue(() => {}),
  onProcessStatusChanged: vi.fn().mockReturnValue(() => {}),
  pipelineStart: vi.fn(),
  pipelineCancel: vi.fn(),
  pipelineGetRuns: vi.fn(),
  pipelineGetConfig: vi.fn(),
  pipelineSetConfig: vi.fn(),
  onPipelineEvent: vi.fn().mockReturnValue(() => {}),
  rtkDetect: vi.fn().mockResolvedValue({ installed: false, version: null, hookActive: false, path: null }),
  rtkEnable: vi.fn().mockResolvedValue({ success: true, output: '' }),
  rtkDisable: vi.fn().mockResolvedValue({ success: true, output: '' }),
  rtkGain: vi.fn().mockResolvedValue(null),
  rtkSessionToggle: vi.fn().mockResolvedValue({ disabled: false }),
  rtkSessionStatus: vi.fn().mockResolvedValue({ disabled: false }),
  rtkSessionCleanup: vi.fn(),
  scanAgents: vi.fn(),
  getAgentLogs: vi.fn(),
  triggerAgent: vi.fn(),
  coachGetConfig: vi.fn().mockResolvedValue({ enabled: false, apiKey: '', model: 'gpt-4.1-nano', baseUrl: '' }),
  coachSetConfig: vi.fn().mockResolvedValue(undefined),
  coachGetSuggestions: vi.fn().mockResolvedValue([]),
  coachGetCost: vi.fn().mockResolvedValue({ totalUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 }),
  coachGetTotalCost: vi.fn().mockResolvedValue({ totalUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 }),
  coachDismiss: vi.fn().mockResolvedValue(undefined),
  onCoachSuggestion: vi.fn().mockReturnValue(() => {}),
  scrollbackListRecoverable: vi.fn().mockResolvedValue([]),
  scrollbackRestore: vi.fn().mockResolvedValue(null),
  scrollbackDismiss: vi.fn().mockResolvedValue(undefined),
  scrollbackCleanupOld: vi.fn().mockResolvedValue(undefined),

  // Resource monitoring
  resourceGetSnapshot: vi.fn().mockResolvedValue({ timestamp: 0, sessions: [], host: { totalMemory: 0, freeMemory: 0, usedMemory: 0, memoryUsagePercent: 0, cpuCores: 1, loadAverage1m: 0 } }),
  resourceSubscribe: vi.fn().mockResolvedValue(undefined),
  resourceUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onResourceUpdate: vi.fn().mockReturnValue(() => {}),

  // Workspace init progress
  onWorkspaceInitProgress: vi.fn().mockReturnValue(() => {}),
  workspaceInitCancel: vi.fn().mockResolvedValue(undefined),

  // Notifications
  notificationSetEnabled: vi.fn().mockResolvedValue(undefined),
  notificationSetQuietMode: vi.fn().mockResolvedValue(undefined),
  notificationGetSettings: vi.fn().mockResolvedValue({ enabled: true, quietMode: true }),
  onNotificationClicked: vi.fn().mockReturnValue(() => {}),

  // MCP & Skills
  mcpGetConfig: vi.fn().mockResolvedValue([]),
  mcpCheckStatus: vi.fn().mockResolvedValue({}),
  mcpSaveConfig: vi.fn().mockResolvedValue({ success: true }),
  skillsList: vi.fn().mockResolvedValue([]),
  createCommand: vi.fn().mockResolvedValue({ success: true }),
  deleteCommand: vi.fn().mockResolvedValue({ success: true }),
  // Active sessions
  activeSessionsSet: vi.fn().mockResolvedValue(undefined),
  activeSessionsUpdateClaudeId: vi.fn().mockResolvedValue(undefined),
  activeSessionsRemove: vi.fn().mockResolvedValue(undefined),
  activeSessionsGetAll: vi.fn().mockResolvedValue([]),
  // Session history
  sessionHistoryScan: vi.fn().mockResolvedValue([]),
  sessionHistoryTitle: vi.fn().mockResolvedValue(null),
  // Session presets
  presetList: vi.fn().mockResolvedValue([]),
  presetCreate: vi.fn().mockResolvedValue({ id: 'new-preset', name: 'Test', createdAt: Date.now(), useCount: 0 }),
  presetUpdate: vi.fn().mockResolvedValue(null),
  presetDelete: vi.fn().mockResolvedValue(true),
  presetGetPinned: vi.fn().mockResolvedValue([]),
  presetGetRecent: vi.fn().mockResolvedValue([]),
  presetLaunch: vi.fn().mockResolvedValue({ success: true }),
  // Branches
  listBranches: vi.fn().mockResolvedValue({ current: null, branches: [] }),
  checkoutBranch: vi.fn().mockResolvedValue({ success: true }),
  findFilesByName: vi.fn().mockResolvedValue([]),
}

// Only set window.api in jsdom (renderer tests); Node main process tests have no window
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'api', {
    value: mockApi,
    writable: true,
  })
}
