import fs from 'node:fs'
import path from 'node:path'

describe('SMS testing scripts fail-closed on logging failures', () => {
  it('scripts/testing/test-table-booking-sms.ts treats logging_failed as a failure', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-table-booking-sms.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('logging_failed')
    expect(script).toContain('logFailure')
    expect(script).toContain('createAdminClient')
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).toContain('assertTestTableBookingSmsSendLimit')
    expect(script).toContain('--limit=1')
    expect(script).not.toContain('@supabase/supabase-js')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('scripts/testing/test-enrollment-with-sms.ts treats logging_failed as a failure', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-enrollment-with-sms.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('logging_failed')
    expect(script).toContain('logFailure')
    expect(script).toContain('createAdminClient')
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).toContain('assertTestEnrollmentWithSmsSendLimit')
    expect(script).toContain('--limit=1')
    expect(script).not.toContain('@supabase/supabase-js')
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })
})
