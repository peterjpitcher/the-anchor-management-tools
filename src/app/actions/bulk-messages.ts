'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { sendBulkSMSDirect } from '@/app/actions/sms-bulk-direct'
import { enqueueBulkSMSJob } from '@/app/actions/job-queue'
import type { BulkRecipientFilters, BulkRecipient, BulkRecipientsPage, SendBulkResult } from '@/types/bulk-messages'

const DIRECT_SEND_THRESHOLD = 100

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

  const hasPermission = await checkUserPermission('messages', 'send_marketing', user.id)
  if (!hasPermission) return { success: false, error: 'Insufficient permissions' }

  if (customerIds.length === 0) {
    return { success: false, error: 'No recipients provided' }
  }

  if (customerIds.length <= DIRECT_SEND_THRESHOLD) {
    // Send directly for small batches — sendBulkSMSDirect handles its own auth/rate-limit checks
    const result = await sendBulkSMSDirect(customerIds, message, eventId, categoryId)

    if ('error' in result) {
      return { success: false, error: result.error }
    }

    return {
      success: true,
      sent: customerIds.length,
      queued: false,
    }
  }

  // Enqueue for larger batches to avoid Vercel timeout limits
  const result = await enqueueBulkSMSJob(customerIds, message, eventId, categoryId)

  if ('error' in result) {
    return { success: false, error: result.error }
  }

  return {
    success: true,
    queued: true,
    sent: customerIds.length,
  }
}
