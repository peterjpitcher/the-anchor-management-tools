import * as dotenv from 'dotenv'
import { resolve } from 'path'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertNoInvalidStuckJobTimings,
  selectStaleProcessingJobIds
} from '../../src/lib/stuck-jobs-cleanup-safety'
import {
  assertClearStuckJobsMutationAllowed,
  assertClearStuckJobsPendingSmsJobLimit,
  assertClearStuckJobsRunEnabled,
  assertClearStuckJobsStaleLimit,
  readClearStuckJobsPendingSmsJobLimit,
  readClearStuckJobsStaleLimit,
  resolveClearStuckJobsOperations
} from '../../src/lib/clear-stuck-jobs-script-safety'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function clearStuckJobs() {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const HARD_CAP = 500

  if (argv.includes('--help')) {
    console.log(`
clear-stuck-jobs (safe by default)

Dry-run (default):
  tsx scripts/sms-tools/clear-stuck-jobs.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_CLEAR_STUCK_JOBS_MUTATION=true ALLOW_CLEAR_STUCK_JOBS_MUTATION=true \\
    tsx scripts/sms-tools/clear-stuck-jobs.ts --confirm \\
      --fail-stale-processing --stale-limit 50 \\
      --delete-pending-sms-jobs --pending-limit 50

Notes:
  - Limits can also be supplied via CLEAR_STUCK_JOBS_STALE_LIMIT and CLEAR_STUCK_JOBS_PENDING_LIMIT.
`)
    return
  }

  const operations = resolveClearStuckJobsOperations(argv)
  const staleLimit = readClearStuckJobsStaleLimit(argv)
  const pendingLimit = readClearStuckJobsPendingSmsJobLimit(argv)

  const mutationEnabled = confirm
  if (mutationEnabled) {
    assertClearStuckJobsRunEnabled()
    assertClearStuckJobsMutationAllowed()

    if (operations.failStaleProcessing) {
      assertClearStuckJobsStaleLimit(staleLimit ?? 0, HARD_CAP)
    }
    if (operations.deletePendingSmsJobs) {
      assertClearStuckJobsPendingSmsJobLimit(pendingLimit ?? 0, HARD_CAP)
    }
  }

  console.log(`🔧 Clearing stuck jobs (${mutationEnabled ? 'MUTATION' : 'DRY-RUN'})...\n`)
  
  const supabase = createAdminClient()
  
  // Find stuck processing jobs (running for more than 60 seconds)
  const { data: processingJobs, error: processingJobsError } = await supabase
    .from('jobs')
    .select('id, type, started_at, created_at')
    .eq('status', 'processing')

  const processingRows = (assertScriptQuerySucceeded({
    operation: 'Load processing jobs',
    error: processingJobsError,
    data: processingJobs ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    type: string | null
    started_at: string | null
    created_at: string | null
  }>
  
  if (processingRows.length === 0) {
    console.log('✅ No stuck jobs found')
  } else {
    console.log(`Found ${processingRows.length} jobs in processing state:\n`)
  }

  const nowMs = Date.now()
  for (const job of processingRows) {
    const startedAtMs = job.started_at ? Date.parse(job.started_at) : Number.NaN
    const createdAtMs = job.created_at ? Date.parse(job.created_at) : Number.NaN
    const referenceMs = Number.isFinite(startedAtMs) ? startedAtMs : createdAtMs
    const runningForSeconds = Number.isFinite(referenceMs)
      ? Math.floor((nowMs - referenceMs) / 1000)
      : null

    console.log(`Job ID: ${job.id}`)
    console.log(`Type: ${job.type || 'unknown'}`)
    console.log(`Running for: ${runningForSeconds === null ? 'unknown' : `${runningForSeconds} seconds`}`)
    console.log('---')
  }

  const { staleJobIds, invalidTimingJobIds } = selectStaleProcessingJobIds({
    jobs: processingRows,
    nowMs
  })
  assertNoInvalidStuckJobTimings(invalidTimingJobIds)

  if (staleJobIds.length === 0) {
    console.log('✅ No stale processing jobs found')
  } else if (!operations.failStaleProcessing) {
    console.log('Skipping stale-job failure (not requested).')
  } else {
    const staleJobIdsToFail =
      mutationEnabled
        ? staleJobIds.slice(0, Math.min(staleJobIds.length, staleLimit ?? 0))
        : staleJobIds

    console.log(`\n${mutationEnabled ? 'Failing' : 'Would fail'} ${staleJobIdsToFail.length}/${staleJobIds.length} stale processing job(s)...`)
    const sample = staleJobIdsToFail.slice(0, 10)
    if (sample.length > 0) {
      console.log('Sample job IDs:')
      sample.forEach((id) => console.log(`  - ${id}`))
      if (staleJobIdsToFail.length > sample.length) {
        console.log(`  ... and ${staleJobIdsToFail.length - sample.length} more`)
      }
    }

    if (mutationEnabled) {
      if (staleJobIdsToFail.length === 0) {
        console.log('No stale jobs selected for failure (limit is 0).')
      } else {
        const { data: resetRows, error: resetError } = await supabase
          .from('jobs')
          .update({
            status: 'failed',
            error_message: 'Job timed out - stuck in processing for too long',
            completed_at: new Date().toISOString()
          })
          .in('id', staleJobIdsToFail)
          .eq('status', 'processing')
          .select('id')

        const { updatedCount: resetCount } = assertScriptMutationSucceeded({
          operation: 'Fail stale processing jobs',
          error: resetError,
          updatedRows: resetRows ?? [],
          allowZeroRows: false
        })
        assertScriptExpectedRowCount({
          operation: 'Fail stale processing jobs',
          expected: staleJobIdsToFail.length,
          actual: resetCount
        })

        console.log(`✅ Successfully failed ${resetCount} stale job(s)`)
      }
    } else {
      console.log('\nDry-run mode: no job rows updated.')
    }
  }
  
  // Also check for any orphaned pending SMS jobs that might be problematic
  console.log('\n📱 Checking for problematic SMS jobs...')
  
  const { data: smsJobs, error: smsError } = await supabase
    .from('jobs')
    .select('id, type')
    .eq('status', 'pending')
    .in('type', ['send_sms', 'send_bulk_sms'])

  const pendingSmsJobs = (assertScriptQuerySucceeded({
    operation: 'Load pending SMS jobs',
    error: smsError,
    data: smsJobs ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; type: string }>

  if (pendingSmsJobs.length === 0) {
    console.log('✅ No pending SMS jobs found')
  } else if (!operations.deletePendingSmsJobs) {
    console.log('Skipping pending SMS job deletion (not requested).')
  } else {
    const pendingSmsJobIds = pendingSmsJobs.map((job) => job.id)
    const pendingSmsJobIdsToDelete =
      mutationEnabled
        ? pendingSmsJobIds.slice(0, Math.min(pendingSmsJobIds.length, pendingLimit ?? 0))
        : pendingSmsJobIds

    console.log(
      `\n${mutationEnabled ? 'Deleting' : 'Would delete'} ${pendingSmsJobIdsToDelete.length}/${pendingSmsJobIds.length} pending SMS job(s)...`
    )

    const sample = pendingSmsJobIdsToDelete.slice(0, 10)
    if (sample.length > 0) {
      console.log('Sample job IDs:')
      sample.forEach((id) => console.log(`  - ${id}`))
      if (pendingSmsJobIdsToDelete.length > sample.length) {
        console.log(`  ... and ${pendingSmsJobIdsToDelete.length - sample.length} more`)
      }
    }

    if (mutationEnabled) {
      if (pendingSmsJobIdsToDelete.length === 0) {
        console.log('No pending SMS jobs selected for deletion (limit is 0).')
      } else {
        const { data: deletedRows, error: deleteError } = await supabase
          .from('jobs')
          .delete()
          .in('id', pendingSmsJobIdsToDelete)
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
          expected: pendingSmsJobIdsToDelete.length,
          actual: deletedCount
        })

        console.log(`✅ Successfully deleted ${deletedCount} pending SMS job(s)`)
      }
    } else {
      console.log('\nDry-run mode: no jobs deleted.')
    }
  }
  
  console.log('\n' + '='.repeat(50))
  console.log(`✅ ${mutationEnabled ? 'CLEANUP COMPLETE' : 'DRY-RUN COMPLETE'}!`)
  if (!mutationEnabled) {
    console.log('No mutations performed (dry-run).')
    console.log(
      'To mutate, pass --confirm + operation flags + limits, and set RUN_CLEAR_STUCK_JOBS_MUTATION=true and ALLOW_CLEAR_STUCK_JOBS_MUTATION=true.'
    )
  }
  console.log('='.repeat(50))
}

clearStuckJobs().catch((error) => {
  console.error('clear-stuck-jobs script failed:', error)
  process.exitCode = 1
})
