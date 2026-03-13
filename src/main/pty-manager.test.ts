/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

const mockPtyProcess = {
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn(),
  onExit: vi.fn(),
}

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  })),
}))

vi.mock('./browser-bridge', () => ({
  getBridgePort: vi.fn().mockReturnValue(0),
}))

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPtyProcess),
}))

import { ptyManager } from './pty-manager'

describe('pty-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ptyManager.destroyAll()
    mockPtyProcess.onData.mockImplementation((cb: (d: string) => void) => {
      ;(mockPtyProcess as any)._onData = cb
    })
    mockPtyProcess.onExit.mockImplementation((cb: (e: { exitCode: number }) => void) => {
      ;(mockPtyProcess as any)._onExit = cb
    })
  })

  it('getSessions() returns empty array initially', () => {
    expect(ptyManager.getSessions()).toEqual([])
  })

  it('write() does nothing when session does not exist', () => {
    expect(() => ptyManager.write('nonexistent', 'ls\n')).not.toThrow()
    expect(mockPtyProcess.write).not.toHaveBeenCalled()
  })

  it('resize() does nothing when session does not exist', () => {
    expect(() => ptyManager.resize('nonexistent', 120, 30)).not.toThrow()
    expect(mockPtyProcess.resize).not.toHaveBeenCalled()
  })

  it('destroySession() does nothing when session does not exist', () => {
    expect(() => ptyManager.destroySession('nonexistent')).not.toThrow()
  })

  it('destroyAll() clears all sessions', () => {
    ptyManager.destroyAll()
    expect(ptyManager.getSessions()).toEqual([])
  })
})
