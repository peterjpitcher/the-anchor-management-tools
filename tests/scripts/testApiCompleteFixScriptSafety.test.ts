import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-api-complete-fix.ts safety', () => {
  it('requires explicit capped request limits with fail-closed checks', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-api-complete-fix.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('--max-bookings')
    expect(script).toContain('RUN_TEST_API_COMPLETE_FIX_SEND')
    expect(script).toContain('ALLOW_TEST_API_COMPLETE_FIX_SEND')
    expect(script).toContain('ALLOW_TEST_API_COMPLETE_FIX_REMOTE')
    expect(script).toContain('ALLOW_TEST_API_COMPLETE_FIX_PROD')

    expect(script).toContain('Missing required --max-bookings (explicit cap required)')
    expect(script).toContain('--max-bookings exceeds hard cap')
    expect(script).toContain('Selected tests would send')
    expect(script).toContain('const withEqualsPrefix = `${flag}=`')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('const parsed = Number(trimmed)')

    expect(script).not.toContain('Math.min(')
    expect(script).not.toContain('const parsed = Number(value)')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })
})
