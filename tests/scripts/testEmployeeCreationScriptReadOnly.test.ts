import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-employee-creation.ts', () => {
  it('remains read-only with script-safe DB query handling', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-employee-creation.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain("@supabase/supabase-js")
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')

    // Guard against accidental mutations.
    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')
    expect(script).not.toContain('.rpc(')
  })
})
