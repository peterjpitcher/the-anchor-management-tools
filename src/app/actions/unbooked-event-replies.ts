'use server'

import { z } from 'zod'
import { checkUserPermission } from './rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * Text replies to event promotions that nobody could book (BK-034, customer bookings review of
 * 24 October 2026). The reply-to-book handler flags them on the inbound message
 * (metadata.reply_to_book_unbooked, with the event in reply_to_book_event_id), but nothing read
 * the flag, so a booking request could sit unread until after the night. They are listed on the
 * event page and counted on the dashboard until someone reads the message.
 *
 * Staff with events:view see the guest's first name, when it came and a link to the
 * conversation. The message text stays in Messages.
 */
export type UnbookedEventReply = {
  messageId: string
  customerId: string
  firstName: string
  receivedAt: string
  eventId: string | null
}

const inputSchema = z.object({ eventId: z.string().uuid().optional() })

const LOOKBACK_DAYS = 45

export async function listUnbookedEventReplies(input: { eventId?: string } = {}): Promise<{ data?: UnbookedEventReply[]; error?: string }> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid request.' }
  const canView = await checkUserPermission('events', 'view')
  if (!canView) return { error: 'You do not have permission to view events.' }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let query = createAdminClient()
    .from('messages')
    .select('id, customer_id, created_at, metadata, customer:customers(first_name)')
    .eq('direction', 'inbound')
    .is('read_at', null)
    .eq('metadata->>reply_to_book_unbooked', 'true')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50)
  if (parsed.data.eventId) query = query.eq('metadata->>reply_to_book_event_id', parsed.data.eventId)

  const { data, error } = await query
  if (error) {
    logger.error('Unbooked event replies could not be loaded', { error: new Error(error.message) })
    return { error: 'Unbooked event replies could not be loaded.' }
  }

  return {
    data: (data ?? []).map((row) => {
      const customerRaw = (row as { customer?: unknown }).customer
      const customer = (Array.isArray(customerRaw) ? customerRaw[0] : customerRaw) as { first_name?: string | null } | null
      const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>
      return {
        messageId: row.id,
        customerId: row.customer_id,
        firstName: customer?.first_name?.trim() || 'A guest',
        receivedAt: row.created_at,
        eventId: typeof metadata.reply_to_book_event_id === 'string' ? metadata.reply_to_book_event_id : null,
      }
    }),
  }
}
