import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-booking-api.ts', () => {
  it('requires explicit gating and does not default to production', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-booking-api.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('RUN_TEST_BOOKING_API_SEND')
    expect(script).toContain('ALLOW_TEST_BOOKING_API_SEND')
    expect(script).toContain('ALLOW_TEST_BOOKING_API_REMOTE')
    expect(script).toContain('ALLOW_TEST_BOOKING_API_PROD')
    expect(script).toContain('--prod')
    expect(script).toContain('--limit=1')
    expect(script).toContain('Send blocked: missing --limit')
    expect(script).toContain('explicit cap required')
    expect(script).toContain('Send blocked: --limit exceeds hard cap')
    expect(script).toContain('Send blocked: --limit must be')
    expect(script).toContain('const withEqualsPrefix = `${flag}=`')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('const parsed = Number(trimmed)')
    expect(script).not.toContain('const parsed = Number(value)')

    // Guard against accidental prod defaults and unsafe baked-in test numbers.
    expect(script).not.toContain('https://management.orangejelly.co.uk')
    expect(script).not.toContain('07700900123')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).not.toContain('process.exit(')
  })
})
