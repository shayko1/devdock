/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockNotificationShow, mockNotificationOn, mockIsSupported, mockNotificationCalls } = vi.hoisted(() => {
  const show = vi.fn()
  const on = vi.fn()
  const calls: any[] = []
  return {
    mockNotificationShow: show,
    mockNotificationOn: on,
    mockIsSupported: vi.fn().mockReturnValue(true),
    mockNotificationCalls: calls,
  }
})

vi.mock('electron', () => {
  // Use a real function so it can be called with `new`
  function MockNotification(opts: any) {
    mockNotificationCalls.push(opts)
    return {
      show: mockNotificationShow,
      on: mockNotificationOn,
    }
  }
  MockNotification.isSupported = mockIsSupported

  class MockBrowserWindow {
    isDestroyed = () => false
    isFocused = vi.fn().mockReturnValue(false)
    isMinimized = vi.fn().mockReturnValue(false)
    restore = vi.fn()
    focus = vi.fn()
    webContents = { send: vi.fn() }
  }

  return {
    BrowserWindow: MockBrowserWindow,
    Notification: MockNotification,
  }
})

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

import { BrowserWindow } from 'electron'
import { NotificationManager } from './notification-manager'

describe('NotificationManager', () => {
  let manager: NotificationManager
  let mockWindow: BrowserWindow

  beforeEach(() => {
    vi.clearAllMocks()
    mockNotificationCalls.length = 0
    mockIsSupported.mockReturnValue(true)
    manager = new NotificationManager()
    mockWindow = new BrowserWindow()
    manager.setMainWindow(mockWindow)
  })

  describe('notification creation', () => {
    it('shows notification for a complete session', () => {
      manager.trackSession('s1', 'my-project', 'Build a feature')
      manager.notifySessionComplete('s1')

      expect(mockNotificationCalls).toHaveLength(1)
      expect(mockNotificationCalls[0]).toMatchObject({
        title: 'Session Ready -- my-project',
        body: 'Build a feature',
      })
      expect(mockNotificationShow).toHaveBeenCalled()
    })

    it('uses summary as body when provided', () => {
      manager.trackSession('s1', 'my-project')
      manager.notifySessionComplete('s1', 'Task completed successfully')

      expect(mockNotificationCalls[0]).toMatchObject({
        body: 'Task completed successfully',
      })
    })

    it('falls back to "Waiting for input" when no title', () => {
      manager.trackSession('s1', 'my-project')
      manager.notifySessionComplete('s1')

      expect(mockNotificationCalls[0]).toMatchObject({
        body: 'Waiting for input',
      })
    })

    it('shows error notification', () => {
      manager.trackSession('s1', 'my-project')
      manager.notifySessionError('s1', 'Connection timeout')

      expect(mockNotificationCalls[0]).toMatchObject({
        title: 'Session Error -- my-project',
        body: 'Connection timeout',
      })
      expect(mockNotificationShow).toHaveBeenCalled()
    })

    it('registers click handler that focuses window', () => {
      manager.trackSession('s1', 'my-project')
      manager.notifySessionComplete('s1')

      expect(mockNotificationOn).toHaveBeenCalledWith('click', expect.any(Function))
    })
  })

  describe('enable/disable toggle', () => {
    it('does not show notification when disabled', () => {
      manager.setEnabled(false)
      manager.trackSession('s1', 'my-project')
      manager.notifySessionComplete('s1')

      expect(mockNotificationCalls).toHaveLength(0)
    })

    it('shows notification when re-enabled', () => {
      manager.setEnabled(false)
      manager.setEnabled(true)
      manager.trackSession('s1', 'my-project')
      manager.notifySessionComplete('s1')

      expect(mockNotificationShow).toHaveBeenCalled()
    })

    it('getSettings reflects enabled state', () => {
      manager.setEnabled(false)
      expect(manager.getSettings().enabled).toBe(false)

      manager.setEnabled(true)
      expect(manager.getSettings().enabled).toBe(true)
    })
  })

  describe('quiet mode suppression', () => {
    it('suppresses when window is focused and quiet mode is on', () => {
      ;(mockWindow.isFocused as ReturnType<typeof vi.fn>).mockReturnValue(true)
      manager.setQuietMode(true)
      manager.trackSession('s1', 'my-project')
      manager.notifySessionComplete('s1')

      expect(mockNotificationCalls).toHaveLength(0)
    })

    it('does not suppress when window is not focused', () => {
      ;(mockWindow.isFocused as ReturnType<typeof vi.fn>).mockReturnValue(false)
      manager.setQuietMode(true)
      manager.trackSession('s1', 'my-project')
      manager.notifySessionComplete('s1')

      expect(mockNotificationShow).toHaveBeenCalled()
    })

    it('does not suppress when quiet mode is off', () => {
      ;(mockWindow.isFocused as ReturnType<typeof vi.fn>).mockReturnValue(true)
      manager.setQuietMode(false)
      manager.trackSession('s1', 'my-project')
      manager.notifySessionComplete('s1')

      expect(mockNotificationShow).toHaveBeenCalled()
    })

    it('getSettings reflects quietMode state', () => {
      manager.setQuietMode(false)
      expect(manager.getSettings().quietMode).toBe(false)

      manager.setQuietMode(true)
      expect(manager.getSettings().quietMode).toBe(true)
    })
  })

  describe('session tracking', () => {
    it('updateSessionTitle updates the notification body', () => {
      manager.trackSession('s1', 'my-project')
      manager.updateSessionTitle('s1', 'Updated title')
      manager.notifySessionComplete('s1')

      expect(mockNotificationCalls[0]).toMatchObject({
        body: 'Updated title',
      })
    })

    it('untrackSession removes session data', () => {
      manager.trackSession('s1', 'my-project', 'A title')
      manager.untrackSession('s1')
      manager.notifySessionComplete('s1')

      expect(mockNotificationCalls[0]).toMatchObject({
        title: 'Session Ready -- Session', // falls back to default
        body: 'Waiting for input',
      })
    })
  })

  describe('edge cases', () => {
    it('handles notification when Notification.isSupported returns false', () => {
      mockIsSupported.mockReturnValue(false)
      manager.trackSession('s1', 'my-project')
      manager.notifySessionComplete('s1')

      expect(mockNotificationCalls).toHaveLength(0)
    })

    it('truncates long error messages in body', () => {
      manager.trackSession('s1', 'my-project')
      const longError = 'x'.repeat(300)
      manager.notifySessionError('s1', longError)

      expect(mockNotificationCalls[0]).toMatchObject({
        body: longError.slice(0, 200),
      })
    })
  })
})
