import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-critical-flows.ts', () => {
  it('remains strictly read-only (no DB mutations)', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-critical-flows.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')
  })

  it('uses script-safe read-only query patterns', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-critical-flows.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain("@supabase/supabase-js")
  })

  it('fails non-zero when any smoke check fails', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-critical-flows.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('process.exitCode = 1')
    expect(script).not.toContain('process.exit(')
  })

  it('is runnable as a tsx script', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-critical-flows.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
  })
})
