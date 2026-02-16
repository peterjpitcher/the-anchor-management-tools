import fs from 'node:fs'
import path from 'node:path'

describe('SMS diagnostics scripts safety', () => {
  const scripts = [
    'scripts/testing/test-sms-flow.ts',
    'scripts/sms-tools/check-all-jobs.ts',
    'scripts/sms-tools/check-reminder-issues.ts',
    'scripts/database/check-sms-issue.ts',
    'scripts/database/check-sms-jobs.ts',
    'scripts/database/check-bulk-sms-jobs.ts',
    'scripts/database/check-sms-queue.ts',
    'scripts/database/check-sms-status.ts',
    'scripts/database/check-sms-templates.ts',
    'scripts/database/check-table-booking-sms.ts',
    'scripts/database/check-enrollment-sms.ts',
    'scripts/database/check-processed-sms.ts',
    'scripts/database/check-failed-jobs.ts',
    'scripts/database/check-tables.ts',
    'scripts/database/check-production-env.ts',
    'scripts/testing/test-sms-new-customer.ts',
  ]

  it('remain strictly read-only (no DB mutations)', () => {
    for (const rel of scripts) {
      const scriptPath = path.resolve(process.cwd(), rel)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).not.toContain('.insert(')
      expect(script).not.toContain('.update(')
      expect(script).not.toContain('.delete(')
      expect(script).not.toContain('.upsert(')
    }
  })

  it('fail non-zero when any diagnostic check fails', () => {
    for (const rel of scripts) {
      const scriptPath = path.resolve(process.cwd(), rel)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('process.exitCode = 1')
      expect(script).not.toContain('.catch(console.error)')
      expect(script).not.toContain('process.exit(')
    }
  })

  it('are runnable as tsx scripts', () => {
    for (const rel of scripts) {
      const scriptPath = path.resolve(process.cwd(), rel)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
    }
  })

  it('scripts/testing/test-sms-flow.ts blocks --confirm and uses script-safe query helpers', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-sms-flow.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('read-only and does not support --confirm')
    expect(script).toContain('createAdminClient')
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain('@supabase/supabase-js')
  })

  it('scripts/database/check-sms-jobs.ts blocks --confirm and uses script-safe query helpers', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/database/check-sms-jobs.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--confirm')
    expect(script).toContain('read-only and does not support --confirm')
    expect(script).toContain('createAdminClient')
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain('@supabase/supabase-js')
  })

  it('scripts/database/check-sms-queue.ts and check-bulk-sms-jobs.ts block --confirm and use script-safe query helpers', () => {
    const scriptPaths = [
      path.resolve(process.cwd(), 'scripts/database/check-sms-queue.ts'),
      path.resolve(process.cwd(), 'scripts/database/check-bulk-sms-jobs.ts'),
    ]

    for (const scriptPath of scriptPaths) {
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('--confirm')
      expect(script).toContain('read-only and does not support --confirm')
      expect(script).toContain('createAdminClient')
      expect(script).toContain('assertScriptQuerySucceeded')
      expect(script).not.toContain('@supabase/supabase-js')
    }
  })

  it('scripts/database/check-sms-issue.ts and check-table-booking-sms.ts block --confirm and use script-safe query helpers', () => {
    const scriptPaths = [
      path.resolve(process.cwd(), 'scripts/database/check-sms-issue.ts'),
      path.resolve(process.cwd(), 'scripts/database/check-table-booking-sms.ts'),
    ]

    for (const scriptPath of scriptPaths) {
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('--confirm')
      expect(script).toContain('read-only and does not support --confirm')
      expect(script).toContain('createAdminClient')
      expect(script).toContain('assertScriptQuerySucceeded')
      expect(script).not.toContain('@supabase/supabase-js')
    }
  })

  it('scripts/testing/test-sms-new-customer.ts requires explicit --limit=1 for sends', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-sms-new-customer.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('--limit=1')
    expect(script).toContain('readTestSmsNewCustomerLimit')
    expect(script).toContain('assertTestSmsNewCustomerSendLimit')
    expect(script).toContain('phone number argument is required when send mode is enabled')
    expect(script).toContain("markFailure('Twilio connection failed.'")
    expect(script).toContain("markFailure('Unable to fetch pending bookings.'")
    expect(script).not.toContain('Database check skipped (not available in this context)')
  })
})
