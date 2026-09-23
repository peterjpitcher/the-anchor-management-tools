import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Event booking payload readers, moved out of the route verbatim.
 */

export function getCaptureOrderId(resource: any): string | null {
  const raw = resource?.supplementary_data?.related_ids?.order_id
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

export function getCaptureId(resource: any): string | null {
  const raw = resource?.id
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

export function getCaptureAmount(resource: any): number | null {
  const parsed = Number(resource?.amount?.value)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
}

export function getCaptureCurrency(resource: any): string {
  const raw = resource?.amount?.currency_code
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : 'GBP'
}

export function getEventBookingIdFromCustomId(resource: any): string | null {
  const customId = typeof resource?.custom_id === 'string' ? resource.custom_id.trim() : ''
  if (!customId.startsWith('event_booking:')) return null
  const bookingId = customId.slice('event_booking:'.length).trim()
  return bookingId || null
}

export async function recordManualReviewAudit(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    bookingId: string
    eventId: string
    orderId: string
    captureId: string
    amount: number
    currency: string
    state: string
    reason: string | null
  }
) {
  const { error } = await supabase.from('audit_logs').insert({
    operation_type: 'event_payment.paypal_webhook_manual_review',
    resource_type: 'event_booking',
    resource_id: input.bookingId,
    operation_status: 'failure',
    additional_info: {
      event_id: input.eventId,
      order_id: input.orderId,
      capture_id: input.captureId,
      amount: input.amount,
      currency: input.currency,
      state: input.state,
      reason: input.reason,
      source: 'paypal_event_bookings_webhook',
    },
  })

  if (error) {
    throw new Error(`Failed to audit PayPal event-booking manual review: ${error.message}`)
  }
}
