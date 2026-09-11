import { resolveCustomerIdForSms } from '@/lib/sms/customers'
import {
  privateBookingMessageNoLongerApplies,
  privateBookingStartsAt,
  renderPrivateBookingMessage,
} from '@/lib/private-bookings/message-catalogue'
import { cancellationFromFacts, loadPrivateBookingMessageContext } from '@/lib/private-bookings/message-context'
import type { DelayedFallbackRenderer } from '@/lib/notifications/delayed-fallback/types'

/**
 * Rebuilds a bounced private booking email as the text it replaced (P4 with P6).
 *
 * The delivery row, written by the private booking messenger, carries the booking id, the trigger
 * and the facts the email stated. The text is rebuilt from the booking as it is now, with the same
 * builder the original sender uses, and goes to the number the text queue would have used: the
 * booking's contact phone, else the customer's mobile, checked against the booking the same way.
 *
 * A message whose purpose has been met since (deposit or balance paid, hold gone) comes back as
 * no longer needed. The rebuilt text carries the moment its words stop being true (validUntil), so
 * the job can refuse one that would land too late.
 */
export const privateBookingFallbackRenderer: DelayedFallbackRenderer = {
  matches: (templateKey) => templateKey.startsWith('private_booking_'),
  render: async ({ delivery, client, now }) => {
    const metadata = delivery.metadata ?? {}
    const bookingId = typeof metadata.private_booking_id === 'string' ? metadata.private_booking_id : null
    const triggerType = typeof metadata.trigger_type === 'string' ? metadata.trigger_type : null
    if (!bookingId || !triggerType) {
      return { kind: 'unavailable', reason: 'booking_missing', booking: null }
    }

    const storedFacts =
      metadata.booking_facts && typeof metadata.booking_facts === 'object'
        ? (metadata.booking_facts as Record<string, unknown>)
        : null
    const context = await loadPrivateBookingMessageContext({
      client,
      bookingId,
      triggerType,
      now,
      cancellation: cancellationFromFacts(storedFacts),
      storedFacts,
    })
    const bookingRef = { type: 'private_booking' as const, id: bookingId }
    if (!context) {
      return { kind: 'unavailable', reason: 'booking_missing', booking: bookingRef }
    }

    // The deposit or balance has been paid, or the hold has gone, since the email: nothing to chase.
    if (privateBookingMessageNoLongerApplies(triggerType, context)) {
      return { kind: 'no_longer_needed', booking: bookingRef }
    }

    const message = renderPrivateBookingMessage(triggerType, context)
    if (!message) {
      return { kind: 'unavailable', reason: 'no_renderer', booking: bookingRef }
    }

    const booking = context.booking
    let phone = booking.contact_phone?.trim() || null
    if (!phone && booking.customer_id) {
      const { data: customer } = await (client.from('customers') as any)
        .select('mobile_number')
        .eq('id', booking.customer_id)
        .maybeSingle()
      phone = customer?.mobile_number?.trim() || null
    }

    let customerId: string | null = booking.customer_id
    if (phone) {
      const resolution = await resolveCustomerIdForSms(client as any, {
        bookingId,
        customerId: booking.customer_id ?? undefined,
        to: phone,
      })
      if (resolution.resolutionError || !resolution.customerId) {
        phone = null
      } else {
        customerId = resolution.customerId
      }
    }

    return {
      kind: 'ready',
      booking: {
        ...bookingRef,
        status: booking.status,
        startsAt: privateBookingStartsAt(booking),
        facts: message.facts,
      },
      expectCancelled: message.expectCancelled,
      expectPast: message.expectPast,
      validUntil: message.validUntil,
      sms: {
        to: phone,
        body: message.smsBody,
        customerId,
        metadata: {
          private_booking_id: bookingId,
          booking_id: bookingId,
          trigger_type: triggerType,
        },
      },
    }
  },
}
