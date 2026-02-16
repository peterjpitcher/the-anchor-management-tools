import fs from 'node:fs'
import path from 'node:path'

describe('SMS cleanup scripts', () => {
  it('delete-old-sms-messages defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/cleanup/delete-old-sms-messages.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('--min-age-days')
    expect(script).toContain('--delete-jobs')
    expect(script).toContain('--jobs-limit')
    expect(script).toContain('RUN_DELETE_OLD_SMS_MESSAGES_MUTATION')
    expect(script).toContain('ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('delete-all-queued-messages defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/cleanup/delete-all-queued-messages.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('--delete-jobs')
    expect(script).toContain('--jobs-limit')
    expect(script).toContain('RUN_DELETE_ALL_QUEUED_MESSAGES_MUTATION')
    expect(script).toContain('ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('delete-all-pending-sms defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/cleanup/delete-all-pending-sms.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_DELETE_ALL_PENDING_SMS_MUTATION')
    expect(script).toContain('ALLOW_DELETE_ALL_PENDING_SMS_SCRIPT')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('delete-pending-sms defaults to dry-run and is multi-gated with caps (non-interactive)', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/cleanup/delete-pending-sms.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('--all')
    expect(script).toContain('--job-ids')
    expect(script).toContain('RUN_DELETE_PENDING_SMS_MUTATION')
    expect(script).toContain('ALLOW_DELETE_PENDING_SMS_SCRIPT')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')

    expect(script).not.toContain('readline')
    expect(script).not.toContain('process.stdin')
    expect(script).not.toContain('askQuestion(')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('delete-test-invoices defaults to read-only mode and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/cleanup/delete-test-invoices.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('Read-only mode')
    expect(script).toContain('RUN_DELETE_TEST_INVOICES_MUTATION')
    expect(script).toContain('ALLOW_DELETE_TEST_INVOICES_MUTATION')
    expect(script).toContain('readDeleteInvoiceCleanupLimit')
    expect(script).toContain('assertDeleteInvoiceCleanupLimit')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('delete-specific-invoice defaults to read-only mode and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/cleanup/delete-specific-invoice.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('--invoice-id')
    expect(script).toContain('--limit')
    expect(script).toContain('Read-only mode')
    expect(script).toContain('RUN_DELETE_SPECIFIC_INVOICE_MUTATION')
    expect(script).toContain('ALLOW_DELETE_SPECIFIC_INVOICE_MUTATION')
    expect(script).toContain('readDeleteInvoiceCleanupLimit')
    expect(script).toContain('assertDeleteInvoiceCleanupLimit')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('delete-peter-pitcher-bookings defaults to read-only mode and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/cleanup/delete-peter-pitcher-bookings.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('Read-only mode')
    expect(script).toContain('RUN_DELETE_PETER_PITCHER_BOOKINGS_MUTATION')
    expect(script).toContain('ALLOW_DELETE_PETER_PITCHER_BOOKINGS_MUTATION')
    expect(script).toContain('readDeletePeterPitcherBookingsLimit')
    expect(script).toContain('assertDeletePeterPitcherBookingsLimit')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('delete-peter-test-bookings defaults to read-only mode and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/cleanup/delete-peter-test-bookings.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('Read-only mode')
    expect(script).toContain('RUN_DELETE_PETER_TEST_BOOKINGS_MUTATION')
    expect(script).toContain('ALLOW_DELETE_PETER_TEST_BOOKINGS_MUTATION')
    expect(script).toContain('readDeletePeterTestBookingsLimit')
    expect(script).toContain('assertDeletePeterTestBookingsLimit')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('delete-all-table-bookings defaults to read-only mode and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/cleanup/delete-all-table-bookings.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('Read-only analysis mode')
    expect(script).toContain('RUN_DELETE_ALL_TABLE_BOOKINGS_MUTATION')
    expect(script).toContain('ALLOW_DELETE_ALL_TABLE_BOOKINGS_MUTATION')
    expect(script).toContain('readDeleteAllTableBookingsLimit')
    expect(script).toContain('assertDeleteAllTableBookingsLimit')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })
})
