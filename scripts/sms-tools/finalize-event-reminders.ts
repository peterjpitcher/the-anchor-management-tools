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
  assertFinalizeEventRemindersJobLimit,
  assertFinalizeEventRemindersMutationAllowed,
  assertFinalizeEventRemindersReminderLimit,
  assertFinalizeEventRemindersRunEnabled,
  readFinalizeEventRemindersJobLimit,
  readFinalizeEventRemindersReminderLimit,
  resolveFinalizeEventRemindersOperations
} from '../../src/lib/finalize-event-reminders-script-safety'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const LONDON_TZ = 'Europe/London'

function getLondonDateIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: LONDON_TZ })
}

async function finalizeEventReminders() {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const HARD_CAP = 500

  if (argv.includes('--help')) {
    console.log(`
finalize-event-reminders (safe by default)

Dry-run (default):
  tsx scripts/sms-tools/finalize-event-reminders.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_FINALIZE_EVENT_REMINDERS_MUTATION=true ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION=true \\
    tsx scripts/sms-tools/finalize-event-reminders.ts --confirm \\
      --cancel-reminders --reminder-limit 50 \\
      --cancel-jobs --job-limit 50

Notes:
  - Limits can also be supplied via FINALIZE_EVENT_REMINDERS_REMINDER_LIMIT and FINALIZE_EVENT_REMINDERS_JOB_LIMIT.
`)
    return
  }

  const operations = resolveFinalizeEventRemindersOperations(argv)
  const reminderLimit = readFinalizeEventRemindersReminderLimit(argv)
  const jobLimit = readFinalizeEventRemindersJobLimit(argv)

  const mutationEnabled = confirm
  if (mutationEnabled) {
    assertFinalizeEventRemindersRunEnabled()
    assertFinalizeEventRemindersMutationAllowed()

    if (operations.cancelReminders) {
      assertFinalizeEventRemindersReminderLimit(reminderLimit ?? 0, HARD_CAP)
    }
    if (operations.cancelJobs) {
      assertFinalizeEventRemindersJobLimit(jobLimit ?? 0, HARD_CAP)
    }
  }

  console.log(`🧹 Finalizing event reminder backlog (${mutationEnabled ? 'MUTATION' : 'DRY-RUN'})...\n`)

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const todayLondon = getLondonDateIso()

  console.log(`Using London date cutoff: ${todayLondon}`)

  // 1) Cancel pending reminders for past events
  console.log('\n1️⃣ Checking reminders for past events...')

  const { data: reminders, error: remindersError } = await supabase
    .from('booking_reminders')
    .select(`
      id,
      status,
      reminder_type,
      scheduled_for,
      booking:bookings(
        event:events(
          id,
          name,
          date
        )
      )
    `)
    .in('status', ['pending', 'queued', 'sending'])

  const pendingReminderRows = (assertScriptQuerySucceeded({
    operation: 'Load pending/queued/sending reminders',
    error: remindersError,
    data: reminders ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; booking?: unknown }>

  const {
    pastReminderIds,
    invalidReminderIds
  } = selectPastEventReminderIds({
    rows: pendingReminderRows,
    todayIsoDate: todayLondon
  })
  assertNoInvalidPastEventReminderRows(invalidReminderIds)

  const pastReminderIdSet = new Set(pastReminderIds)
  const pastEventReminders = pendingReminderRows.filter(
    (row) => typeof row.id === 'string' && pastReminderIdSet.has(row.id)
  )

  if (pastReminderIds.length === 0) {
    console.log('✅ No pending reminders for past events found')
  } else if (!operations.cancelReminders) {
    console.log('Skipping reminder cancellation (not requested).')
  } else {
    console.log(`Found ${pastReminderIds.length} reminders tied to past events`) 

    const sample = pastEventReminders.slice(0, 5)
    sample.forEach(reminder => {
      const reminderAny = reminder as any
      console.log(`  - ${reminderAny.booking?.event?.name ?? 'Unknown event'} (${reminderAny.booking?.event?.date})`) 
    })

    const remindersToCancel =
      mutationEnabled
        ? pastReminderIds.slice(0, Math.min(pastReminderIds.length, reminderLimit ?? 0))
        : pastReminderIds

    console.log(
      `\n${mutationEnabled ? 'Cancelling' : 'Would cancel'} ${remindersToCancel.length}/${pastReminderIds.length} reminder(s)...`
    )

    if (mutationEnabled) {
      if (remindersToCancel.length === 0) {
        console.log('No reminders selected for cancellation (limit is 0).')
      } else {
        const { data: cancelledRows, error: cancelError } = await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: 'Cancelled pending reminder for past event (finalize)',
            updated_at: nowIso
          })
          .in('id', remindersToCancel)
          .in('status', ['pending', 'queued', 'sending'])
          .select('id')

        const { updatedCount: cancelledCount } = assertScriptMutationSucceeded({
          operation: 'Cancel pending reminders for past events (finalize)',
          error: cancelError,
          updatedRows: cancelledRows ?? [],
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Cancel pending reminders for past events (finalize)',
          expected: remindersToCancel.length,
          actual: cancelledCount
        })

        console.log(`✅ Cancelled ${cancelledCount} reminder(s) for past events`)
      }
    } else {
      console.log('\nDry-run mode: no reminder rows updated.')
    }
  }

  // 2) Cancel any pending reminder-processing jobs
  console.log('\n2️⃣ Checking reminder processing jobs...')

  const { data: reminderJobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id, status, created_at')
    .eq('type', 'process_event_reminder')
    .in('status', ['pending', 'processing'])

  const pendingReminderJobs = (assertScriptQuerySucceeded({
    operation: 'Load pending reminder jobs (finalize)',
    error: jobsError,
    data: reminderJobs ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string }>

  const reminderJobIds = extractUniqueRowIds({
    operation: 'Load pending reminder jobs (finalize)',
    rows: pendingReminderJobs
  })

  if (reminderJobIds.length === 0) {
    console.log('✅ No pending reminder jobs found')
  } else if (!operations.cancelJobs) {
    console.log('Skipping reminder-job cancellation (not requested).')
  } else {
    const jobsToCancel =
      mutationEnabled
        ? reminderJobIds.slice(0, Math.min(reminderJobIds.length, jobLimit ?? 0))
        : reminderJobIds

    console.log(`Found ${reminderJobIds.length} pending reminder jobs`) 

    console.log(
      `\n${mutationEnabled ? 'Cancelling' : 'Would cancel'} ${jobsToCancel.length}/${reminderJobIds.length} job(s)...`
    )

    if (mutationEnabled) {
      if (jobsToCancel.length === 0) {
        console.log('No jobs selected for cancellation (limit is 0).')
      } else {
        const { data: cancelledJobRows, error: cancelJobsError } = await supabase
          .from('jobs')
          .update({
            status: 'cancelled',
            error_message: 'Cancelled during reminder finalization',
            updated_at: nowIso
          })
          .in('id', jobsToCancel)
          .eq('type', 'process_event_reminder')
          .in('status', ['pending', 'processing'])
          .select('id')

        const { updatedCount: cancelledJobCount } = assertScriptMutationSucceeded({
          operation: 'Cancel pending reminder jobs (finalize)',
          error: cancelJobsError,
          updatedRows: cancelledJobRows ?? [],
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Cancel pending reminder jobs (finalize)',
          expected: jobsToCancel.length,
          actual: cancelledJobCount
        })

        console.log(`✅ Cancelled ${cancelledJobCount} reminder job(s)`)
      }
    } else {
      console.log('\nDry-run mode: no job rows updated.')
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log(`✅ ${mutationEnabled ? 'FINALIZATION COMPLETE' : 'DRY-RUN COMPLETE'}!`)
  if (!mutationEnabled) {
    console.log('No mutations performed (dry-run).')
    console.log(
      'To mutate, pass --confirm + operation flags + limits, and set RUN_FINALIZE_EVENT_REMINDERS_MUTATION=true and ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION=true.'
    )
  }
  console.log('='.repeat(50))
}

finalizeEventReminders().catch(error => {
  console.error('❌ Reminder finalization failed:', error)
  process.exitCode = 1
})
