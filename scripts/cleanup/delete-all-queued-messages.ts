#!/usr/bin/env tsx

/**
 * Clear queued/pending outbound SMS messages for safety during testing.
 *
 * Safety note:
 * - Dry-run by default.
 * - Mutations require: --confirm + RUN_DELETE_ALL_QUEUED_MESSAGES_MUTATION=true + ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT=true
 * - Mutations also require explicit caps: --limit=<n> (and optionally --delete-jobs --jobs-limit=<n>).
 */

import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertDeleteAllQueuedMessagesMutationAllowed,
  assertQueuedMessagesCleanupAuditPersisted,
  assertQueuedMessagesCleanupDeleteSucceeded,
  resolveQueuedMessagesCleanupRows
} from '../../src/lib/queued-messages-cleanup-safety'

type QueuedMessageRow = {
  id: string
  body: string | null
  status: string
  created_at: string
  to_number: string | null
}

type QueuedJobRow = {
  id: string
  type: string | null
  status: string | null
  created_at: string | null
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const STATUS_DIVIDER = '='.repeat(60)
const SAMPLE_DIVIDER = '-'.repeat(60)

const QUEUED_MESSAGE_STATUSES = ['queued', 'pending', 'sending', 'scheduled'] as const
const SEND_JOB_TYPES = ['send_sms', 'send_bulk_sms'] as const
const SEND_JOB_STATUSES = ['pending', 'processing'] as const

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function parseOptionalPositiveInt(
  raw: string | null | undefined,
  label:
    | '--limit'
    | '--jobs-limit'
    | 'DELETE_ALL_QUEUED_MESSAGES_LIMIT'
    | 'DELETE_ALL_QUEUED_MESSAGES_JOBS_LIMIT'
): number | null {
  if (raw == null || raw === '') return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`delete-all-queued-messages blocked: ${label} must be a positive integer.`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`delete-all-queued-messages blocked: ${label} must be a positive integer.`)
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

async function loadQueuedMessageCount(supabase: any): Promise<number> {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('status', [...QUEUED_MESSAGE_STATUSES])
    .eq('direction', 'outbound')

  return assertCountQuerySucceeded({
    operation: 'Count queued outbound messages',
    count,
    error
  })
}

async function loadQueuedMessageCountByStatus(supabase: any): Promise<Record<string, number>> {
  const breakdown: Record<string, number> = {}
  for (const status of QUEUED_MESSAGE_STATUSES) {
    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', status)
      .eq('direction', 'outbound')

    breakdown[status] = assertCountQuerySucceeded({
      operation: `Count queued outbound messages for status=${status}`,
      count,
      error
    })
  }
  return breakdown
}

async function loadSendJobCount(supabase: any): Promise<number> {
  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .in('type', [...SEND_JOB_TYPES])
    .in('status', [...SEND_JOB_STATUSES])

  return assertCountQuerySucceeded({
    operation: 'Count queued send jobs',
    count,
    error
  })
}

async function insertAuditLog(params: {
  supabase: any
  queuedMessagesDeleted: number
  queuedJobsDeleted: number
  statusBreakdown: Record<string, number>
  messageIdsDeleted: string[]
  jobIdsDeleted: string[]
  messageLimit: number
  jobsLimit: number | null
}): Promise<void> {
  const { data: insertedAuditRows, error: auditError } = await params.supabase
    .from('audit_logs')
    .insert({
      user_id: 'system-script',
      user_email: 'script@system',
      operation_type: 'delete',
      resource_type: 'messages',
      operation_status: 'success',
      details: {
        reason: 'Clear queued messages for testing safety',
        script: 'delete-all-queued-messages.ts',
        messages_deleted: params.queuedMessagesDeleted,
        sms_jobs_deleted: params.queuedJobsDeleted,
        message_limit: params.messageLimit,
        jobs_limit: params.jobsLimit,
        status_breakdown: params.statusBreakdown,
        message_ids_deleted: params.messageIdsDeleted,
        job_ids_deleted: params.jobIdsDeleted
      }
    })
    .select('id')

  assertQueuedMessagesCleanupAuditPersisted({
    error: auditError,
    insertedRows: insertedAuditRows
  })
}

async function deleteAllQueuedMessages(): Promise<void> {
  const argv = process.argv.slice(2)
  const hasConfirmFlag = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const deleteJobsRequested = argv.includes('--delete-jobs')

  const messageLimit =
    parseOptionalPositiveInt(readArgValue(argv, '--limit'), '--limit') ??
    parseOptionalPositiveInt(
      process.env.DELETE_ALL_QUEUED_MESSAGES_LIMIT,
      'DELETE_ALL_QUEUED_MESSAGES_LIMIT'
    )
  const jobsLimit =
    parseOptionalPositiveInt(readArgValue(argv, '--jobs-limit'), '--jobs-limit') ??
    parseOptionalPositiveInt(
      process.env.DELETE_ALL_QUEUED_MESSAGES_JOBS_LIMIT,
      'DELETE_ALL_QUEUED_MESSAGES_JOBS_LIMIT'
    )

  const HARD_CAP_MESSAGES = 1000
  const HARD_CAP_JOBS = 1000

  const mutationEnabled =
    !dryRunOverride &&
    hasConfirmFlag &&
    isTruthyEnv(process.env.RUN_DELETE_ALL_QUEUED_MESSAGES_MUTATION)

  if (hasConfirmFlag && !mutationEnabled && !dryRunOverride) {
    throw new Error(
      'delete-all-queued-messages blocked: --confirm requires RUN_DELETE_ALL_QUEUED_MESSAGES_MUTATION=true.'
    )
  }

  if (!mutationEnabled) {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `DRY RUN${extra}: no outbound messages will be deleted. Re-run with --confirm RUN_DELETE_ALL_QUEUED_MESSAGES_MUTATION=true ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT=true --limit=<n> to delete queued outbound messages.`
    )
  } else {
    assertDeleteAllQueuedMessagesMutationAllowed()

    if (!messageLimit) {
      throw new Error(
        'delete-all-queued-messages blocked: mutations require an explicit cap via --limit=<n> (or DELETE_ALL_QUEUED_MESSAGES_LIMIT).'
      )
    }
    if (messageLimit > HARD_CAP_MESSAGES) {
      throw new Error(
        `delete-all-queued-messages blocked: --limit ${messageLimit} exceeds hard cap ${HARD_CAP_MESSAGES}. Run in smaller batches.`
      )
    }

    if (deleteJobsRequested) {
      if (!jobsLimit) {
        throw new Error(
          'delete-all-queued-messages blocked: --delete-jobs requires --jobs-limit=<n> (or DELETE_ALL_QUEUED_MESSAGES_JOBS_LIMIT).'
        )
      }
      if (jobsLimit > HARD_CAP_JOBS) {
        throw new Error(
          `delete-all-queued-messages blocked: --jobs-limit ${jobsLimit} exceeds hard cap ${HARD_CAP_JOBS}. Run in smaller batches.`
        )
      }
    }
  }

  console.log(`\n🗑️  QUEUED SMS CLEANUP (${mutationEnabled ? 'MUTATION' : 'DRY RUN'})\n`)
  console.log(STATUS_DIVIDER)

  const supabase = createAdminClient()

  const totalQueuedCount = await loadQueuedMessageCount(supabase)
  const statusBreakdown = await loadQueuedMessageCountByStatus(supabase)

  console.log(`Queued outbound messages: ${totalQueuedCount}`)
  console.log('Status breakdown:')
  for (const [status, count] of Object.entries(statusBreakdown)) {
    console.log(`  ${status}: ${count}`)
  }

  const { data: sampleMessages, error: sampleError } = await supabase
    .from('messages')
    .select('id, body, status, created_at, to_number')
    .in('status', [...QUEUED_MESSAGE_STATUSES])
    .eq('direction', 'outbound')
    .order('created_at', { ascending: true })
    .limit(5)

  const messages = resolveQueuedMessagesCleanupRows<QueuedMessageRow>({
    operation: 'Load queued outbound messages (sample)',
    rows: sampleMessages,
    error: sampleError
  })

  if (messages.length > 0) {
    console.log('\n📋 SAMPLE MESSAGES (oldest first, up to 5):')
    console.log(SAMPLE_DIVIDER)
    messages.forEach((message, index) => {
      console.log(`${index + 1}. To: ${message.to_number || 'Unknown'}`)
      console.log(`   Status: ${message.status}`)
      console.log(`   Message: ${message.body?.substring(0, 60) || '<empty>'}...`)
      console.log(`   Created: ${formatMessageDate(message.created_at)}`)
    })
  }

  const totalSendJobs = deleteJobsRequested ? await loadSendJobCount(supabase) : 0
  if (deleteJobsRequested) {
    console.log(`\nQueued send jobs (types=${SEND_JOB_TYPES.join(',')}; status=${SEND_JOB_STATUSES.join(',')}): ${totalSendJobs}`)
  }

  if (!mutationEnabled) {
    console.log(`\n${STATUS_DIVIDER}`)
    console.log('Dry-run complete. No rows updated.')
    console.log(`${STATUS_DIVIDER}`)
    return
  }

  const effectiveMessageLimit = messageLimit ?? 0
  const deleteMessageCount = Math.min(totalQueuedCount, effectiveMessageLimit)
  if (deleteMessageCount <= 0) {
    throw new Error('delete-all-queued-messages blocked: --limit must be a positive integer.')
  }

  console.log(`\nDeleting ${deleteMessageCount}/${totalQueuedCount} queued outbound message(s) (cap=${effectiveMessageLimit})...`)

  const { data: messageIdRows, error: messageIdError } = await supabase
    .from('messages')
    .select('id')
    .in('status', [...QUEUED_MESSAGE_STATUSES])
    .eq('direction', 'outbound')
    .order('created_at', { ascending: true })
    .limit(deleteMessageCount)

  const messageIdCandidates = resolveQueuedMessagesCleanupRows<{ id: string }>({
    operation: 'Load queued outbound message ids for deletion',
    rows: messageIdRows,
    error: messageIdError
  })

  const messageIdsToDelete = messageIdCandidates
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (messageIdsToDelete.length !== deleteMessageCount) {
    throw new Error(
      `Failed to resolve queued outbound message ids for deletion (expected ${deleteMessageCount}, got ${messageIdsToDelete.length})`
    )
  }

  const { data: deletedMessages, error: deleteError } = await supabase
    .from('messages')
    .delete()
    .in('id', messageIdsToDelete)
    .select('id')

  const { deletedCount } = assertQueuedMessagesCleanupDeleteSucceeded({
    operation: 'Delete queued outbound messages',
    error: deleteError,
    deletedRows: deletedMessages,
    expectedCount: messageIdsToDelete.length
  })

  console.log(`✅ Deleted ${deletedCount} queued outbound message(s)`)

  let deletedJobsCount = 0
  const deletedJobIds: string[] = []

  if (deleteJobsRequested) {
    const effectiveJobsLimit = jobsLimit ?? 0
    const deleteJobCount = Math.min(totalSendJobs, effectiveJobsLimit)
    if (deleteJobCount <= 0) {
      throw new Error('delete-all-queued-messages blocked: --delete-jobs requires --jobs-limit to be a positive integer.')
    }

    console.log(`\nDeleting ${deleteJobCount}/${totalSendJobs} queued send job(s) (cap=${effectiveJobsLimit})...`)

    const { data: jobIdRows, error: jobIdError } = await supabase
      .from('jobs')
      .select('id, type, status, created_at')
      .in('type', [...SEND_JOB_TYPES])
      .in('status', [...SEND_JOB_STATUSES])
      .order('created_at', { ascending: true })
      .limit(deleteJobCount)

    const jobCandidates = resolveQueuedMessagesCleanupRows<QueuedJobRow>({
      operation: 'Load queued send jobs for deletion',
      rows: jobIdRows,
      error: jobIdError
    })

    const jobIdsToDelete = jobCandidates
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    if (jobIdsToDelete.length !== deleteJobCount) {
      throw new Error(
        `Failed to resolve queued send job ids for deletion (expected ${deleteJobCount}, got ${jobIdsToDelete.length})`
      )
    }

    const { data: deletedJobs, error: jobDeleteError } = await supabase
      .from('jobs')
      .delete()
      .in('id', jobIdsToDelete)
      .select('id')

    const { deletedCount: jobDeletedCount } = assertQueuedMessagesCleanupDeleteSucceeded({
      operation: 'Delete queued send jobs',
      error: jobDeleteError,
      deletedRows: deletedJobs,
      expectedCount: jobIdsToDelete.length
    })

    deletedJobsCount = jobDeletedCount
    deletedJobIds.push(...jobIdsToDelete)
    console.log(`✅ Deleted ${deletedJobsCount} queued send job(s)`)
  }

  await insertAuditLog({
    supabase,
    queuedMessagesDeleted: deletedCount,
    queuedJobsDeleted: deletedJobsCount,
    statusBreakdown,
    messageIdsDeleted: messageIdsToDelete,
    jobIdsDeleted: deletedJobIds,
    messageLimit: effectiveMessageLimit,
    jobsLimit: deleteJobsRequested ? (jobsLimit ?? null) : null,
  })

  console.log(`\n${STATUS_DIVIDER}`)
  console.log('✅ CLEANUP COMPLETE')
  console.log(STATUS_DIVIDER)
}

void deleteAllQueuedMessages().catch((error) => {
  markFailure('delete-all-queued-messages failed.', error)
})
