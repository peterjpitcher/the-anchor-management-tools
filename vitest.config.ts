import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'
import react from '@vitejs/plugin-react'

// The suite must be able to run in two zones on purpose: Europe/London, the business zone the
// app hardcodes, and UTC, which is what the serverless runtime actually runs in. Reading the
// zone from TEST_TZ (defaulting to Europe/London) is what makes the second run real. Hardcoding
// TZ here silently overrode any TZ set on the command line, so `TZ=UTC npm test` ran
// Europe/London twice and reported a false green. TEST_TZ rather than TZ, so a stray TZ in a
// developer or CI shell cannot quietly move the default run off the business zone.
const testTimezone = process.env.TEST_TZ ?? 'Europe/London'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: false,
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
    // TZ pins the zone the tests actually run in, whatever zone the developer or CI machine is
    // on. Without it, any assertion built from a host-local Date shifts by a day outside the UK.
    // TEST_TZ is passed through so tests/config/timezone-gate.test.ts can assert that the zone
    // asked for is the zone that took effect.
    env: {
      TZ: testTimezone,
      TEST_TZ: testTimezone,
      // vitest.screening.config.ts requests its zone with SCREENING_TEST_TZ, and its suite
      // self-checks against that name. Those files also run in this default suite, so publish
      // the zone under that name too when it has not been set explicitly, or the screening
      // self-check reads a zone nobody requested and fails the UTC run. An explicit
      // SCREENING_TEST_TZ always wins, so the screening config keeps its own override.
      SCREENING_TEST_TZ: process.env.SCREENING_TEST_TZ ?? testTimezone,
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
