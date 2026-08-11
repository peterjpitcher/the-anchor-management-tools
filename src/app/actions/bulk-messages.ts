'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { sendBulkSMSDirect } from '@/app/actions/sms-bulk-direct'
import { enqueueBulkSMSJob } from '@/app/actions/job-queue'
import type { BulkRecipientFilters, BulkRecipient, BulkRecipientsPage, SendBulkResult } from '@/types/bulk-messages'

const DIRECT_SEND_THRESHOLD = 100

type BulkSendRequest = {
  customerIds: string[]
  message: string
  eventId?: string
  categoryId?: string
}

type BulkSendOutcome =
  | { status: 'success'; details: Record<string, unknown> }
  | { status: 'failure'; error: string }

/**
 * Bulk SMS has the widest blast radius of anything in the app: one click can
 * text every customer on file, at real cost and under marketing consent rules.
 * Nothing downstream recorded it (neither sendBulkSMSDirect nor enqueueBulkSMSJob
 * writes an audit row), so there was no way to answer "who sent this, to whom,
 * and what did it say" after the fact. Recipient ids are stored in full because
 * the recipient list is the whole point of the record.
 */
async function logBulkSendAudit(
  user: { id: string; email?: string },
  request: BulkSendRequest,
  outcome: BulkSendOutcome
): Promise<void> {
  await logAuditEvent({
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    operation_type: 'send',
    resource_type: 'bulk_message',
    operation_status: outcome.status,
    ...(outcome.status === 'failure' && { error_message: outcome.error }),
    additional_info: {
      recipientCount: request.customerIds.length,
      recipientCustomerIds: request.customerIds,
      message: request.message,
      ...(request.eventId && { eventId: request.eventId }),
      ...(request.categoryId && { categoryId: request.categoryId }),
      ...(outcome.status === 'success' ? outcome.details : {}),
    },
  })
}

/**
 * Fetches bulk SMS recipients from the database using the get_bulk_sms_recipients RPC.
 * All filtering (event, booking status, category, date range, search) is handled server-side.
 * Search wildcards are escaped before passing to prevent unintended ILIKE expansion.
 */
export async function fetchBulkRecipients(
  filters: BulkRecipientFilters
): Promise<BulkRecipientsPage | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const hasPermission = await checkUserPermission('messages', 'send_marketing', user.id)
  if (!hasPermission) return { error: 'Insufficient permissions' }

  // Escape search wildcards to prevent unintended ILIKE expansion
  const escapedSearch = filters.search
    ? filters.search.replace(/[%_\\]/g, '\\$&')
    : null
  const page = Math.max(Number(filters.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(filters.pageSize ?? 50), 1), 100)

  const { data, error } = await supabase.rpc('get_bulk_sms_recipients', {
    p_event_id: filters.eventId || null,
    p_booking_status: filters.bookingStatus || null,
    p_sms_opt_in_only: filters.smsOptIn !== 'all',
    p_category_id: filters.categoryId || null,
    p_created_after: filters.createdAfter || null,
    p_created_before: filters.createdBefore || null,
    p_search: escapedSearch,
    p_page: page,
    p_page_size: pageSize,
  })

  if (error) return { error: `Failed to fetch recipients: ${error.message}` }

  const rows = (data ?? []) as Array<BulkRecipient & { total_count?: number | string | null }>
  const recipients = rows.map((row) => ({
    id: row.id,
    first_name: sanitizeRecipientName(row.first_name),
    last_name: sanitizeRecipientName(row.last_name),
    mobile_number: row.mobile_number,
    last_booking_date: row.last_booking_date,
  }))

  return {
    data: recipients,
    total: Number(rows[0]?.total_count ?? recipients.length),
    page,
    pageSize,
  }
}

function sanitizeRecipientName(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed.toLowerCase() === 'null' ? '' : trimmed
}

/**
 * Single entry point for sending bulk messages.
 * Routes to direct send (<=100 recipients) or job queue (>100 recipients).
 */
export async function sendBulkMessages(
  customerIds: string[],
  message: string,
  eventId?: string,
  categoryId?: string
): Promise<SendBulkResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthorized' }

  const auditUser = { id: user.id, ...(user.email && { email: user.email }) }
  const request: BulkSendRequest = { customerIds, message, eventId, categoryId }

  const hasPermission = await checkUserPermission('messages', 'send_marketing', user.id)
  if (!hasPermission) {
    await logBulkSendAudit(auditUser, request, {
      status: 'failure',
      error: 'Insufficient permissions',
    })
    return { success: false, error: 'Insufficient permissions' }
  }

  if (customerIds.length === 0) {
    return { success: false, error: 'No recipients provided' }
  }

  if (customerIds.length <= DIRECT_SEND_THRESHOLD) {
    // Send directly for small batches. sendBulkSMSDirect handles its own
    // auth/rate-limit checks.
    const result = await sendBulkSMSDirect(customerIds, message, eventId, categoryId)

    if ('error' in result && result.error) {
      await logBulkSendAudit(auditUser, request, { status: 'failure', error: result.error })
      return { success: false, error: result.error }
    }

    // Report what actually happened. Hard-coding sent: customerIds.length told
    // staff every recipient received the message even when sends failed, and
    // swallowed the deliberate "do not retry, contact engineering" warning that
    // is raised when outbound logging fails after messages may have gone out.
    const sent = result.sent ?? 0
    const failed = result.failed ?? 0

    await logBulkSendAudit(auditUser, request, {
      status: 'success',
      details: {
        route: 'direct',
        sent,
        failed,
        ...(result.errors?.length && { errors: result.errors }),
        ...(result.logFailure && { logFailure: true }),
      },
    })

    return {
      success: true,
      sent,
      failed,
      errors: result.errors,
      logFailure: result.logFailure,
      message: result.message,
      queued: false,
    }
  }

  // Enqueue for larger batches to avoid Vercel timeout limits
  const result = await enqueueBulkSMSJob(customerIds, message, eventId, categoryId)

  if ('error' in result) {
    const error = result.error ?? 'Failed to queue bulk SMS'
    await logBulkSendAudit(auditUser, request, { status: 'failure', error })
    return { success: false, error }
  }

  // Logged as queued, not sent: the job runner decides each recipient's outcome
  // later, so claiming a delivered count here would be a guess.
  await logBulkSendAudit(auditUser, request, {
    status: 'success',
    details: { route: 'queued' },
  })

  return {
    success: true,
    queued: true,
    sent: customerIds.length,
  }
}
