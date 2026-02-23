import fs from 'node:fs'
import path from 'node:path'

describe('scripts/tools/repair-table-payment-short-links.ts', () => {
  it('defaults to dry-run, is mutation-gated, and fails non-zero on partial failures', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/tools/repair-table-payment-short-links.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('RUN_REPAIR_TABLE_PAYMENT_SHORT_LINKS_MUTATION')
    expect(script).toContain('ALLOW_REPAIR_TABLE_PAYMENT_SHORT_LINKS_MUTATION_SCRIPT')
    expect(script).toContain('assertScriptCompletedWithoutFailures')
    expect(script).toContain('process.exitCode = 1')
    expect(script).not.toContain('process.exit(')
  })
})
