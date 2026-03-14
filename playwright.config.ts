import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60000,
  retries: 1,
  use: {
    trace: 'on-first-retry',
  },
  workers: 1,
})
