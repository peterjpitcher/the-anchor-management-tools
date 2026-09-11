import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Guest messages that reached nobody: every `notification_deliveries` row whose final status is
 * `failed` (every channel failed, or a bounced email's text fallback could not be sent). Listed on
 * /settings/sms-failures so staff can contact the guest another way.
 */
export type UndeliveredGuestMessage = {
  id: string
  failedAt: string
  templateKey: string
  customerId: string | null
  customerName: string
  booking: { href: string; label: string } | null
  reason: string
  attempts: Array<{ channel: string; error: string | null }>
}

const REASON_LABELS: Record<string, string> = {
  no_sms_channel: 'Email bounced; no mobile number to text',
  sms_failed: 'Email bounced; the text failed too',
  no_renderer: 'Email bounced; this message cannot be sent as a text',
  booking_missing: 'Email bounced; booking not found',
  render_failed: 'Email bounced; the text could not be built',
  customer_missing: 'Email bounced; customer record not found',
  facts_missing: 'Email bounced; the message details were not recorded',
  link_not_found: 'Email bounced; the link could not be found again',
  link_expired: 'Email bounced; the link has expired',
  link_not_rebuildable: 'Email bounced; the link cannot be rebuilt',
  fallback_enqueue_failed: 'Email bounced; the text could not be queued',
  email_and_sms_failed: 'Email and text both failed',
}

type DeliveryRow = {
  id: string
  created_at: string
  updated_at: string | null
  template_key: string
  customer_id: string | null
  metadata: Record<string, unknown> | null
  customer: { first_name: string | null; last_name: string | null } | Array<{ first_name: string | null; last_name: string | null }> | null
}

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

function bookingLink(metadata: Record<string, unknown> | null): UndeliveredGuestMessage['booking'] {
  const privateBookingId = metadata?.private_booking_id
  if (typeof privateBookingId === 'string' && privateBookingId) {
    return { href: `/private-bookings/${privateBookingId}`, label: 'Private booking' }
  }
  const tableBookingId = metadata?.table_booking_id
  if (typeof tableBookingId === 'string' && tableBookingId) {
    return { href: `/table-bookings/${tableBookingId}`, label: 'Table booking' }
  }
  return null
}

function describeReason(metadata: Record<string, unknown> | null): string {
  const reason = typeof metadata?.undelivered_reason === 'string' ? metadata.undelivered_reason : null
  if (reason) return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')
  return 'Every channel failed'
}

export async function loadUndeliveredGuestMessages(input: {
  sinceIso: string
  limit?: number
}): Promise<{ rows: UndeliveredGuestMessage[]; error: string | null }> {
  const client = createAdminClient()
  const { data, error } = await (client.from('notification_deliveries') as any)
    .select('id, created_at, updated_at, template_key, customer_id, metadata, customer:customers(first_name, last_name)')
    .eq('final_status', 'failed')
    .gte('updated_at', input.sinceIso)
    .order('updated_at', { ascending: false })
    .limit(input.limit ?? 200)

  if (error) {
    return { rows: [], error: typeof error.message === 'string' ? error.message : 'Failed to load undelivered messages' }
  }

  const deliveries = (data ?? []) as DeliveryRow[]
  const attemptsByDelivery = new Map<string, Array<{ channel: string; error: string | null }>>()

  if (deliveries.length > 0) {
    const { data: attempts } = await (client.from('notification_attempts') as any)
      .select('delivery_id, channel, error, attempt_order')
      .in('delivery_id', deliveries.map((row) => row.id))
      .order('attempt_order', { ascending: true })

    for (const attempt of (attempts ?? []) as Array<{ delivery_id: string; channel: string; error: string | null }>) {
      const list = attemptsByDelivery.get(attempt.delivery_id) ?? []
      list.push({ channel: attempt.channel, error: attempt.error ?? null })
      attemptsByDelivery.set(attempt.delivery_id, list)
    }
  }

  return {
    rows: deliveries.map((row) => {
      const customer = firstRelation(row.customer)
      const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
      return {
        id: row.id,
        failedAt: row.updated_at ?? row.created_at,
        templateKey: row.template_key,
        customerId: row.customer_id,
        customerName: name || 'Unknown customer',
        booking: bookingLink(row.metadata),
        reason: describeReason(row.metadata),
        attempts: attemptsByDelivery.get(row.id) ?? [],
      }
    }),
    error: null,
  }
}
