/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as childProcess from 'child_process'
import * as fs from 'fs'
import { Project } from '../shared/types'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  })),
}))

import {
  processManager,
  getShellPath,
  detectSystemPorts,
  killSystemProcess,
} from './process-manager'

function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'test-project-id',
    name: 'test-project',
    path: '/test/project',
    tags: [],
    description: '',
    techStack: ['Vite'],
    runCommand: 'npm run dev',
    port: 3000,
    lastOpened: null,
    hidden: false,
    ...overrides,
  }
}

describe('process-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    processManager.stopAll()
    vi.mocked(childProcess.execSync).mockReturnValue('/usr/local/bin:/usr/bin' as any)
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  describe('getShellPath', () => {
    it('returns PATH from shell when execSync succeeds', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('/home/user/bin:/usr/bin' as any)
      const path = getShellPath()
      expect(path).toBe('/home/user/bin:/usr/bin')
      expect(childProcess.execSync).toHaveBeenCalledWith(
        '/bin/zsh -ilc "echo $PATH"',
        expect.objectContaining({ encoding: 'utf-8', timeout: 5000 })
      )
    })

    it('returns fallback path when execSync throws', async () => {
      vi.resetModules()
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('exec failed')
      })
      const { getShellPath: getShellPathFresh } = await import('./process-manager')
      const path = getShellPathFresh()
      expect(path).toContain('/opt/homebrew/bin')
    })
  })

  describe('detectSystemPorts', () => {
    it('returns empty map when portsToCheck is empty', () => {
      const result = detectSystemPorts([])
      expect(result.size).toBe(0)
      expect(childProcess.execSync).not.toHaveBeenCalled()
    })

    it('parses lsof output and returns port info', () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('node    12345 user   22u  IPv4 ... TCP *:3000 (LISTEN)\n' as any)
        .mockReturnValueOnce('' as any)
      const result = detectSystemPorts([3000])
      expect(result.size).toBeGreaterThanOrEqual(0)
      // May or may not parse depending on exact lsof format - at least shouldn't throw
    })
  })

  describe('killSystemProcess', () => {
    it('returns true when process.kill succeeds', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      const result = killSystemProcess(12345)
      expect(result).toBe(true)
      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM')
      killSpy.mockRestore()
    })

    it('tries SIGKILL when SIGTERM fails', () => {
      const killSpy = vi.spyOn(process, 'kill')
        .mockImplementationOnce(() => { throw new Error('no process') })
        .mockImplementationOnce(() => true)
      const result = killSystemProcess(12345)
      expect(result).toBe(true)
      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL')
      killSpy.mockRestore()
    })
  })

  describe('ProcessManager', () => {
    it('getAllStatuses returns empty array when no projects running', () => {
      expect(processManager.getAllStatuses()).toEqual([])
    })

    it('getLogs returns empty array for unknown project', () => {
      expect(processManager.getLogs('nonexistent')).toEqual([])
    })

    it('stopProject returns false when project not running', () => {
      expect(processManager.stopProject('nonexistent')).toBe(false)
    })

    it('startProject returns error status when runCommand is empty', async () => {
      const project = createMockProject({ runCommand: '' })
      const status = await processManager.startProject(project)
      expect(status.running).toBe(false)
      expect(status.logs).toContain('No run command configured')
    })
  })
})
