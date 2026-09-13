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
  /** When the delivery row was written, which is before the email was sent. */
  created_at?: string | null
}

export type FallbackBookingRef = {
  type: 'private_booking' | 'table_booking'
  id: string
}

/** Facts a message states about its booking, compared at fallback time to spot a change. */
export type FallbackBookingFacts = Record<string, string | number | null>

/**
 * When a message's words stop being true, as an ISO instant: for wording that is time-relative or
 * names a deadline ("tomorrow's the day", "expires tomorrow", "due by 3 October", "Pay now" on a
 * link that runs out). Taken from the words the text actually says. Null or absent when the words
 * hold until the booking starts, which the skip rules check anyway.
 */
export type FallbackValidUntil = string | null

/** What the skip rules read: the booking as it is now, and what the message expects of it. */
export type FallbackSkipCheck = {
  booking: {
    status: string | null
    /** When the booking starts, as an ISO instant, or null when the date is still to be confirmed. */
    startsAt: string | null
    facts: FallbackBookingFacts
  }
  /** A cancellation or expiry message: the booking is meant to be cancelled. */
  expectCancelled?: boolean
  /** A message about an event that has already happened (thanks, review request). */
  expectPast?: boolean
  /** A text that would reach the guest at or after this is not sent. */
  validUntil?: FallbackValidUntil
}

/**
 * What a renderer returns for one delivery.
 *
 * 'ready' carries the text, rebuilt from the live booking, plus the booking's current state so the
 * job can decide whether the text is still true. 'unavailable' means the text cannot be rebuilt
 * (the booking is gone, or its details are missing), which the job treats as undelivered.
 * 'no_longer_needed' means what the message asked for has happened since (the deposit or balance
 * is paid, the link has been used, the guest has answered): the job skips it and tells nobody.
 */
export type DelayedFallbackRender =
  | {
      kind: 'unavailable'
      reason: string
      booking: FallbackBookingRef | null
      /**
       * The booking as it is now, when it could be read. A text that cannot be rebuilt for a
       * booking that has since been cancelled, has started or has changed is skipped rather than
       * reported undelivered, so staff are not asked to chase a guest who no longer needs it.
       */
      current?: FallbackSkipCheck
    }
  | {
      kind: 'no_longer_needed'
      booking: FallbackBookingRef
    }
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
      /** A text that would reach the guest at or after this is not sent. */
      validUntil?: FallbackValidUntil
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
