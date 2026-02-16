import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/* table booking API scripts', () => {
  it('requires explicit gating and does not default to production or baked-in secrets/phones', () => {
    const scriptPaths = [
      'scripts/testing/test-api-booking-fix.ts',
      'scripts/testing/test-booking-now.ts',
      'scripts/testing/test-sunday-lunch-api.ts',
      'scripts/testing/test-sunday-lunch-payment-fix.ts',
    ]

    for (const relativePath of scriptPaths) {
      const scriptPath = path.resolve(process.cwd(), relativePath)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('--confirm')
      expect(script).toContain('--limit')
      expect(script).toContain('RUN_TEST_TABLE_BOOKING_API_SEND')
      expect(script).toContain('ALLOW_TEST_TABLE_BOOKING_API_SEND')
      expect(script).toContain('ALLOW_TEST_TABLE_BOOKING_API_REMOTE')
      expect(script).toContain('ALLOW_TEST_TABLE_BOOKING_API_PROD')
      expect(script).toContain('--prod')
      expect(script).toContain('/^[1-9]\\d*$/')
      expect(script).toContain('Invalid positive integer')
      expect(script).toContain('Number.isInteger')
      expect(script).not.toContain('Number.parseInt')

      // Default local-only; remote/prod must be explicitly requested via --url/--prod plus env gates.
      expect(script).toContain('http://localhost:3000')
      expect(script).not.toContain('https://management.orangejelly.co.uk')

      // Guard against accidental commits of real keys or baked-in phone numbers.
      expect(script).not.toContain('anch_')
      expect(script).not.toContain('07700900123')
      expect(script).not.toContain('07700900456')
      expect(script).not.toContain('07700900999')

      // Prefer non-terminating exit codes so scripts are testable and fail-closed.
      expect(script).not.toContain('process.exit(')
    }
  })
})
