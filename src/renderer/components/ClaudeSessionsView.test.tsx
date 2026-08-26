import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ClaudeSessionsView } from './ClaudeSessionsView'

vi.mock('./XTerminal', () => ({
  XTerminal: ({ sessionId, active }: { sessionId: string; active: boolean }) => (
    <div data-testid={`terminal-${sessionId}`} data-active={String(active)}>
      Mock Terminal
    </div>
  ),
}))

vi.mock('./FileExplorer', () => ({ FileExplorer: () => null }))
vi.mock('./FileViewer', () => ({ FileViewer: () => null }))
vi.mock('./ChangesView', () => ({ ChangesView: () => null }))
vi.mock('./SearchView', () => ({ SearchView: () => null }))
vi.mock('./BrowserView', () => ({ BrowserView: () => null }))
vi.mock('./PipelineView', () => ({ PipelineView: () => null }))
vi.mock('./SessionInfoBar', () => ({
  SessionInfoBar: () => <div data-testid="session-info-bar" />,
}))
vi.mock('./presets', () => ({
  PresetBar: () => <div data-testid="preset-bar" />,
  PresetList: () => <div data-testid="preset-list" />,
}))

function makeSession(overrides: Partial<{
  id: string
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  exited: boolean
  claudeSessionId: string | null
  dangerousMode: boolean
  title: string
  titleManual: boolean
}> = {}) {
  return {
    id: 's1',
    folderName: 'my-project',
    folderPath: '/path/to/my-project',
    worktreePath: null,
    branchName: null,
    exited: false,
    claudeSessionId: null,
    dangerousMode: false,
    ...overrides,
  }
}

const defaultViewProps = {
  sessions: [] as ReturnType<typeof makeSession>[],
  rtkEnabled: false,
  chatInputEnabled: false,
  scanPath: '/home/user/Workspace',
  onNewSession: vi.fn(),
  onCloseSession: vi.fn(),
  onResumeSession: vi.fn(),
  onLoadSession: vi.fn(),
  onParkSession: vi.fn(),
  onResumeFromHistory: vi.fn(),
  onUpdateSessionColumn: vi.fn(),
  onSetSessionTitle: vi.fn(),
  onClearSessionTitle: vi.fn(),
  titleGeneratingIds: new Set<string>(),
  onRegenerateSessionTitle: vi.fn(),
}

describe('ClaudeSessionsView', () => {
  beforeEach(() => {
    vi.mocked(window.api.rtkDetect).mockResolvedValue({
      installed: false,
      version: null,
      hookActive: false,
      path: null,
    })
    vi.mocked(window.api.getGitStatus).mockResolvedValue({
      isGitRepo: false,
    } as any)
    vi.mocked(window.api.presetGetPinned).mockResolvedValue([])
    vi.mocked(window.api.presetGetRecent).mockResolvedValue([])
    // Reset default mocks
    defaultViewProps.onNewSession = vi.fn()
    defaultViewProps.onCloseSession = vi.fn()
    defaultViewProps.onResumeSession = vi.fn()
    defaultViewProps.onResumeFromHistory = vi.fn()
  })

  it('renders "No active Claude sessions." when sessions is []', () => {
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[]}
      />
    )
    expect(screen.getByText('No active Claude sessions.')).toBeInTheDocument()
  })

  it('empty state button calls onNewSession', () => {
    const onNewSession = vi.fn()
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[]}
        onNewSession={onNewSession}
      />
    )
    fireEvent.click(screen.getByText('New Claude Session'))
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  it('+ button calls onNewSession when sessions exist', () => {
    const onNewSession = vi.fn()
    const session = makeSession({ id: 's1', folderName: 'project' })
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
        onNewSession={onNewSession}
      />
    )
    fireEvent.click(screen.getByTitle('New session'))
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  it('renders tab for each session with folder name', async () => {
    const sessions = [
      makeSession({ id: 'a', folderName: 'project-a' }),
      makeSession({ id: 'b', folderName: 'project-b' }),
    ]
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={sessions}
      />
    )
    expect(await screen.findByText('project-a')).toBeInTheDocument()
    expect(screen.getByText('project-b')).toBeInTheDocument()
  })

  it('clicking × calls onCloseSession with session id', async () => {
    const session = makeSession({ id: 'close-me', folderName: 'test-folder' })
    const onCloseSession = vi.fn()
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
        onCloseSession={onCloseSession}
      />
    )
    const closeButtons = await screen.findAllByTitle('Close session')
    expect(closeButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(closeButtons[0])
    expect(onCloseSession).toHaveBeenCalledWith('close-me')
  })

  it('shows Resume on exited session with claudeSessionId, calls onResumeSession', async () => {
    const session = makeSession({
      id: 'resume-me',
      folderName: 'resume-folder',
      exited: true,
      claudeSessionId: 'claude-123',
    })
    const onResumeSession = vi.fn()
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
        onResumeSession={onResumeSession}
      />
    )
    const resumeBtn = await screen.findByTitle('Resume session')
    fireEvent.click(resumeBtn)
    expect(onResumeSession).toHaveBeenCalledWith('resume-me')
  })

  it('exited session without claudeSessionId has no Resume tab button', async () => {
    const session = makeSession({
      id: 'no-resume',
      folderName: 'no-resume-folder',
      exited: true,
      claudeSessionId: null,
    })
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
      />
    )
    await screen.findByText('no-resume-folder')
    const resumeButtons = screen.queryAllByRole('button', { name: /^Resume$/ })
    expect(resumeButtons).toHaveLength(0)
  })

  it('session with dangerousMode=true shows UNSAFE text', async () => {
    const session = makeSession({
      id: 'unsafe',
      folderName: 'unsafe-folder',
      dangerousMode: true,
    })
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
      />
    )
    expect(await screen.findByText('UNSAFE')).toBeInTheDocument()
  })

  it('session with dangerousMode=false has no UNSAFE text', () => {
    const session = makeSession({
      id: 'safe',
      folderName: 'safe-folder',
      dangerousMode: false,
    })
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
      />
    )
    expect(screen.queryByText('UNSAFE')).not.toBeInTheDocument()
  })

  it('dangerous session shows warning indicator with tooltip', async () => {
    const session = makeSession({
      id: 'danger',
      folderName: 'danger-folder',
      dangerousMode: true,
    })
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
      />
    )
    const indicators = await screen.findAllByTitle(/Dangerous mode/)
    expect(indicators.length).toBeGreaterThanOrEqual(1)
  })

  it('exited active session shows "Session ended" overlay', async () => {
    const session = makeSession({
      id: 'exited',
      folderName: 'exited-folder',
      exited: true,
    })
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
      />
    )
    expect(await screen.findByText('Session ended')).toBeInTheDocument()
  })

  it('shows the AI title with the folder name beneath it', async () => {
    const session = makeSession({
      id: 'titled',
      folderName: 'deckdrop-pro',
      title: 'Fix Stripe Refunds',
    })
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
      />
    )
    expect(await screen.findByText('Fix Stripe Refunds')).toBeInTheDocument()
    expect(screen.getByText('deckdrop-pro')).toBeInTheDocument()
  })

  it('does not repeat the folder name when a session has no title', async () => {
    const session = makeSession({ id: 'plain', folderName: 'deckdrop-pro' })
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
      />
    )
    // Card name only — no duplicate sub-line
    expect(await screen.findAllByText('deckdrop-pro')).toHaveLength(1)
  })

  it('double-clicking a card name renames the session as manual', async () => {
    const session = makeSession({ id: 'rename-me', folderName: 'project' })
    const onSetSessionTitle = vi.fn()
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
        onSetSessionTitle={onSetSessionTitle}
      />
    )
    fireEvent.doubleClick(await screen.findByText('project'))
    const input = screen.getByLabelText('Session name')
    fireEvent.change(input, { target: { value: 'Billing Investigation' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSetSessionTitle).toHaveBeenCalledWith('rename-me', 'Billing Investigation', true)
  })

  it('renders the quick-launch preset bar alongside the board', async () => {
    const session = makeSession({ id: 's1', folderName: 'project' })
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={[session]}
      />
    )
    expect(await screen.findByTestId('preset-bar')).toBeInTheDocument()
  })

  it('renders multiple tabs, clicking selects different session', async () => {
    const sessions = [
      makeSession({ id: 'first', folderName: 'first-folder' }),
      makeSession({ id: 'second', folderName: 'second-folder' }),
    ]
    render(
      <ClaudeSessionsView
        {...defaultViewProps}
        sessions={sessions}
      />
    )
    expect(await screen.findByText('first-folder')).toBeInTheDocument()
    expect(screen.getByText('second-folder')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-second')).toHaveAttribute(
      'data-active',
      'true'
    )
    fireEvent.click(screen.getByText('first-folder'))
    expect(screen.getByTestId('terminal-first')).toHaveAttribute(
      'data-active',
      'true'
    )
  })
})
