import fs from 'node:fs'
import path from 'node:path'

describe('scripts/analysis safety guards', () => {
  const scriptPaths = [
    'scripts/analysis/analyze-messages-permissions.ts',
    'scripts/analysis/analyze-duplicates-detailed.ts',
    'scripts/analysis/analyze-private-bookings-customers.ts',
    'scripts/analysis/analyze-performance.ts',
    'scripts/analysis/calibrate-hiring-thresholds.ts',
    'scripts/analysis/evaluate-hiring-screening.ts',
  ]

  it.each(scriptPaths)('%s is strictly read-only and fails closed', (relativePath) => {
    const scriptPath = path.resolve(process.cwd(), relativePath)
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')

    expect(script).toContain('createAdminClient')
    expect(script).toContain('assertScriptQuerySucceeded')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).toContain('process.exitCode')
    expect(script).not.toContain('process.exit(')

    // Avoid raw service-role createClient usage in scripts; prefer createAdminClient.
    expect(script).not.toContain("@supabase/supabase-js")
    expect(script).not.toContain('createClient(')
  })
})
