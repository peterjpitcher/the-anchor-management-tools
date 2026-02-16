import fs from 'node:fs'
import path from 'node:path'

function readScript(relativePath: string): string {
  const scriptPath = path.resolve(process.cwd(), relativePath)
  return fs.readFileSync(scriptPath, 'utf8')
}

describe('scripts/database check scripts safety', () => {
  const scripts = [
    'scripts/database/check-private-bookings-simple.ts',
    'scripts/database/check-private-bookings-schema.ts',
    'scripts/database/check-click-tracking.ts',
    'scripts/database/check-audit-logs.ts',
    'scripts/database/check-attendance-dates.ts',
    'scripts/database/check-booking-duplicates.ts',
    'scripts/database/check-booking-errors.ts',
    'scripts/database/check-booking-discount.ts',
    'scripts/database/check-current-schema.ts',
    'scripts/database/check-customer-schema.ts',
    'scripts/database/check-customer-labels.ts',
    'scripts/database/check-customer-phone.ts',
    'scripts/database/check-loyalty-program.ts',
    'scripts/database/check-event-categories-migration.ts',
    'scripts/database/check-migration-simple.ts',
    'scripts/database/check-migration-table-structure.ts',
    'scripts/database/check-migration-history.ts',
    'scripts/database/check-migrations.ts',
    'scripts/database/check-schema-admin.ts',
    'scripts/database/check-schema-env.ts',
    'scripts/database/check-supabase-clients.ts',
    'scripts/database/check-invoice-system.ts',
    'scripts/database/check-job-tables.ts',
    'scripts/database/check-jobs.ts',
    'scripts/database/check-messages-permissions.ts',
    'scripts/database/check-messages.ts',
    'scripts/database/check-production-templates.ts',
    'scripts/database/check-event-categories.ts',
    'scripts/database/check-event-categories-data.ts',
    'scripts/database/check-invalid-phone-numbers.ts',
    'scripts/database/check-invalid-bank-details.ts',
    'scripts/database/check-webhook-logs-new.ts',
    'scripts/database/check-webhook-logs.ts',
    'scripts/database/check-user-permissions.ts',
    'scripts/database/check-customer-preferences.ts',
    'scripts/database/check-customer-suggestions.ts',
    'scripts/database/check-events-with-categories.ts',
    'scripts/database/check-customers-table.ts',
    'scripts/database/check-events-table.ts',
    'scripts/database/check-payment-status.ts',
    'scripts/database/check-latest-booking-details.ts',
    'scripts/database/check-api-key-database.ts',
    'scripts/database/check-performance.ts',
    'scripts/database/check-customers-and-labels.ts',
    'scripts/database/check-event-images.ts',
    'scripts/database/check-pending-booking.ts',
    'scripts/database/check-recent-attendance.ts',
    'scripts/database/check-table-bookings-structure.ts',
    'scripts/database/check-sunday-lunch-orders.ts',
    'scripts/database/check-sunday-lunch-table.ts',
    'scripts/database/check-venue-spaces.ts',
  ]

  it('remain strictly read-only (no insert/update/delete/upsert)', () => {
    for (const scriptPath of scripts) {
      const script = readScript(scriptPath)
      expect(script).not.toContain('.insert(')
      expect(script).not.toContain('.update(')
      expect(script).not.toContain('.delete(')
      expect(script).not.toContain('.upsert(')
    }
  })

  it('does not import Next.js server supabase clients (scripts must use admin client)', () => {
    for (const scriptPath of scripts) {
      const script = readScript(scriptPath)
      expect(script).not.toContain('@/lib/supabase/server')
      expect(script).not.toContain('../src/lib/supabase/server')
      expect(script).not.toContain('../../src/lib/supabase/server')
    }
  })

  it('fails closed (sets non-zero exit code) on fatal errors', () => {
    for (const scriptPath of scripts) {
      const script = readScript(scriptPath)
      expect(script).toContain('process.exitCode = 1')
    }
  })

  it('do not call process.exit (use process.exitCode for fail-closed behavior)', () => {
    for (const scriptPath of scripts) {
      const script = readScript(scriptPath)
      expect(script).not.toContain('process.exit(')
    }
  })

  it('are runnable as tsx scripts', () => {
    for (const scriptPath of scripts) {
      const script = readScript(scriptPath)
      expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
    }
  })

  it('check-api-key-database and check-performance block --confirm and use script-safe query helpers', () => {
    const scriptPaths = [
      'scripts/database/check-api-key-database.ts',
      'scripts/database/check-performance.ts',
    ]

    for (const scriptPath of scriptPaths) {
      const script = readScript(scriptPath)
      expect(script).toContain('--confirm')
      expect(script).toContain('read-only and does not support --confirm')
      expect(script).toContain('createAdminClient')
      expect(script).toContain('assertScriptQuerySucceeded')
      expect(script).not.toContain('@supabase/supabase-js')
    }
  })

  it('check-booking-duplicates uses script-safe admin and anon diagnostics (no raw supabase-js client)', () => {
    const script = readScript('scripts/database/check-booking-duplicates.ts')
    expect(script).toContain('--confirm')
    expect(script).toContain('createAdminClient')
    expect(script).toContain('queryAnonPendingBookingsCount')
    expect(script).not.toContain('@supabase/supabase-js')
  })

  it('job diagnostics scripts block --confirm and enforce bounded script-safe query checks', () => {
    const scriptPaths = [
      'scripts/database/check-failed-jobs.ts',
      'scripts/database/check-job-tables.ts',
      'scripts/database/check-jobs.ts',
    ]

    for (const scriptPath of scriptPaths) {
      const script = readScript(scriptPath)
      expect(script).toContain('--confirm')
      expect(script).toContain('read-only and does not support --confirm')
      expect(script).toContain('--limit')
      expect(script).toContain('HARD_LIMIT_CAP')
      expect(script).toContain('assertScriptQuerySucceeded')
      expect(script).toContain('createAdminClient')
      expect(script).not.toContain('@supabase/supabase-js')
    }
  })
})
