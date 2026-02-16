import fs from 'node:fs'
import path from 'node:path'

describe('src/scripts/import-missed-messages.ts', () => {
  it('remains strictly read-only and blocks --confirm', () => {
    const scriptPath = path.resolve(process.cwd(), 'src/scripts/import-missed-messages.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
    expect(script).toContain('read-only')
    expect(script).toContain("process.argv.includes('--confirm')")

    // Guard against accidental DB mutations.
    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')

    // Guard against accidental opt-in defaults in legacy backfill tooling.
    expect(script).not.toContain('sms_opt_in: true')
    expect(script).not.toContain("sms_status: 'active'")
  })
})
