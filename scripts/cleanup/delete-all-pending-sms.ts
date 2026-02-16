#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin';
import {
  assertDeleteAllPendingSmsCompletedWithoutFailures,
  assertDeleteAllPendingSmsMutationAllowed,
  assertDeleteAllPendingSmsUpdateSucceeded,
  resolveDeleteAllPendingSmsCount
} from '../../src/lib/pending-sms-cleanup-safety';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function parseOptionalPositiveInt(raw: string | null | undefined): number | null {
  if (!raw) return null

  const normalized = raw.trim()
  if (normalized.length === 0) return null
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error('delete-all-pending-sms blocked: --limit must be a positive integer.')
  }

  const parsed = Number(normalized)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('delete-all-pending-sms blocked: --limit must be a positive integer.')
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

async function deleteAllPendingSMS() {
  const argv = process.argv.slice(2)
  const hasConfirmFlag = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const limit = parseOptionalPositiveInt(
    readArgValue(argv, '--limit') ?? process.env.DELETE_ALL_PENDING_SMS_LIMIT
  )
  const HARD_CAP = 500

  const mutationEnabled =
    !dryRunOverride && hasConfirmFlag && isTruthyEnv(process.env.RUN_DELETE_ALL_PENDING_SMS_MUTATION)

  if (hasConfirmFlag && !mutationEnabled && !dryRunOverride) {
    throw new Error(
      'delete-all-pending-sms blocked: --confirm requires RUN_DELETE_ALL_PENDING_SMS_MUTATION=true.'
    )
  }

  if (!mutationEnabled) {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `DRY RUN${extra}: no pending SMS jobs will be cancelled. Re-run with --confirm RUN_DELETE_ALL_PENDING_SMS_MUTATION=true ALLOW_DELETE_ALL_PENDING_SMS_SCRIPT=true --limit=<n> to cancel pending SMS jobs.`
    )
  } else {
    assertDeleteAllPendingSmsMutationAllowed()
    if (!limit) {
      throw new Error(
        'delete-all-pending-sms blocked: mutations require an explicit cap via --limit=<n> (or DELETE_ALL_PENDING_SMS_LIMIT).'
      )
    }
    if (limit > HARD_CAP) {
      throw new Error(
        `delete-all-pending-sms blocked: --limit ${limit} exceeds hard cap ${HARD_CAP}. Run in smaller batches.`
      )
    }
  }

  console.log(`🗑️  Pending SMS cancellation (${mutationEnabled ? 'MUTATION' : 'DRY RUN'})...\n`)

  const supabase = createAdminClient()

  // Get count of pending SMS jobs first
  const { count, error: pendingCountError } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'send_sms')
    .eq('status', 'pending')

  const pendingCount = resolveDeleteAllPendingSmsCount({
    count: count ?? 0,
    error: pendingCountError
  });
    
  if (pendingCount === 0) {
    console.log('✅ No pending SMS jobs found.')
    return
  }
  
  console.log(`Found ${pendingCount} pending send_sms job(s).`)

  if (!mutationEnabled) {
    console.log('Dry-run complete. No job rows updated.')
    return
  }

  const selectedCount = Math.min(pendingCount, limit ?? 0)
  if (selectedCount <= 0) {
    throw new Error('delete-all-pending-sms blocked: --limit must be a positive integer.')
  }

  const { data: pendingRows, error: pendingRowsError } = await supabase
    .from('jobs')
    .select('id')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(selectedCount)

  if (pendingRowsError) {
    throw new Error(pendingRowsError.message || 'Failed to load pending SMS jobs for cancellation')
  }

  const pendingJobIds = (pendingRows ?? [])
    .map((row) => (row as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (pendingJobIds.length !== selectedCount) {
    throw new Error(
      `Failed to resolve pending jobs to cancel (expected ${selectedCount}, got ${pendingJobIds.length})`
    )
  }

  console.log(`Cancelling ${selectedCount}/${pendingCount} pending send_sms job(s) (cap=${limit}, hard cap=${HARD_CAP})...`)
  
  // Cancel all pending SMS jobs
  const { data: cancelledJobs, error: cancellationError } = await supabase
    .from('jobs')
    .update({ 
      status: 'cancelled',
      error_message: 'Manually cancelled - messages for past event',
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .in('id', pendingJobIds)
    .select('id')

  const { updatedCount } = assertDeleteAllPendingSmsUpdateSucceeded({
    error: cancellationError,
    updatedRows: cancelledJobs as Array<{ id?: string }> | null,
    expectedCount: selectedCount
  });

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      user_id: 'system-script',
      user_email: 'script@system',
      operation_type: 'update',
      resource_type: 'jobs',
      operation_status: 'success',
      details: {
        reason: 'Bulk cancellation of pending SMS jobs',
        script: 'delete-all-pending-sms.ts',
        pending_count: pendingCount,
        cancel_cap: limit,
        cancelled_count: updatedCount,
        cancelled_job_ids: pendingJobIds
      }
    });

  assertDeleteAllPendingSmsCompletedWithoutFailures({
    failureCount: auditError ? 1 : 0,
    failures: auditError
      ? [`audit_log_insert_failed:${auditError.message || 'unknown database error'}`]
      : []
  });

  console.log(`✅ Successfully cancelled ${updatedCount} pending SMS job(s).`)
  console.log('   These messages will not be sent.')
}

// Run the deletion
void deleteAllPendingSMS().catch((error) => {
  markFailure('delete-all-pending-sms failed.', error)
})
