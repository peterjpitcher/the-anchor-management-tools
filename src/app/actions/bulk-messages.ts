'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { sendBulkSMSDirect } from '@/app/actions/sms-bulk-direct'
import { enqueueBulkSMSJob } from '@/app/actions/job-queue'
import type { BulkRecipientFilters, BulkRecipient, SendBulkResult } from '@/types/bulk-messages'

const DIRECT_SEND_THRESHOLD = 100

/**
 * Fetches bulk SMS recipients from the database using the get_bulk_sms_recipients RPC.
 * All filtering (event, booking status, category, date range, search) is handled server-side.
 * Search wildcards are escaped before passing to prevent unintended ILIKE expansion.
 */
export async function fetchBulkRecipients(
  filters: BulkRecipientFilters
): Promise<{ data: BulkRecipient[] } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const hasPermission = await checkUserPermission('messages', 'send', user.id)
  if (!hasPermission) return { error: 'Insufficient permissions' }

  // Escape search wildcards to prevent unintended ILIKE expansion
  const escapedSearch = filters.search
    ? filters.search.replace(/[%_\\]/g, '\\$&')
    : null

  const { data, error } = await supabase.rpc('get_bulk_sms_recipients', {
    p_event_id: filters.eventId || null,
    p_booking_status: filters.bookingStatus || null,
    p_sms_opt_in_only: filters.smsOptIn !== 'all',
    p_category_id: filters.categoryId || null,
    p_created_after: filters.createdAfter || null,
    p_created_before: filters.createdBefore || null,
    p_search: escapedSearch,
  })

  if (error) return { error: `Failed to fetch recipients: ${error.message}` }
  return { data: (data ?? []) as BulkRecipient[] }
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

  const hasPermission = await checkUserPermission('messages', 'send', user.id)
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
