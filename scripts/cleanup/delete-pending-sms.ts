#!/usr/bin/env tsx

/**
 * Cancel pending send_sms jobs safely.
 *
 * Safety note:
 * - Dry-run by default.
 * - Mutations require: --confirm + RUN_DELETE_PENDING_SMS_MUTATION=true + ALLOW_DELETE_PENDING_SMS_SCRIPT=true
 * - Mutations require explicit caps: --limit=<n>
 * - Choose mutation scope:
 *   - --all (cancel oldest pending jobs up to limit)
 *   - --job-ids=<id1,id2,...> (cancel specific jobs; count must be <= limit)
 */

import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertDeletePendingSmsAuditPersisted,
  assertDeletePendingSmsMutationAllowed,
  assertDeletePendingSmsUpdateSucceeded,
  resolvePendingSmsJobsForDelete,
  type PendingSmsJobForDelete
} from '../../src/lib/pending-sms-delete-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function parseOptionalPositiveInt(
  raw: string | null | undefined,
  label: '--limit' | 'DELETE_PENDING_SMS_LIMIT'
): number | null {
  if (raw == null || raw === '') return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`delete-pending-sms blocked: ${label} must be a positive integer.`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`delete-pending-sms blocked: ${label} must be a positive integer.`)
  }

  return parsed
}

function readArgValue(argv: string[], flag: string): string | null {
  const idx = argv.findIndex((arg) => arg === flag)
  if (idx !== -1) {
    const value = argv[idx + 1]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    const [, value] = eq.split('=', 2)
    return value && value.trim().length > 0 ? value.trim() : null
  }

  return null
}

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function formatRecipient(job: PendingSmsJobForDelete): string {
  if (!job.payload || typeof job.payload !== 'object') {
    return 'unknown'
  }

  const recipient = (job.payload as { to?: unknown }).to
  return typeof recipient === 'string' && recipient.length > 0 ? recipient : 'unknown'
}

function parseJobIds(raw: string | null): string[] {
  if (!raw) return []
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((id) => id.length > 0)
    )
  )
}

async function insertAuditLog(params: {
  supabase: any
  operation: 'cancel_all_pending_jobs' | 'cancel_selected_pending_jobs'
  cancelledJobIds: string[]
  pendingJobCount: number
  cancelCap: number
}): Promise<void> {
  const { data: insertedRows, error: auditError } = await params.supabase
    .from('audit_logs')
    .insert({
      user_id: 'system-script',
      user_email: 'script@system',
      operation_type: 'update',
      resource_type: 'jobs',
      operation_status: 'success',
      details: {
        script: 'delete-pending-sms.ts',
        operation: params.operation,
        pending_job_count_at_start: params.pendingJobCount,
        cancel_cap: params.cancelCap,
        cancelled_job_count: params.cancelledJobIds.length,
        cancelled_job_ids: params.cancelledJobIds
      }
    })
    .select('id')

  assertDeletePendingSmsAuditPersisted({
    error: auditError,
    insertedRows
  })
}

async function cancelPendingSmsJobs(params: {
  supabase: any
  jobIds: string[]
  expectedCount: number
}): Promise<number> {
  const now = new Date().toISOString()
  const { data: updatedRows, error: updateError } = await params.supabase
    .from('jobs')
    .update({
      status: 'cancelled',
      error_message: 'Manually cancelled by script',
      failed_at: now,
      updated_at: now
    })
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .in('id', params.jobIds)
    .select('id')

  const { updatedCount } = assertDeletePendingSmsUpdateSucceeded({
    error: updateError,
    updatedRows,
    expectedCount: params.expectedCount
  })

  return updatedCount
}

async function deletePendingSMS(): Promise<void> {
  const argv = process.argv.slice(2)
  const hasConfirmFlag = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const cancelAll = argv.includes('--all')
  const jobIdsArg = readArgValue(argv, '--job-ids')

  const limit =
    parseOptionalPositiveInt(readArgValue(argv, '--limit'), '--limit') ??
    parseOptionalPositiveInt(process.env.DELETE_PENDING_SMS_LIMIT, 'DELETE_PENDING_SMS_LIMIT')
  const HARD_CAP = 500

  const mutationEnabled =
    !dryRunOverride && hasConfirmFlag && isTruthyEnv(process.env.RUN_DELETE_PENDING_SMS_MUTATION)

  if (hasConfirmFlag && !mutationEnabled && !dryRunOverride) {
    throw new Error('delete-pending-sms blocked: --confirm requires RUN_DELETE_PENDING_SMS_MUTATION=true.')
  }

  if (!mutationEnabled) {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `DRY RUN${extra}: no pending jobs will be cancelled. Re-run with --confirm RUN_DELETE_PENDING_SMS_MUTATION=true ALLOW_DELETE_PENDING_SMS_SCRIPT=true --all --limit=<n> to cancel pending jobs.`
    )
  } else {
    assertDeletePendingSmsMutationAllowed()

    if (!limit) {
      throw new Error(
        'delete-pending-sms blocked: mutations require an explicit cap via --limit=<n> (or DELETE_PENDING_SMS_LIMIT).'
      )
    }
    if (limit > HARD_CAP) {
      throw new Error(
        `delete-pending-sms blocked: --limit ${limit} exceeds hard cap ${HARD_CAP}. Run in smaller batches.`
      )
    }

    const hasScope = cancelAll || typeof jobIdsArg === 'string'
    if (!hasScope) {
      throw new Error('delete-pending-sms blocked: choose --all or --job-ids=<...> when running with --confirm.')
    }
  }

  console.log(`\n🗑️  CANCEL PENDING SMS JOBS (${mutationEnabled ? 'MUTATION' : 'DRY RUN'})\n`)

  const supabase = createAdminClient()

  const { count: pendingCount, error: pendingCountError } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'send_sms')
    .eq('status', 'pending')

  if (pendingCountError) {
    throw new Error(pendingCountError.message || 'Failed to count pending send_sms jobs')
  }

  const totalPending = Math.max(0, pendingCount ?? 0)
  console.log(`Pending send_sms jobs: ${totalPending}`)

  const { data: pendingJobs, error: pendingJobsError } = await supabase
    .from('jobs')
    .select('id, payload, created_at')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20)

  const jobs = resolvePendingSmsJobsForDelete({
    jobs: pendingJobs,
    error: pendingJobsError
  })

  if (jobs.length === 0) {
    console.log('✅ No pending SMS jobs to cancel.')
    return
  }

  console.log('\nSample pending jobs (oldest first, up to 20):')
  jobs.forEach((job, index) => {
    const createdAt = job.created_at ? new Date(job.created_at).toLocaleString() : 'unknown'
    console.log(`${index + 1}. ${job.id} - To: ${formatRecipient(job)} - Created: ${createdAt}`)
  })

  if (!mutationEnabled) {
    console.log('\nDry-run complete. No jobs cancelled.')
    return
  }

  const cap = limit ?? 0
  const selectedJobIds: string[] = []

  if (jobIdsArg) {
    const parsedIds = parseJobIds(jobIdsArg)
    if (parsedIds.length === 0) {
      throw new Error('delete-pending-sms blocked: --job-ids was provided but no valid ids were parsed.')
    }
    if (parsedIds.length > cap) {
      throw new Error(
        `delete-pending-sms blocked: --job-ids includes ${parsedIds.length} ids, exceeding cap ${cap}.`
      )
    }
    selectedJobIds.push(...parsedIds)
  } else if (cancelAll) {
    const selectCount = Math.min(totalPending, cap)
    if (selectCount <= 0) {
      throw new Error('delete-pending-sms blocked: --limit must be a positive integer.')
    }

    const { data: idRows, error: idRowsError } = await supabase
      .from('jobs')
      .select('id')
      .eq('type', 'send_sms')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(selectCount)

    if (idRowsError) {
      throw new Error(idRowsError.message || 'Failed to load pending job ids for cancellation')
    }

    const ids = (idRows ?? [])
      .map((row) => (row as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    if (ids.length !== selectCount) {
      throw new Error(
        `Failed to resolve pending job ids for cancellation (expected ${selectCount}, got ${ids.length})`
      )
    }

    selectedJobIds.push(...ids)
  }

  const cancelledCount = await cancelPendingSmsJobs({
    supabase,
    jobIds: selectedJobIds,
    expectedCount: selectedJobIds.length
  })

  await insertAuditLog({
    supabase,
    operation: jobIdsArg ? 'cancel_selected_pending_jobs' : 'cancel_all_pending_jobs',
    cancelledJobIds: selectedJobIds,
    pendingJobCount: totalPending,
    cancelCap: cap
  })

  console.log(`✅ Successfully cancelled ${cancelledCount} pending send_sms job(s).`)
}

void deletePendingSMS().catch((error) => {
  markFailure('delete-pending-sms failed.', error)
})
