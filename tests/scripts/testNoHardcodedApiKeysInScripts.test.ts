import fs from 'node:fs'
import path from 'node:path'

describe('scripts/* hardcoded API key guard', () => {
  it('does not embed Anchor API keys in script sources', () => {
    const keyPattern = /anch_[A-Za-z0-9_-]{10,}/

    const scriptPaths = [
      'scripts/testing/test-api-complete-fix.ts',
      'scripts/database/check-deployment-status.ts',
      'scripts/database/check-api-key-database.ts',
    ]

    for (const relativePath of scriptPaths) {
      const scriptPath = path.resolve(process.cwd(), relativePath)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).not.toMatch(keyPattern)

      // Prefer non-terminating exit codes so scripts are testable and fail-closed.
      expect(script).not.toContain('process.exit(')
      expect(script).toContain('process.exitCode')
    }
  })

  it('requires explicit gating and does not default to production', () => {
    const scriptPaths = [
      'scripts/testing/test-api-complete-fix.ts',
      'scripts/database/check-deployment-status.ts',
    ]

    for (const relativePath of scriptPaths) {
      const scriptPath = path.resolve(process.cwd(), relativePath)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('--confirm')
      expect(script).toContain('http://localhost:3000')
      expect(script).not.toContain('https://management.orangejelly.co.uk')
      expect(script).toContain('--prod')
    }
  })

  it('check-deployment-status requires explicit cap in mutation mode', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/database/check-deployment-status.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--limit')
    expect(script).toContain('assertSendLimit')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(limitRaw, 10)')
    expect(script).toContain('startsWith(`${flag}=`)')
    expect(script).toContain('Send blocked: --limit=1 is required in confirm mode')
    expect(script).toContain('Send blocked: --limit must be 1 in confirm mode')
    expect(script).toContain('RUN_CHECK_DEPLOYMENT_STATUS_SEND')
    expect(script).toContain('ALLOW_CHECK_DEPLOYMENT_STATUS_SEND')
  })
})
