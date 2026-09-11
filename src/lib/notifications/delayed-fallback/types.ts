import type { createAdminClient } from '@/lib/supabase/admin'

/** The notification_deliveries columns the delayed fallback reads. */
export type DelayedFallbackDelivery = {
  id: string
  customer_id: string | null
  template_key: string
  category: string
  delayed_fallback_allowed: boolean
  delayed_fallback_sent_at: string | null
  selected_channel: string | null
  final_status: string
  metadata: Record<string, unknown> | null
}

export type FallbackBookingRef = {
  type: 'private_booking' | 'table_booking'
  id: string
}

/** Facts a message states about its booking, compared at fallback time to spot a change. */
export type FallbackBookingFacts = Record<string, string | number | null>

/**
 * What a renderer returns for one delivery.
 *
 * 'ready' carries the text, rebuilt from the live booking, plus the booking's current state so the
 * job can decide whether the text is still true. 'unavailable' means the text cannot be rebuilt
 * (the booking is gone, or its details are missing), which the job treats as undelivered.
 */
export type DelayedFallbackRender =
  | { kind: 'unavailable'; reason: string; booking: FallbackBookingRef | null }
  | {
      kind: 'ready'
      booking: FallbackBookingRef & {
        status: string | null
        /** When the booking starts, as an ISO instant, or null when the date is still to be confirmed. */
        startsAt: string | null
        facts: FallbackBookingFacts
      }
      /** A cancellation or expiry message: the booking is meant to be cancelled. */
      expectCancelled?: boolean
      /** A message about an event that has already happened (thanks, review request). */
      expectPast?: boolean
      sms: {
        /** Null when the guest has no number to text. */
        to: string | null
        body: string
        customerId: string | null
        /** Booking ids and trigger for the messages row and SMS duplicate protection. */
        metadata: Record<string, unknown>
      }
    }

export type DelayedFallbackRenderer = {
  /** Which template keys this renderer rebuilds. */
  matches: (templateKey: string) => boolean
  render: (input: {
    delivery: DelayedFallbackDelivery
    client: ReturnType<typeof createAdminClient>
    now: Date
  }) => Promise<DelayedFallbackRender>
}
