import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-private-booking-customer-creation.ts', () => {
  it('remains strictly read-only (no DB mutations)', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-private-booking-customer-creation.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('uses script-safe admin query helpers', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-private-booking-customer-creation.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('createAdminClient')
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain('@supabase/supabase-js')
  })

  it('blocks confirmation flags', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-private-booking-customer-creation.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('strictly read-only')
  })

  it('is runnable as a tsx script', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-private-booking-customer-creation.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
  })
})
