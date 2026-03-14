/**
 * Mock for node-pty - used via resolve.alias in vitest.config for tests.
 */
import { vi } from 'vitest'

export const mockPtyProcess = {
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn((cb: (data: string) => void) => {
    ;(mockPtyProcess as any)._onData = cb
  }),
  onExit: vi.fn((cb: (ev: { exitCode: number }) => void) => {
    ;(mockPtyProcess as any)._onExit = cb
  }),
}

export const mockSpawn = vi.fn(() => mockPtyProcess)

export const spawn = (...args: unknown[]) => mockSpawn(...args)
