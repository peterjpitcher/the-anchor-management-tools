import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: false,
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
    // The app hardcodes Europe/London, so the suite runs there too, whatever timezone the
    // developer or CI machine is on. Without this, any assertion built from a host-local Date
    // shifts by a day outside the UK, and the same suite passes in London but fails elsewhere.
    env: {
      TZ: 'Europe/London',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', '.next/', 'tests/', '**/*.config.*'],
      thresholds: {
        lines: 42,
        branches: 34,
        functions: 52,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
