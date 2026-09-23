import { createAdminClient } from '@/lib/supabase/admin'
import { INVOICE_PAYMENT_CUSTOM_ID_PREFIX } from '@/lib/invoices/paypal-custom-id'

/**
 * Decides which part of the business owns a PayPal event.
 *
 * PayPal delivers every event on the app to every registered webhook URL, with no way to scope
 * a registration to a subset of transactions. Production proves it: the private-bookings URL
 * received invoice and event-ticket captures, and the table-bookings URL logged "success" for
 * five captures that were actually invoices and private bookings. So the URL an event arrives
 * on says nothing about whose it is, and routing has to be positive, from the payload.
 *
 * Positive is the operative word. Two domains put a bare booking id in `custom_id` (table
 * bookings and parking), so a prefix is not enough to tell them apart and a lookup decides.
 * Anything we cannot positively place is reported as
 * `unrouted` and acknowledged, never guessed at: the old table-bookings route fed every capture
 * to its own handler, and the parking route would have thrown on anything that was not a
 * parking booking, which with retries means forever.
 */

export type PayPalDomain =
  | 'invoices'
  | 'private_bookings'
  | 'table_bookings'
  | 'parking'
  | 'event_bookings'

export type PayPalRouteDecision =
  | { domain: PayPalDomain; key: string; via: 'custom_id_prefix' | 'custom_id_lookup' | 'order_id' | 'refund_lookup' }
  | { domain: null; key: null; via: 'unrouted'; reason: string }

const PRIVATE_BOOKING_PREFIX = 'pb-deposit-'
const EVENT_BOOKING_PREFIX = 'event_booking:'

export const PAYPAL_REFUND_EVENT_TYPES = new Set([
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.REFUND.COMPLETED',
  'PAYMENT.REFUND.PENDING',
  'PAYMENT.REFUND.FAILED',
  'PAYMENT.REFUND.CANCELLED',
])

function readCustomId(event: any): string {
  const raw = event?.resource?.custom_id
  return typeof raw === 'string' ? raw.trim() : ''
}

function readOrderId(event: any): string {
  const raw = event?.resource?.supplementary_data?.related_ids?.order_id
  return typeof raw === 'string' ? raw.trim() : ''
}

function readCaptureIdFromRefund(event: any): string {
  // A refund resource carries its capture on the HATEOAS "up" link, not in a field.
  const link = event?.resource?.links?.find((candidate: any) => candidate?.rel === 'up')?.href
  if (typeof link !== 'string') return ''
  return link.split('/').pop()?.trim() ?? ''
}

/**
 * Routes a capture event (completed or denied).
 */
async function routeCapture(
  supabase: ReturnType<typeof createAdminClient>,
  event: any
): Promise<PayPalRouteDecision> {
  const customId = readCustomId(event)

  if (customId.startsWith(INVOICE_PAYMENT_CUSTOM_ID_PREFIX)) {
    const invoiceId = customId.slice(INVOICE_PAYMENT_CUSTOM_ID_PREFIX.length)
    return invoiceId
      ? { domain: 'invoices', key: invoiceId, via: 'custom_id_prefix' }
      : { domain: null, key: null, via: 'unrouted', reason: 'invoice custom_id carried no id' }
  }

  if (customId.startsWith(PRIVATE_BOOKING_PREFIX)) {
    const bookingId = customId.slice(PRIVATE_BOOKING_PREFIX.length)
    return bookingId
      ? { domain: 'private_bookings', key: bookingId, via: 'custom_id_prefix' }
      : { domain: null, key: null, via: 'unrouted', reason: 'private booking custom_id carried no id' }
  }

  if (customId.startsWith(EVENT_BOOKING_PREFIX)) {
    const bookingId = customId.slice(EVENT_BOOKING_PREFIX.length)
    return bookingId
      ? { domain: 'event_bookings', key: bookingId, via: 'custom_id_prefix' }
      : { domain: null, key: null, via: 'unrouted', reason: 'event booking custom_id carried no id' }
  }

  // No prefix. Table bookings and parking both put a bare booking id in custom_id, so ask each
  // in turn. Deliberately not gated on the id looking like a UUID: that is a guess about id
  // format, and two cheap lookups on a handful of events a day is not worth the brittleness.
  if (customId) {
    const { data: tableBooking, error: tableError } = await supabase
      .from('table_bookings')
      .select('id')
      .eq('id', customId)
      .maybeSingle()
    if (tableError) throw new Error(`Routing lookup failed on table_bookings: ${tableError.message}`)
    if (tableBooking) return { domain: 'table_bookings', key: customId, via: 'custom_id_lookup' }

    const { data: parkingBooking, error: parkingError } = await supabase
      .from('parking_bookings')
      .select('id')
      .eq('id', customId)
      .maybeSingle()
    if (parkingError) throw new Error(`Routing lookup failed on parking_bookings: ${parkingError.message}`)
    if (parkingBooking) return { domain: 'parking', key: customId, via: 'custom_id_lookup' }
  }

  // No usable custom_id. The order id is the only remaining handle.
  const orderId = readOrderId(event)
  if (orderId) {
    const { data: byOrder, error: orderError } = await supabase
      .from('table_bookings')
      .select('id')
      .eq('paypal_deposit_order_id', orderId)
      .maybeSingle()
    if (orderError) throw new Error(`Routing lookup failed on table_bookings order id: ${orderError.message}`)
    if (byOrder) return { domain: 'table_bookings', key: byOrder.id, via: 'order_id' }

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('event_booking_id')
      .eq('paypal_order_id', orderId)
      .eq('payment_provider', 'paypal')
      .eq('charge_type', 'prepaid_event')
      .maybeSingle()
    if (paymentError) throw new Error(`Routing lookup failed on payments order id: ${paymentError.message}`)
    if (payment?.event_booking_id) {
      return { domain: 'event_bookings', key: payment.event_booking_id, via: 'order_id' }
    }
  }

  return {
    domain: null,
    key: null,
    via: 'unrouted',
    reason: customId
      ? 'custom_id matched no known prefix or booking'
      : 'no custom_id and no order id matched a booking',
  }
}

/**
 * Routes a refund event. Refund resources carry no `custom_id`, so the refund ledger decides,
 * and failing that the capture the refund points at.
 */
async function routeRefund(
  supabase: ReturnType<typeof createAdminClient>,
  event: any
): Promise<PayPalRouteDecision> {
  const refundId = typeof event?.resource?.id === 'string' ? event.resource.id.trim() : ''

  if (refundId) {
    const { data: existing, error } = await supabase
      .from('payment_refunds')
      .select('source_type, source_id')
      .eq('paypal_refund_id', refundId)
      .maybeSingle()
    if (error) throw new Error(`Routing lookup failed on payment_refunds: ${error.message}`)

    if (existing?.source_type) {
      const map: Record<string, PayPalDomain> = {
        private_booking: 'private_bookings',
        table_booking: 'table_bookings',
        parking: 'parking',
      }
      const domain = map[existing.source_type]
      if (domain) return { domain, key: existing.source_id, via: 'refund_lookup' }
    }

    // Event ticket refunds are not in payment_refunds at all: they are `payments` rows with
    // charge_type 'refund' carrying the PayPal refund id in metadata.
    const { data: eventRefund, error: eventRefundError } = await supabase
      .from('payments')
      .select('event_booking_id')
      .eq('charge_type', 'refund')
      .contains('metadata', { paypal_refund_id: refundId })
      .limit(1)
      .maybeSingle()
    if (eventRefundError) throw new Error(`Routing lookup failed on event refunds: ${eventRefundError.message}`)
    if (eventRefund?.event_booking_id) {
      return { domain: 'event_bookings', key: eventRefund.event_booking_id, via: 'refund_lookup' }
    }
  }

  // Refund raised in the PayPal dashboard: nothing of ours references it yet, so find whoever
  // owns the capture being refunded.
  const captureId = readCaptureIdFromRefund(event)
  if (captureId) {
    const owners: Array<{ table: string; column: string; domain: PayPalDomain }> = [
      { table: 'private_bookings', column: 'paypal_deposit_capture_id', domain: 'private_bookings' },
      { table: 'table_bookings', column: 'paypal_deposit_capture_id', domain: 'table_bookings' },
      { table: 'parking_booking_payments', column: 'transaction_id', domain: 'parking' },
    ]

    for (const owner of owners) {
      const { data, error } = await (supabase.from(owner.table) as any)
        .select('id')
        .eq(owner.column, captureId)
        .maybeSingle()
      if (error) throw new Error(`Routing lookup failed on ${owner.table}: ${error.message}`)
      if (data) return { domain: owner.domain, key: data.id, via: 'refund_lookup' }
    }
  }

  return {
    domain: null,
    key: null,
    via: 'unrouted',
    reason: 'no refund record and no booking owns the refunded capture',
  }
}

export async function routePayPalEvent(
  supabase: ReturnType<typeof createAdminClient>,
  event: any
): Promise<PayPalRouteDecision> {
  const eventType = typeof event?.event_type === 'string' ? event.event_type : ''

  if (PAYPAL_REFUND_EVENT_TYPES.has(eventType)) {
    return routeRefund(supabase, event)
  }

  if (eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'PAYMENT.CAPTURE.DENIED') {
    return routeCapture(supabase, event)
  }

  return { domain: null, key: null, via: 'unrouted', reason: `unhandled event type ${eventType || 'unknown'}` }
}
