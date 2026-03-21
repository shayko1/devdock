/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => {
  class MockBrowserWindow {
    isDestroyed = () => false
    webContents = { send: vi.fn() }
  }
  return { BrowserWindow: MockBrowserWindow }
})

import { BrowserWindow } from 'electron'
import { WorkspaceInitTracker, WorkspaceInitInstance } from './workspace-init-tracker'

describe('WorkspaceInitTracker', () => {
  let tracker: WorkspaceInitTracker

  beforeEach(() => {
    tracker = new WorkspaceInitTracker()
    const mockWindow = new BrowserWindow()
    tracker.setMainWindow(mockWindow)
  })

  describe('instance creation and lifecycle', () => {
    it('create() returns a WorkspaceInitInstance', () => {
      const instance = tracker.create('session-1')
      expect(instance).toBeInstanceOf(WorkspaceInitInstance)
      expect(instance.sessionId).toBe('session-1')
    })

    it('get() returns the instance after creation', () => {
      const instance = tracker.create('session-1')
      expect(tracker.get('session-1')).toBe(instance)
    })

    it('get() returns undefined for unknown session', () => {
      expect(tracker.get('nonexistent')).toBeUndefined()
    })

    it('remove() deletes the instance', () => {
      tracker.create('session-1')
      tracker.remove('session-1')
      expect(tracker.get('session-1')).toBeUndefined()
    })

    it('creating with same ID replaces old instance', () => {
      const first = tracker.create('session-1')
      const second = tracker.create('session-1')
      expect(first).not.toBe(second)
      expect(tracker.get('session-1')).toBe(second)
    })
  })

  describe('stage progression', () => {
    it('advances through stages in order', () => {
      const instance = tracker.create('session-1')
      const progressEvents: string[] = []

      instance.onProgress((p) => progressEvents.push(p.stage))

      instance.advance('checking_project')
      instance.advance('fetching')
      instance.advance('creating_worktree')
      instance.advance('running_setup')
      instance.advance('spawning_pty')
      instance.advance('waiting_shell')
      instance.advance('ready')

      expect(progressEvents).toEqual([
        'checking_project',
        'fetching',
        'creating_worktree',
        'running_setup',
        'spawning_pty',
        'waiting_shell',
        'ready',
      ])
    })

    it('getProgress() returns the current snapshot', () => {
      const instance = tracker.create('session-1')
      instance.advance('creating_worktree')

      const progress = instance.getProgress()
      expect(progress.sessionId).toBe('session-1')
      expect(progress.stage).toBe('creating_worktree')
      expect(progress.stageIndex).toBe(3)
      expect(progress.totalStages).toBe(8)
      expect(progress.startedAt).toBeGreaterThan(0)
    })

    it('emits IPC events to mainWindow', () => {
      const mockWindow = new BrowserWindow()
      tracker.setMainWindow(mockWindow)
      const instance = tracker.create('session-1')

      instance.advance('checking_project')

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'workspace-init-progress',
        expect.objectContaining({
          sessionId: 'session-1',
          stage: 'checking_project',
        })
      )
    })

    it('advance with custom message overrides default', () => {
      const instance = tracker.create('session-1')
      const messages: string[] = []

      instance.onProgress((p) => messages.push(p.message))

      instance.advance('checking_project', 'Custom check message')

      expect(messages).toEqual(['Custom check message'])
    })
  })

  describe('cancellation', () => {
    it('cancel() sets stage to cancelled', () => {
      const instance = tracker.create('session-1')

      instance.advance('fetching')
      instance.cancel()

      expect(instance.isCancelled()).toBe(true)
      expect(instance.getProgress().stage).toBe('cancelled')
    })

    it('advance() is no-op after cancellation', () => {
      const instance = tracker.create('session-1')
      const stages: string[] = []

      instance.onProgress((p) => stages.push(p.stage))

      instance.advance('checking_project')
      instance.cancel()
      instance.advance('fetching') // Should be ignored

      expect(stages).toEqual(['checking_project', 'cancelled'])
    })

    it('cancel() at each stage works', () => {
      const stages = [
        'pending', 'checking_project', 'fetching',
        'creating_worktree', 'running_setup', 'spawning_pty', 'waiting_shell'
      ] as const

      for (const stage of stages) {
        const instance = tracker.create(`session-${stage}`)
        instance.advance(stage)
        instance.cancel()
        expect(instance.isCancelled()).toBe(true)
      }
    })

    it('cancel() from tracker by sessionId', () => {
      const instance = tracker.create('session-1')
      instance.advance('fetching')

      const result = tracker.cancel('session-1')

      expect(result).toBe(true)
      expect(instance.isCancelled()).toBe(true)
    })

    it('cancel() returns false for unknown session', () => {
      expect(tracker.cancel('nonexistent')).toBe(false)
    })

    it('cancel() is no-op after ready', () => {
      const instance = tracker.create('session-1')
      instance.advance('ready')
      instance.cancel()

      // Should remain ready, not cancelled
      expect(instance.isCancelled()).toBe(false)
      expect(instance.getProgress().stage).toBe('ready')
    })
  })

  describe('failure handling', () => {
    it('fail() sets stage to failed with error', () => {
      const instance = tracker.create('session-1')

      instance.advance('creating_worktree')
      instance.fail('Git worktree add failed')

      const progress = instance.getProgress()
      expect(progress.stage).toBe('failed')
      expect(progress.error).toBe('Git worktree add failed')
    })

    it('advance() is no-op after failure', () => {
      const instance = tracker.create('session-1')
      const stages: string[] = []

      instance.onProgress((p) => stages.push(p.stage))

      instance.advance('checking_project')
      instance.fail('Some error')
      instance.advance('fetching') // Should be ignored

      expect(stages).toEqual(['checking_project', 'failed'])
    })

    it('fail() emits progress event with error', () => {
      const instance = tracker.create('session-1')
      let lastProgress: any = null

      instance.onProgress((p) => { lastProgress = p })
      instance.fail('Permission denied')

      expect(lastProgress).toMatchObject({
        stage: 'failed',
        error: 'Permission denied',
      })
    })

    it('fail() is no-op after cancellation', () => {
      const instance = tracker.create('session-1')
      instance.cancel()
      instance.fail('some error')

      expect(instance.getProgress().stage).toBe('cancelled')
      expect(instance.getProgress().error).toBeUndefined()
    })
  })

  describe('progress events', () => {
    it('multiple listeners receive events', () => {
      const instance = tracker.create('session-1')
      const events1: string[] = []
      const events2: string[] = []

      instance.onProgress((p) => events1.push(p.stage))
      instance.onProgress((p) => events2.push(p.stage))

      instance.advance('checking_project')

      expect(events1).toEqual(['checking_project'])
      expect(events2).toEqual(['checking_project'])
    })

    it('listener errors do not prevent other listeners', () => {
      const instance = tracker.create('session-1')
      const events: string[] = []

      instance.onProgress(() => { throw new Error('listener error') })
      instance.onProgress((p) => events.push(p.stage))

      instance.advance('checking_project')

      expect(events).toEqual(['checking_project'])
    })

    it('stageIndex and totalStages are correct for each stage', () => {
      const instance = tracker.create('session-1')
      const indices: number[] = []

      instance.onProgress((p) => indices.push(p.stageIndex))

      instance.advance('pending')       // 0
      instance.advance('checking_project') // 1
      instance.advance('fetching')       // 2
      instance.advance('creating_worktree') // 3
      instance.advance('running_setup')   // 4
      instance.advance('spawning_pty')    // 5
      instance.advance('waiting_shell')   // 6
      instance.advance('ready')          // 7

      expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    })
  })
})
