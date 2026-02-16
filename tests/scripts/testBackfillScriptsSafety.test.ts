import fs from 'node:fs'
import path from 'node:path'

describe('scripts/backfill safety defaults', () => {
  it('cancelled-parking backfill is dry-run by default and requires multi-gating + explicit caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/backfill/cancelled-parking.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('--booking-id')
    expect(script).toContain('RUN_PARKING_CANCELLED_BACKFILL_MUTATION')
    expect(script).toContain('ALLOW_PARKING_CANCELLED_BACKFILL_SCRIPT')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).toContain('process.exitCode')
    expect(script).not.toContain('process.exit(')
  })

  it('employee-birthdays-to-calendar backfill is dry-run by default and requires multi-gating + explicit caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/backfill/employee-birthdays-to-calendar.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_EMPLOYEE_BIRTHDAYS_CALENDAR_SYNC')
    expect(script).toContain('ALLOW_EMPLOYEE_BIRTHDAYS_CALENDAR_SYNC_SCRIPT')

    expect(script).toContain('syncBirthdayCalendarEvent')
    expect(script).toContain('isCalendarConfigured')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).toContain('process.exitCode')
    expect(script).not.toContain('process.exit(')
  })
})

