import * as dotenv from 'dotenv'
import { resolve } from 'path'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { extractUniqueRowIds } from '../../src/lib/reminder-backlog-safety'
import {
  assertClearReminderBacklogJobLimit,
  assertClearReminderBacklogMutationAllowed,
  assertClearReminderBacklogReminderLimit,
  assertClearReminderBacklogRunEnabled,
  readClearReminderBacklogJobLimit,
  readClearReminderBacklogReminderLimit,
  resolveClearReminderBacklogOperations
} from '../../src/lib/clear-reminder-backlog-script-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const HARD_CAP = 500

  if (argv.includes('--help')) {
    console.log(`
clear-reminder-backlog (safe by default)

Dry-run (default):
  tsx scripts/sms-tools/clear-reminder-backlog.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_CLEAR_REMINDER_BACKLOG_MUTATION=true ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION=true \\
    tsx scripts/sms-tools/clear-reminder-backlog.ts --confirm \\
      --cancel-reminders --reminder-limit 50 \\
      --cancel-jobs --job-limit 50

Notes:
  - Limits can also be supplied via CLEAR_REMINDER_BACKLOG_REMINDER_LIMIT and CLEAR_REMINDER_BACKLOG_JOB_LIMIT.
`)
    return
  }

  const operations = resolveClearReminderBacklogOperations(argv)
  const reminderLimit = readClearReminderBacklogReminderLimit(argv)
  const jobLimit = readClearReminderBacklogJobLimit(argv)

  const mutationEnabled = confirm
  if (mutationEnabled) {
    assertClearReminderBacklogRunEnabled()
    assertClearReminderBacklogMutationAllowed()

    if (operations.cancelReminders) {
      assertClearReminderBacklogReminderLimit(reminderLimit ?? 0, HARD_CAP)
    }
    if (operations.cancelJobs) {
      assertClearReminderBacklogJobLimit(jobLimit ?? 0, HARD_CAP)
    }
  }

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const reason = `Cleared backlog ${nowIso}`

  console.log(`🔻 Clearing event reminder backlog (${mutationEnabled ? 'MUTATION' : 'DRY-RUN'})...`)

  // Cancel pending/queued reminders so nothing auto-sends when we re-enable
  const { data: dueReminders, error: fetchError } = await supabase
    .from('booking_reminders')
    .select('id, status, reminder_type, scheduled_for')
    .in('status', ['pending', 'queued'])

  const reminderRows = (assertScriptQuerySucceeded({
    operation: 'Load pending/queued reminders',
    error: fetchError,
    data: dueReminders ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string }>

  const dueReminderIds = extractUniqueRowIds({
    operation: 'Load pending/queued reminders',
    rows: reminderRows
  })

  const remindersToCancel =
    operations.cancelReminders && mutationEnabled
      ? dueReminderIds.slice(0, Math.min(dueReminderIds.length, reminderLimit ?? 0))
      : dueReminderIds

  if (dueReminderIds.length === 0) {
    console.log('✅ No pending/queued reminders found')
  } else if (!operations.cancelReminders) {
    console.log('Skipping reminder cancellation (not requested).')
  } else {
    console.log(`Found ${dueReminderIds.length} pending/queued reminder(s)`)
    console.log(`\n${mutationEnabled ? 'Cancelling' : 'Would cancel'} ${remindersToCancel.length}/${dueReminderIds.length} reminder(s)...`)

    const sample = remindersToCancel.slice(0, 10)
    if (sample.length > 0) {
      console.log('Sample reminder IDs:')
      sample.forEach((id) => console.log(`  - ${id}`))
      if (remindersToCancel.length > sample.length) {
        console.log(`  ... and ${remindersToCancel.length - sample.length} more`)
      }
    }

    if (mutationEnabled) {
      if (remindersToCancel.length === 0) {
        console.log('No reminders selected for cancellation (limit is 0).')
      } else {
        const { data: cancelledReminderRows, error: cancelError } = await supabase
          .from('booking_reminders')
          .update({
            status: 'cancelled',
            error_message: reason,
            updated_at: nowIso
          })
          .in('id', remindersToCancel)
          .in('status', ['pending', 'queued'])
          .select('id')

        const { updatedCount: cancelledCount } = assertScriptMutationSucceeded({
          operation: 'Cancel pending/queued reminders',
          error: cancelError,
          updatedRows: cancelledReminderRows ?? [],
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Cancel pending/queued reminders',
          expected: remindersToCancel.length,
          actual: cancelledCount
        })

        console.log(`✅ Cancelled ${cancelledCount} pending/queued reminder(s)`)
      }
    } else {
      console.log('\nDry-run mode: no reminder rows updated.')
    }
  }

  // Cancel any reminder-processing jobs still sitting in the queue
  const { data: reminderJobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id, status, created_at')
    .eq('type', 'process_event_reminder')
    .in('status', ['pending', 'processing'])

  const reminderJobRows = (assertScriptQuerySucceeded({
    operation: 'Load reminder processing jobs',
    error: jobsError,
    data: reminderJobs ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string }>

  const reminderJobIds = extractUniqueRowIds({
    operation: 'Load reminder processing jobs',
    rows: reminderJobRows
  })

  const jobsToCancel =
    operations.cancelJobs && mutationEnabled
      ? reminderJobIds.slice(0, Math.min(reminderJobIds.length, jobLimit ?? 0))
      : reminderJobIds

  if (reminderJobIds.length === 0) {
    console.log('✅ No reminder jobs to cancel')
  } else if (!operations.cancelJobs) {
    console.log('Skipping reminder-job cancellation (not requested).')
  } else {
    console.log(`Found ${reminderJobIds.length} reminder processing job(s) (pending/processing)`)
    console.log(`\n${mutationEnabled ? 'Cancelling' : 'Would cancel'} ${jobsToCancel.length}/${reminderJobIds.length} job(s)...`)

    const sample = jobsToCancel.slice(0, 10)
    if (sample.length > 0) {
      console.log('Sample job IDs:')
      sample.forEach((id) => console.log(`  - ${id}`))
      if (jobsToCancel.length > sample.length) {
        console.log(`  ... and ${jobsToCancel.length - sample.length} more`)
      }
    }

    if (mutationEnabled) {
      if (jobsToCancel.length === 0) {
        console.log('No jobs selected for cancellation (limit is 0).')
      } else {
        const { data: cancelledJobRows, error: cancelJobsError } = await supabase
          .from('jobs')
          .update({
            status: 'cancelled',
            error_message: reason,
            updated_at: nowIso
          })
          .in('id', jobsToCancel)
          .eq('type', 'process_event_reminder')
          .in('status', ['pending', 'processing'])
          .select('id')

        const { updatedCount: cancelledJobCount } = assertScriptMutationSucceeded({
          operation: 'Cancel reminder processing jobs',
          error: cancelJobsError,
          updatedRows: cancelledJobRows ?? [],
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Cancel reminder processing jobs',
          expected: jobsToCancel.length,
          actual: cancelledJobCount
        })

        console.log(`✅ Cancelled ${cancelledJobCount} reminder job(s) (pending/processing)`)
      }
    } else {
      console.log('\nDry-run mode: no job rows updated.')
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log(`✅ ${mutationEnabled ? 'BACKLOG CLEAR COMPLETE' : 'DRY-RUN COMPLETE'}!`)
  if (!mutationEnabled) {
    console.log('No mutations performed (dry-run).')
    console.log(
      'To mutate, pass --confirm + operation flags + limits, and set RUN_CLEAR_REMINDER_BACKLOG_MUTATION=true and ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION=true.'
    )
  }
  console.log('='.repeat(50))
}

main().catch(error => {
  console.error('❌ Backlog clear failed:', error)
  process.exitCode = 1
})
