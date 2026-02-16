#!/usr/bin/env tsx

/**
 * Cleanup stale stuck outbound SMS messages (and optionally stale SMS jobs).
 *
 * Safety note:
 * - Dry-run by default.
 * - Mutations require: --confirm + RUN_DELETE_OLD_SMS_MESSAGES_MUTATION=true + ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT=true
 * - Mutations require explicit caps: --limit=<n> (and optionally --delete-jobs --jobs-limit=<n>).
 */

import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertOldSmsCleanupCompletedWithoutFailures,
  assertOldSmsCleanupDeletionSucceeded,
  assertOldSmsCleanupMutationAllowed,
  assertOldSmsCleanupQuerySucceeded,
  selectOldStuckSmsMessages,
} from '../../src/lib/old-sms-cleanup-safety'

type StuckMessageRow = {
  id: string
  body: string
  status: string
  created_at: string
  to_number?: string | null
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const STATUS_DIVIDER = '='.repeat(60)
const SAMPLE_DIVIDER = '-'.repeat(60)
const STUCK_MESSAGE_STATUSES = ['queued', 'pending', 'sending'] as const

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function parseOptionalPositiveInt(raw: string | null | undefined, label: string): number | null {
  if (!raw) return null

  const normalized = raw.trim()
  if (normalized.length === 0) return null
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`delete-old-sms-messages blocked: ${label} must be a positive integer.`)
  }

  const parsed = Number(normalized)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`delete-old-sms-messages blocked: ${label} must be a positive integer.`)
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

function formatMessageDate(createdAt: string): string {
  const parsed = new Date(createdAt)
  if (Number.isNaN(parsed.getTime())) {
    return 'unknown'
  }
  return parsed.toLocaleDateString('en-GB')
}

function assertCountQuerySucceeded(params: {
  operation: string
  count: number | null
  error: { message?: string } | null
}): number {
  if (params.error) {
    throw new Error(`${params.operation} failed: ${params.error.message || 'unknown database error'}`)
  }
  return Math.max(0, params.count ?? 0)
}

async function deleteOldSmsMessages(): Promise<void> {
  const argv = process.argv.slice(2)
  const hasConfirmFlag = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const deleteJobsRequested = argv.includes('--delete-jobs')

  const minAgeDays =
    parseOptionalPositiveInt(
      readArgValue(argv, '--min-age-days') ?? process.env.DELETE_OLD_SMS_MESSAGES_MIN_AGE_DAYS,
      '--min-age-days'
    ) ??
    7
  const limit = parseOptionalPositiveInt(
    readArgValue(argv, '--limit') ?? process.env.DELETE_OLD_SMS_MESSAGES_LIMIT,
    '--limit'
  )
  const jobsLimit = parseOptionalPositiveInt(
    readArgValue(argv, '--jobs-limit') ?? process.env.DELETE_OLD_SMS_MESSAGES_JOBS_LIMIT,
    '--jobs-limit'
  )

  const HARD_CAP_MESSAGES = 1000
  const HARD_CAP_JOBS = 1000

  const mutationEnabled =
    !dryRunOverride && hasConfirmFlag && isTruthyEnv(process.env.RUN_DELETE_OLD_SMS_MESSAGES_MUTATION)

  if (hasConfirmFlag && !mutationEnabled && !dryRunOverride) {
    throw new Error(
      'delete-old-sms-messages blocked: --confirm requires RUN_DELETE_OLD_SMS_MESSAGES_MUTATION=true.'
    )
  }

  if (!mutationEnabled) {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `DRY RUN${extra}: no messages will be deleted. Re-run with --confirm RUN_DELETE_OLD_SMS_MESSAGES_MUTATION=true ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT=true --limit=<n> to delete stale stuck messages.`
    )
  } else {
    assertOldSmsCleanupMutationAllowed()

    if (!limit) {
      throw new Error(
        'delete-old-sms-messages blocked: mutations require an explicit cap via --limit=<n> (or DELETE_OLD_SMS_MESSAGES_LIMIT).'
      )
    }
    if (limit > HARD_CAP_MESSAGES) {
      throw new Error(
        `delete-old-sms-messages blocked: --limit ${limit} exceeds hard cap ${HARD_CAP_MESSAGES}. Run in smaller batches.`
      )
    }

    if (deleteJobsRequested) {
      if (!jobsLimit) {
        throw new Error(
          'delete-old-sms-messages blocked: --delete-jobs requires --jobs-limit=<n> (or DELETE_OLD_SMS_MESSAGES_JOBS_LIMIT).'
        )
      }
      if (jobsLimit > HARD_CAP_JOBS) {
        throw new Error(
          `delete-old-sms-messages blocked: --jobs-limit ${jobsLimit} exceeds hard cap ${HARD_CAP_JOBS}. Run in smaller batches.`
        )
      }
    }
  }

  if (minAgeDays < 1 || minAgeDays > 365) {
    throw new Error(`Invalid --min-age-days ${minAgeDays}. Provide an integer between 1 and 365.`)
  }

  console.log(`\n🗑️  STALE SMS CLEANUP (${mutationEnabled ? 'MUTATION' : 'DRY RUN'})\n`)
  console.log(STATUS_DIVIDER)

  const supabase = createAdminClient()
  const now = Date.now()
  const thresholdIso = new Date(now - minAgeDays * 24 * 60 * 60 * 1000).toISOString()

  const { count: stuckCount, error: stuckCountError } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('status', [...STUCK_MESSAGE_STATUSES])
    .eq('direction', 'outbound')

  const totalStuck = assertCountQuerySucceeded({
    operation: 'Count stuck outbound messages',
    count: stuckCount,
    error: stuckCountError
  })

  const { count: staleCount, error: staleCountError } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('status', [...STUCK_MESSAGE_STATUSES])
    .eq('direction', 'outbound')
    .lt('created_at', thresholdIso)

  const totalStale = assertCountQuerySucceeded({
    operation: 'Count stale stuck outbound messages',
    count: staleCount,
    error: staleCountError
  })

  console.log(`Stuck outbound messages (status=${STUCK_MESSAGE_STATUSES.join(',')}): ${totalStuck}`)
  console.log(`Stale stuck messages (created_at < ${thresholdIso}; minAgeDays=${minAgeDays}): ${totalStale}`)

  const { data: sampleRows, error: sampleError } = await supabase
    .from('messages')
    .select('id, body, status, created_at, to_number')
    .in('status', [...STUCK_MESSAGE_STATUSES])
    .eq('direction', 'outbound')
    .lt('created_at', thresholdIso)
    .order('created_at', { ascending: true })
    .limit(5)

  const sample = assertOldSmsCleanupQuerySucceeded({
    operation: 'Load stale stuck outbound SMS messages (sample)',
    error: sampleError,
    data: sampleRows ?? [],
    allowMissing: true
  }) as StuckMessageRow[]

  if (sample.length > 0) {
    console.log('\n📋 SAMPLE STALE MESSAGES (oldest first, up to 5):')
    console.log(SAMPLE_DIVIDER)
    sample.forEach((msg, index) => {
      console.log(`${index + 1}. Created: ${formatMessageDate(msg.created_at)}`)
      console.log(`   Status: ${msg.status}`)
      console.log(`   To: ${msg.to_number || 'unknown'}`)
      console.log(`   Message: ${msg.body?.substring(0, 80) || '<empty>'}...`)
    })
  }

  if (!mutationEnabled) {
    console.log(`\n${STATUS_DIVIDER}`)
    console.log('Dry-run complete. No rows deleted.')
    console.log(`${STATUS_DIVIDER}`)
    return
  }

  const deleteMessageCount = Math.min(totalStale, limit ?? 0)
  if (deleteMessageCount <= 0) {
    throw new Error('delete-old-sms-messages blocked: --limit must be a positive integer.')
  }

  console.log(`\nDeleting ${deleteMessageCount}/${totalStale} stale stuck message(s) (cap=${limit})...`)

  const { data: staleIdRows, error: staleIdError } = await supabase
    .from('messages')
    .select('id, created_at')
    .in('status', [...STUCK_MESSAGE_STATUSES])
    .eq('direction', 'outbound')
    .lt('created_at', thresholdIso)
    .order('created_at', { ascending: true })
    .limit(deleteMessageCount)

  const staleRows = assertOldSmsCleanupQuerySucceeded({
    operation: 'Load stale stuck outbound SMS ids for deletion',
    error: staleIdError,
    data: staleIdRows ?? [],
    allowMissing: true
  }) as Array<{ id: string; created_at: string }>

  const safeDeleteCandidates = selectOldStuckSmsMessages({
    messages: staleRows.map((row) => ({ id: row.id, created_at: row.created_at })),
    nowMs: now,
    minAgeDays,
  })
  const messageIdsToDelete = safeDeleteCandidates.map((row) => row.id)

  if (messageIdsToDelete.length !== deleteMessageCount) {
    throw new Error(
      `Failed to resolve stale message ids for deletion (expected ${deleteMessageCount}, got ${messageIdsToDelete.length})`
    )
  }

  const { data: deletedMessages, error: deleteError } = await supabase
    .from('messages')
    .delete()
    .in('id', messageIdsToDelete)
    .select('id')

  assertOldSmsCleanupDeletionSucceeded({
    operation: 'Delete stale stuck outbound SMS messages',
    error: deleteError,
    deletedRows: deletedMessages as Array<{ id?: string }> | null,
    expectedCount: messageIdsToDelete.length
  })

  console.log(`✅ Deleted ${messageIdsToDelete.length} stale stuck message(s)`)

  let deletedJobIds: string[] = []
  if (deleteJobsRequested) {
    const { count: jobCount, error: jobCountError } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'send_sms')
      .in('status', ['pending', 'failed', 'cancelled'])
      .lt('created_at', thresholdIso)

    const totalJobs = assertCountQuerySucceeded({
      operation: 'Count stale send_sms jobs eligible for deletion',
      count: jobCount,
      error: jobCountError
    })

    const deleteJobCount = Math.min(totalJobs, jobsLimit ?? 0)
    if (deleteJobCount <= 0) {
      throw new Error('delete-old-sms-messages blocked: --delete-jobs requires --jobs-limit to be a positive integer.')
    }

    console.log(`\nDeleting ${deleteJobCount}/${totalJobs} stale send_sms job(s) (cap=${jobsLimit})...`)

    const { data: jobIdRows, error: jobIdError } = await supabase
      .from('jobs')
      .select('id')
      .eq('type', 'send_sms')
      .in('status', ['pending', 'failed', 'cancelled'])
      .lt('created_at', thresholdIso)
      .order('created_at', { ascending: true })
      .limit(deleteJobCount)

    const jobRows = assertOldSmsCleanupQuerySucceeded({
      operation: 'Load stale send_sms job ids for deletion',
      error: jobIdError,
      data: jobIdRows ?? [],
      allowMissing: true
    }) as Array<{ id: string }>

    deletedJobIds = jobRows.map((row) => row.id).filter((id) => typeof id === 'string' && id.length > 0)
    if (deletedJobIds.length !== deleteJobCount) {
      throw new Error(
        `Failed to resolve stale job ids for deletion (expected ${deleteJobCount}, got ${deletedJobIds.length})`
      )
    }

    const { data: deletedJobs, error: jobDeleteError } = await supabase
      .from('jobs')
      .delete()
      .in('id', deletedJobIds)
      .select('id')

    assertOldSmsCleanupDeletionSucceeded({
      operation: 'Delete stale send_sms jobs',
      error: jobDeleteError,
      deletedRows: deletedJobs as Array<{ id?: string }> | null,
      expectedCount: deletedJobIds.length
    })

    console.log(`✅ Deleted ${deletedJobIds.length} stale send_sms job(s)`)
  }

  const { error: auditLogError } = await supabase
    .from('audit_logs')
    .insert({
      user_id: 'system-script',
      user_email: 'script@system',
      operation_type: 'delete',
      resource_type: 'messages',
      operation_status: 'success',
      details: {
        reason: 'Cleanup of stale stuck outbound SMS messages',
        script: 'delete-old-sms-messages.ts',
        min_age_days: minAgeDays,
        threshold_iso: thresholdIso,
        messages_deleted: messageIdsToDelete.length,
        jobs_deleted: deletedJobIds.length,
        message_limit: limit,
        jobs_limit: deleteJobsRequested ? jobsLimit : null,
        message_ids_deleted: messageIdsToDelete,
        job_ids_deleted: deletedJobIds
      }
    })

  assertOldSmsCleanupCompletedWithoutFailures({
    failureCount: auditLogError ? 1 : 0,
    failures: auditLogError ? [`audit_log_insert_failed:${auditLogError.message || 'unknown database error'}`] : []
  })

  console.log(`\n${STATUS_DIVIDER}`)
  console.log('✅ CLEANUP COMPLETE')
  console.log(STATUS_DIVIDER)
}

void deleteOldSmsMessages().catch((error) => {
  markFailure('delete-old-sms-messages failed.', error)
})
