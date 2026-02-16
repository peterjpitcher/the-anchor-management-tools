import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-demographics.ts', () => {
  it('is strictly read-only and uses fail-closed query wrappers', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-demographics.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('read-only')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
    expect(script).toContain('--short-code')
    expect(script).toContain('withEqualsPrefix')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Invalid positive integer for')
    expect(script).toContain('Number.isInteger')
    expect(script).toContain('exceeds hard cap')
    expect(script).not.toContain('Number(value)')
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain("@supabase/supabase-js")

    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })
})
