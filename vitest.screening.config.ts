import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'
export default mergeConfig(base, defineConfig({
  test: {
    include: ['tests/lib/business-hours/screening-hours.test.ts', 'tests/api/business/screening-hours.test.ts'],
    env: { TZ: process.env.SCREENING_TEST_TZ ?? 'Europe/London' },
  },
}))
