import fs from 'node:fs'
import path from 'node:path'

function readScript(relativePath: string): string {
  const scriptPath = path.resolve(process.cwd(), relativePath)
  return fs.readFileSync(scriptPath, 'utf8')
}

describe('mutation script gating', () => {
  it('fix-sms-template-keys defaults to dry-run and requires explicit multi-gating + caps', () => {
    const script = readScript('scripts/fixes/fix-sms-template-keys.ts')

    expect(script).toContain('isFixSmsTemplateKeysMutationEnabled')
    expect(script).toContain('RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION')
    expect(script).toContain('ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT')
    expect(script).toContain('assertFixSmsTemplateKeysLimit')
    expect(script).toContain('--limit')
    expect(script).toContain('--confirm')
    expect(script).toContain('process.exitCode = 1')
  })

  it('complete-past-event-checklists defaults to dry-run and requires explicit multi-gating + caps', () => {
    const script = readScript('scripts/database/complete-past-event-checklists.ts')

    expect(script).toContain('isCompletePastEventChecklistsMutationEnabled')
    expect(script).toContain('RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION')
    expect(script).toContain('ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT')
    expect(script).toContain('assertCompletePastEventChecklistsEventLimit')
    expect(script).toContain('--event-limit')
    expect(script).toContain('--confirm')
    expect(script).toContain('process.exitCode = 1')
  })

  it('remove-historic-import-notes defaults to dry-run and requires explicit multi-gating + caps', () => {
    const script = readScript('scripts/cleanup/remove-historic-import-notes.ts')

    expect(script).toContain('isRemoveHistoricImportNotesMutationEnabled')
    expect(script).toContain('RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION')
    expect(script).toContain('ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT')
    expect(script).toContain('assertRemoveHistoricImportNotesLimit')
    expect(script).toContain('--limit')
    expect(script).toContain('--confirm')
    expect(script).toContain('process.exitCode = 1')
  })

  it('delete-approved-duplicates defaults to dry-run and requires explicit multi-gating + caps', () => {
    const script = readScript('scripts/cleanup/delete-approved-duplicates.ts')

    expect(script).toContain('isDeleteApprovedDuplicatesMutationEnabled')
    expect(script).toContain('RUN_DELETE_APPROVED_DUPLICATES_MUTATION')
    expect(script).toContain('ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT')
    expect(script).toContain('assertDeleteApprovedDuplicatesLimit')
    expect(script).toContain('--limit')
    expect(script).toContain('--confirm')
    expect(script).toContain('process.exitCode = 1')
  })

  it('fix-table-booking-api-permissions defaults to dry-run and requires explicit multi-gating + key hash', () => {
    const script = readScript('scripts/fixes/fix-table-booking-api-permissions.ts')

    expect(script).toContain('isFixTableBookingApiPermissionsMutationEnabled')
    expect(script).toContain('RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION')
    expect(script).toContain('ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT')
    expect(script).toContain('assertFixTableBookingApiPermissionsLimit')
    expect(script).toContain('--limit')
    expect(script).toContain('--key-hash')
    expect(script).toContain('--confirm')
    expect(script).toContain('process.exitCode = 1')
  })

  it('fix-table-booking-sms write probe is gated behind explicit multi-gating', () => {
    const script = readScript('scripts/fixes/fix-table-booking-sms.ts')

    expect(script).toContain('assertFixTableBookingSmsProbeLimit')
    expect(script).toContain('RUN_FIX_TABLE_BOOKING_SMS_WRITE_PROBE')
    expect(script).toContain('ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION')
    expect(script).toContain('--confirm')
    expect(script).toContain('--write-probe')
    expect(script).toContain('--limit')
    expect(script).toContain('process.exitCode = 1')
  })

  it('fix-pending-payment defaults to dry-run and requires explicit multi-gating', () => {
    const script = readScript('scripts/fixes/fix-pending-payment.ts')

    expect(script).toContain('assertFixPendingPaymentLimit')
    expect(script).toContain('RUN_FIX_PENDING_PAYMENT_MUTATION')
    expect(script).toContain('ALLOW_FIX_PENDING_PAYMENT_MUTATION')
    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('process.exitCode = 1')
  })

  it('fix-duplicate-loyalty-program defaults to dry-run and requires explicit multi-gating + caps', () => {
    const script = readScript('scripts/fixes/fix-duplicate-loyalty-program.ts')

    expect(script).toContain('RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION')
    expect(script).toContain('ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION')
    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')
    expect(script).toContain('process.exitCode = 1')
  })

  it('fix-superadmin-permissions defaults to dry-run and requires explicit multi-gating + operation caps', () => {
    const script = readScript('scripts/fixes/fix-superadmin-permissions.ts')

    expect(script).toContain('isFixSuperadminPermissionsMutationEnabled')
    expect(script).toContain('RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION')
    expect(script).toContain('ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT')
    expect(script).toContain('assertFixSuperadminPermissionsLimit')
    expect(script).toContain('--confirm')
    expect(script).toContain('--grant-all-missing')
    expect(script).toContain('--limit')
    expect(script).toContain('process.exitCode = 1')
    expect(script).not.toContain('process.exit(')
  })

  it('delete-specific-customers defaults to dry-run and requires explicit multi-gating + caps', () => {
    const script = readScript('scripts/cleanup/delete-specific-customers.ts')

    expect(script).toContain('RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION')
    expect(script).toContain('ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION')
    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')
    expect(script).toContain('HARD_CAP')
    expect(script).toContain('DRY RUN')
    expect(script).toContain('process.exitCode = 1')
  })

  it('delete-test-bookings defaults to dry-run and requires explicit multi-gating + caps for deletes', () => {
    const script = readScript('scripts/cleanup/delete-test-bookings.ts')

    expect(script).toContain('RUN_DELETE_TEST_BOOKINGS_MUTATION')
    expect(script).toContain('ALLOW_DELETE_TEST_BOOKINGS_MUTATION')
    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('readDeleteTestBookingsLimit')
    expect(script).toContain('assertDeleteTestBookingsLimit')
    expect(script).toContain('--dry-run')
    expect(script).toContain('DRY RUN')
    expect(script).toContain('process.exitCode = 1')
  })

  it('delete-test-customers-direct defaults to read-only and requires explicit multi-gating + caps', () => {
    const script = readScript('scripts/cleanup/delete-test-customers-direct.ts')

    expect(script).toContain('RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION')
    expect(script).toContain('ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION')
    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('HARD_CAP')
    expect(script).toContain('process.exitCode = 1')
  })

  it('delete-test-customers wrapper delegates to the hardened direct script (no server actions)', () => {
    const script = readScript('scripts/cleanup/delete-test-customers.ts')

    expect(script).toContain("import './delete-test-customers-direct'")
    expect(script).not.toContain('@/app/actions/customers')
    expect(script).not.toContain('deleteTestCustomers(')
  })

  it('sms-tools mutation scripts default to read-only and require multi-gating + caps', () => {
    const scripts = [
      {
        path: 'scripts/sms-tools/backfill-twilio-log.ts',
        runEnv: 'RUN_TWILIO_LOG_BACKFILL_MUTATION',
        allowEnv: 'ALLOW_TWILIO_LOG_BACKFILL_MUTATION_SCRIPT',
        capMarker: '--limit'
      },
      {
        path: 'scripts/sms-tools/fix-past-reminders.ts',
        runEnv: 'RUN_FIX_PAST_REMINDERS_MUTATION',
        allowEnv: 'ALLOW_FIX_PAST_REMINDERS_MUTATION',
        capMarker: '--reminder-limit'
      },
      {
        path: 'scripts/sms-tools/finalize-event-reminders.ts',
        runEnv: 'RUN_FINALIZE_EVENT_REMINDERS_MUTATION',
        allowEnv: 'ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION',
        capMarker: '--reminder-limit'
      },
      {
        path: 'scripts/sms-tools/migrate-invite-reminders.ts',
        runEnv: 'RUN_MIGRATE_INVITE_REMINDERS_MUTATION',
        allowEnv: 'ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION',
        capMarker: '--booking-limit'
      },
      {
        path: 'scripts/sms-tools/cleanup-phone-numbers.ts',
        runEnv: 'RUN_CLEANUP_PHONE_NUMBERS_MUTATION',
        allowEnv: 'ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION',
        capMarker: '--limit'
      },
      {
        path: 'scripts/sms-tools/clear-stuck-jobs.ts',
        runEnv: 'RUN_CLEAR_STUCK_JOBS_MUTATION',
        allowEnv: 'ALLOW_CLEAR_STUCK_JOBS_MUTATION',
        capMarker: '--stale-limit'
      },
      {
        path: 'scripts/sms-tools/clear-reminder-backlog.ts',
        runEnv: 'RUN_CLEAR_REMINDER_BACKLOG_MUTATION',
        allowEnv: 'ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION',
        capMarker: '--reminder-limit'
      },
    ]

    for (const entry of scripts) {
      const script = readScript(entry.path)

      expect(script).toContain('--confirm')
      expect(script).toContain(entry.runEnv)
      expect(script).toContain(entry.allowEnv)
      expect(script).toContain(entry.capMarker)
      expect(script).toContain('createAdminClient')
      expect(script).not.toContain('@supabase/supabase-js')
      expect(script).toContain('process.exitCode = 1')
      expect(script).not.toContain('process.exit(')
    }
  })

  it('check-deployment-status defaults to dry-run and requires explicit multi-gating + cap for sends', () => {
    const script = readScript('scripts/database/check-deployment-status.ts')

    expect(script).toContain('--confirm')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_CHECK_DEPLOYMENT_STATUS_SEND')
    expect(script).toContain('ALLOW_CHECK_DEPLOYMENT_STATUS_SEND')
    expect(script).toContain('ALLOW_CHECK_DEPLOYMENT_STATUS_REMOTE')
    expect(script).toContain('ALLOW_CHECK_DEPLOYMENT_STATUS_PROD')
    expect(script).toContain('assertSendLimit')
    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(limitRaw, 10)')
    expect(script).toContain('process.exitCode = 1')
    expect(script).not.toContain('process.exit(')
  })
})
