import * as dotenv from 'dotenv'
import { resolve } from 'path'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertInviteReminderMigrationCompletedWithoutFailures,
  buildInviteReminderDeletePlan
} from '../../src/lib/reminder-invite-migration-safety'
import {
  assertMigrateInviteRemindersBookingLimit,
  assertMigrateInviteRemindersMutationAllowed,
  assertMigrateInviteRemindersRunEnabled,
  readMigrateInviteRemindersBookingLimit,
  resolveMigrateInviteRemindersOperations
} from '../../src/lib/migrate-invite-reminders-script-safety'

// Load environment variables from the local env file so we can use the service role key
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const OLD_REMINDER_TYPES = [
  'reminder_invite_1_month',
  'reminder_invite_1_week',
  'reminder_invite_1_day',
]

async function main() {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const HARD_CAP = 500

  if (argv.includes('--help')) {
    console.log(`
migrate-invite-reminders (safe by default)

Dry-run (default):
  tsx scripts/sms-tools/migrate-invite-reminders.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_MIGRATE_INVITE_REMINDERS_MUTATION=true ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION=true \\
    tsx scripts/sms-tools/migrate-invite-reminders.ts --confirm \\
      --delete-legacy-reminders --reschedule --booking-limit 50

Notes:
  - Booking limit can also be supplied via MIGRATE_INVITE_REMINDERS_BOOKING_LIMIT.
`)
    return
  }

  const operations = resolveMigrateInviteRemindersOperations(argv)
  const bookingLimit = readMigrateInviteRemindersBookingLimit(argv)

  const mutationEnabled = confirm
  if (mutationEnabled) {
    assertMigrateInviteRemindersRunEnabled()
    assertMigrateInviteRemindersMutationAllowed()
    assertMigrateInviteRemindersBookingLimit(bookingLimit ?? 0, HARD_CAP)
  }

  const supabase = createAdminClient()

  console.log(`🔄 Migrating pending invite reminders (${mutationEnabled ? 'MUTATION' : 'DRY-RUN'})...`)

  const { data: pendingRows, error: fetchError } = await supabase
    .from('booking_reminders')
    .select('id, booking_id')
    .eq('status', 'pending')
    .in('reminder_type', OLD_REMINDER_TYPES)

  const pendingReminderRows = (assertScriptQuerySucceeded({
    operation: 'Load pending invite reminders for migration',
    error: fetchError,
    data: pendingRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; booking_id: string }>

  const deletePlan = buildInviteReminderDeletePlan(pendingReminderRows)
  const uniqueBookingIds = deletePlan.bookingIds

  if (pendingReminderRows.length === 0) {
    console.log('✅ No pending invite reminders found. Nothing to migrate.')
    return
  }

  console.log(`➡️  Found ${pendingReminderRows.length} pending invite reminders across ${uniqueBookingIds.length} bookings.`)

  const bookingIdsToProcess = mutationEnabled
    ? uniqueBookingIds.slice(0, Math.min(uniqueBookingIds.length, bookingLimit ?? 0))
    : uniqueBookingIds

  if (uniqueBookingIds.length !== bookingIdsToProcess.length) {
    console.log(
      `Cap applied: processing ${bookingIdsToProcess.length}/${uniqueBookingIds.length} booking(s) in this run.`
    )
  }

  if (!mutationEnabled) {
    console.log('\nDry-run mode: no reminder rows deleted and no scheduler runs executed.')
    console.log(
      'To mutate, pass --confirm + operation flags + caps, and set RUN_MIGRATE_INVITE_REMINDERS_MUTATION=true and ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION=true.'
    )
  }

  let clearedReminders = 0
  const failures: string[] = []

  if (!operations.deleteLegacyReminders) {
    console.log('\nSkipping legacy reminder deletion (not requested).')
  } else if (!mutationEnabled) {
    console.log(`\nWould delete legacy invite reminders for ${uniqueBookingIds.length} booking(s).`)
  } else {
    console.log(`\nDeleting legacy invite reminders for ${bookingIdsToProcess.length} booking(s)...`)

    for (const bookingId of bookingIdsToProcess) {
      const { data: removedRows, error: deleteError } = await supabase
        .from('booking_reminders')
        .delete()
        .eq('booking_id', bookingId)
        .eq('status', 'pending')
        .in('reminder_type', OLD_REMINDER_TYPES)
        .select('id')

      if (deleteError) {
        console.error(`❌ Failed to clear old reminders for booking ${bookingId}:`, deleteError.message)
        failures.push(`delete:${bookingId}:${deleteError.message}`)
        continue
      }

      const expectedDeletes = deletePlan.expectedDeletesByBooking[bookingId] || 0
      try {
        const { updatedCount } = assertScriptMutationSucceeded({
          operation: `Delete pending legacy invite reminders for booking ${bookingId}`,
          error: null,
          updatedRows: removedRows ?? [],
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: `Delete pending legacy invite reminders for booking ${bookingId}`,
          expected: expectedDeletes,
          actual: updatedCount
        })
        clearedReminders += updatedCount
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`❌ Reminder delete safety check failed for booking ${bookingId}:`, message)
        failures.push(`delete:${bookingId}:${message}`)
      }
    }
  }

  if (operations.deleteLegacyReminders && mutationEnabled) {
    console.log(`✅ Cleared ${clearedReminders} pending invite reminders.`)
    assertInviteReminderMigrationCompletedWithoutFailures(failures)
  }

  if (!operations.rescheduleReminders) {
    console.log('\nSkipping scheduler run (not requested).')
    console.log(mutationEnabled ? '\n🎉 Migration finished.' : '\n✨ Dry-run complete.')
    return
  }

  if (!mutationEnabled) {
    console.log(`\nWould re-run reminder scheduler for ${uniqueBookingIds.length} booking(s).`)
    console.log('\n✨ Dry-run complete.')
    return
  }

  console.log('\n📌 Re-running the scheduler so each booking picks up the new cadence...')

  // We import lazily to avoid loading the entire app unless there is work to do
  const { scheduleBookingReminders } = await import('../../src/app/actions/event-sms-scheduler')

  let rescheduled = 0
  const schedulerFailures: string[] = []

  for (const bookingId of bookingIdsToProcess) {
    try {
      const result = await scheduleBookingReminders(bookingId)
      if (!result.success) {
        const reason = result.error || 'unknown scheduler failure'
        console.warn(`⚠️ Could not reschedule reminders for booking ${bookingId}: ${reason}`)
        schedulerFailures.push(`schedule:${bookingId}:${reason}`)
        continue
      }

      rescheduled += result.scheduled
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`⚠️ Scheduler threw while rescheduling booking ${bookingId}: ${reason}`)
      schedulerFailures.push(`schedule:${bookingId}:${reason}`)
    }
  }

  console.log(`✨ Scheduler run complete. Created ${rescheduled} new reminders.`)
  assertInviteReminderMigrationCompletedWithoutFailures(schedulerFailures)

  console.log('🎉 Migration finished.')
}

main().catch(error => {
  console.error('❌ Migration failed:', error)
  process.exitCode = 1
})
