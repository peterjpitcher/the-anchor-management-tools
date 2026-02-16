import * as dotenv from 'dotenv'
import { resolve } from 'path'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertNoInvalidPastEventReminderRows,
  extractUniqueRowIds,
  selectPastEventReminderIds
} from '../../src/lib/reminder-backlog-safety'
import {
  assertFixPastRemindersMutationAllowed,
  assertFixPastRemindersRunEnabled,
  assertFixPastRemindersReminderLimit,
  assertFixPastRemindersSmsJobLimit,
  readFixPastRemindersReminderLimit,
  readFixPastRemindersSmsJobLimit,
  resolveFixPastRemindersOperations
} from '../../src/lib/fix-past-reminders-script-safety'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function fixPastReminders() {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const HARD_CAP = 500

  if (argv.includes('--help')) {
    console.log(`
fix-past-reminders (safe by default)

Dry-run (default):
  ts-node scripts/sms-tools/fix-past-reminders.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_FIX_PAST_REMINDERS_MUTATION=true ALLOW_FIX_PAST_REMINDERS_MUTATION=true \\
    ts-node scripts/sms-tools/fix-past-reminders.ts --confirm \\
      --cancel-reminders --reminder-limit 50 \\
      --delete-pending-sms-jobs --job-limit 50
`)
    return
  }

  const operations = resolveFixPastRemindersOperations(argv)
  const reminderLimit = readFixPastRemindersReminderLimit(argv)
  const jobLimit = readFixPastRemindersSmsJobLimit(argv)

  const mutationEnabled = confirm
  if (mutationEnabled) {
    assertFixPastRemindersRunEnabled()
    assertFixPastRemindersMutationAllowed()

    if (operations.cancelReminders) {
      assertFixPastRemindersReminderLimit(reminderLimit ?? 0, HARD_CAP)
    }
    if (operations.deletePendingSmsJobs) {
      assertFixPastRemindersSmsJobLimit(jobLimit ?? 0, HARD_CAP)
    }
  }

  console.log(`🔧 FIXING PAST EVENT REMINDERS (${mutationEnabled ? 'MUTATION' : 'DRY-RUN'})...\n`)
  
  const supabase = createAdminClient()
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]
  
  // Step 1: Cancel all pending reminders for past events
  console.log('1️⃣ Finding pending reminders for past events...')
  
  const { data: pastReminders, error: fetchError } = await supabase
    .from('booking_reminders')
    .select(`
      id,
      booking_id,
      reminder_type,
      scheduled_for,
      booking:bookings(
        event:events(
          name,
          date
        )
      )
    `)
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: false })

  const pendingReminderRows = (assertScriptQuerySucceeded({
    operation: 'Load pending event reminders',
    error: fetchError,
    data: pastReminders ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    booking?: unknown
  }>

  const { pastReminderIds, invalidReminderIds } = selectPastEventReminderIds({
    rows: pendingReminderRows,
    todayIsoDate: todayStr
  })
  assertNoInvalidPastEventReminderRows(invalidReminderIds)
  const pastReminderIdSet = new Set(pastReminderIds)
  const pastEventReminderRows = pendingReminderRows.filter(
    (row) => typeof row.id === 'string' && pastReminderIdSet.has(row.id)
  )

  console.log(`Found ${pastReminderIds.length} pending reminders for past events`)
  
  const remindersToCancel =
    operations.cancelReminders && mutationEnabled
      ? pastReminderIds.slice(0, Math.min(pastReminderIds.length, reminderLimit ?? 0))
      : pastReminderIds

  if (pastReminderIds.length === 0) {
    console.log('✅ No pending reminders for past events found')
  } else if (!operations.cancelReminders) {
    console.log('Skipping reminder cancellation (not requested).')
  } else {
    console.log(`\n${mutationEnabled ? 'Cancelling' : 'Would cancel'} reminders for past events:`)
    
    // Show sample of what will be cancelled
    const sampleSize = Math.min(5, pastEventReminderRows.length)
    for (let i = 0; i < sampleSize; i++) {
      const r = pastEventReminderRows[i] as any
      console.log(`  - ${r.booking?.event?.name} on ${r.booking?.event?.date}`)
    }
    if (pastReminderIds.length > 5) {
      console.log(`  ... and ${pastReminderIds.length - 5} more`)
    }

    if (mutationEnabled) {
      if (remindersToCancel.length === 0) {
        console.log('No reminders selected for cancellation (limit is 0).')
      } else {
        console.log(`\nCancelling ${remindersToCancel.length} reminder(s) (cap applied).`)
        const { data: cancelledReminderRows, error: updateError } = await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: 'Event has already passed - cancelled by fix script',
            updated_at: new Date().toISOString()
          })
          .in('id', remindersToCancel)
          .eq('status', 'pending')
          .select('id')

        const { updatedCount: cancelledCount } = assertScriptMutationSucceeded({
          operation: 'Cancel pending reminders for past events',
          error: updateError,
          updatedRows: cancelledReminderRows ?? [],
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Cancel pending reminders for past events',
          expected: remindersToCancel.length,
          actual: cancelledCount
        })

        console.log(`✅ Successfully cancelled ${cancelledCount} reminders for past events`)
      }
    } else {
      console.log('\nDry-run mode: no reminder rows updated.')
    }
  }
  
  // Step 2: Delete any pending SMS jobs
  console.log('\n2️⃣ Checking for pending SMS jobs...')
  
  const { data: pendingJobs, error: jobError } = await supabase
    .from('jobs')
    .select('id, type, created_at')
    .eq('status', 'pending')
    .in('type', ['send_sms', 'send_bulk_sms'])
    .order('created_at', { ascending: false })

  const pendingSmsJobRows = (assertScriptQuerySucceeded({
    operation: 'Load pending SMS jobs',
    error: jobError,
    data: pendingJobs ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; type: string; created_at: string }>

  const pendingSmsJobIds = extractUniqueRowIds({
    operation: 'Load pending SMS jobs',
    rows: pendingSmsJobRows
  })

  const smsJobsToDelete =
    operations.deletePendingSmsJobs && mutationEnabled
      ? pendingSmsJobIds.slice(0, Math.min(pendingSmsJobIds.length, jobLimit ?? 0))
      : pendingSmsJobIds

  if (pendingSmsJobIds.length === 0) {
    console.log('✅ No pending SMS jobs found')
  } else if (!operations.deletePendingSmsJobs) {
    console.log('Skipping pending SMS job deletion (not requested).')
  } else {
    console.log(`Found ${pendingSmsJobIds.length} pending SMS jobs`)
    
    console.log(`\n${mutationEnabled ? 'Deleting' : 'Would delete'} pending SMS jobs:`)
    const sampleJobs = pendingSmsJobRows.slice(0, 10)
    sampleJobs.forEach((job) => {
      console.log(`  - Job ${job.id}: ${job.type} created at ${job.created_at}`)
    })
    if (pendingSmsJobIds.length > sampleJobs.length) {
      console.log(`  ... and ${pendingSmsJobIds.length - sampleJobs.length} more`)
    }

    if (mutationEnabled) {
      if (smsJobsToDelete.length === 0) {
        console.log('No SMS jobs selected for deletion (limit is 0).')
      } else {
        console.log(`\nDeleting ${smsJobsToDelete.length} job(s) (cap applied).`)
        const { data: deletedRows, error: deleteError } = await supabase
          .from('jobs')
          .delete()
          .in('id', smsJobsToDelete)
          .eq('status', 'pending')
          .in('type', ['send_sms', 'send_bulk_sms'])
          .select('id')

        const { updatedCount: deletedCount } = assertScriptMutationSucceeded({
          operation: 'Delete pending SMS jobs',
          error: deleteError,
          updatedRows: deletedRows ?? [],
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Delete pending SMS jobs',
          expected: smsJobsToDelete.length,
          actual: deletedCount
        })

        console.log(`✅ Successfully deleted ${deletedCount} pending SMS jobs`)
      }
    } else {
      console.log('\nDry-run mode: no jobs deleted.')
    }
  }
  
  // Step 3: Check upcoming events
  console.log('\n3️⃣ Checking upcoming events that should have reminders...')
  
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + 7)
  
  const { data: upcomingEvents, error: eventError } = await supabase
    .from('events')
    .select('*')
    .gte('date', todayStr)
    .lte('date', nextWeek.toISOString().split('T')[0])
    .order('date', { ascending: true })

  const upcomingEventRows = (assertScriptQuerySucceeded({
    operation: 'Load upcoming events for reporting',
    error: eventError,
    data: upcomingEvents ?? [],
    allowMissing: true
  }) ?? []) as Array<{ name: string; date: string; time: string | null }>

  if (upcomingEventRows.length > 0) {
    console.log(`\nUpcoming events in the next week:`)
    upcomingEventRows.forEach(e => {
      console.log(`  ✅ ${e.name} on ${e.date} at ${e.time}`)
    })
    console.log('\nThese events will receive reminders if they have bookings')
  } else {
    console.log('No upcoming events in the next week')
  }
  
  console.log('\n' + '='.repeat(50))
  console.log(`✅ ${mutationEnabled ? 'FIX COMPLETE' : 'DRY-RUN COMPLETE'}!`)
  console.log('='.repeat(50))
  console.log('\nSummary:')
  console.log(`1. Past-event reminders detected: ${pastReminderIds.length}`)
  console.log(`2. Pending SMS jobs detected: ${pendingSmsJobIds.length}`)
  if (!mutationEnabled) {
    console.log('\nNo mutations performed (dry-run).')
    console.log(
      'To mutate, pass --confirm + operation flags + limits, and set RUN_FIX_PAST_REMINDERS_MUTATION=true and ALLOW_FIX_PAST_REMINDERS_MUTATION=true.'
    )
  }
}

fixPastReminders().catch((error) => {
  console.error('fix-past-reminders script failed:', error)
  process.exitCode = 1
})
