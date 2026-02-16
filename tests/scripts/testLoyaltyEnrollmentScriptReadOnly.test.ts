import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-loyalty-enrollment.ts', () => {
  it('remains strictly read-only (no random phone generation, no DB mutations)', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-loyalty-enrollment.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('Math.random')

    // Guard against accidental DB mutations.
    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('requires explicit targeting via --customer-id', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-loyalty-enrollment.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--customer-id')
  })

  it('uses script-safe admin query helpers', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-loyalty-enrollment.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('createAdminClient')
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain('@supabase/supabase-js')
  })

  it('is runnable as a tsx script', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-loyalty-enrollment.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
  })
})
