import fs from 'node:fs'
import path from 'node:path'

describe('scripts/tools/send-feb-2026-event-review-sms', () => {
  it('is gated, testable, and does not default to production URLs', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/tools/send-feb-2026-event-review-sms.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('RUN_FEB_REVIEW_SMS_SEND')
    expect(script).toContain('ALLOW_FEB_REVIEW_SMS_SEND')
    expect(script).toContain('--limit')
    expect(script).toContain('--url')

    // Safe default: never bake in production domains as fallbacks.
    expect(script).toContain('http://localhost:3000')
    expect(script).not.toContain('https://management.orangejelly.co.uk')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })
})

