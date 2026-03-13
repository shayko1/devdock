import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.*',
        'src/__tests__/**',
        'src/preload/**',
        'src/renderer/main.tsx',
        'src/renderer/global.d.ts',
        'src/shared/pipeline-types.ts',
        'src/shared/agent-types.ts',
      ]
    }
  }
})
