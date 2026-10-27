import { getTodayIsoDate } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.generated'

/**
 * Turned-away guests leave a trace (BK-101, BK-097; customer bookings review of 24 October 2026).
 *
 * One row in booking_funnel_events per availability answer, website refusal or failure, and
 * booking-form signal. No personal data: no name, phone number, email address or booking
 * reference, only codes, counts, the requested date and party size, a page path with ids
 * stripped, and the API key that sent it (so a test or preview key can be left out, BK-193).
 *
 * Recording never changes what a guest is told: a failed insert is logged and dropped.
 */

type AdminClient = ReturnType<typeof createAdminClient>
export type FunnelEventInsert = Database['public']['Tables']['booking_funnel_events']['Insert']

/** A short code: starts with a letter, no spaces, nothing a guest could have typed as prose. */
export const FUNNEL_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/

/** A path with every segment already reduced to a slug or a placeholder (`/events/:id`). */
export const FUNNEL_PAGE_PATTERN = /^(\/[A-Za-z0-9._~:-]*)+$/

/** The booking forms that send signals, and what they can say (BK-191). */
export const BOOKING_FORMS = ['event_booking'] as const
export const BOOKING_FORM_STEPS = ['opened', 'submit_pressed', 'blocked', 'sent'] as const
export const BOOKING_FORM_REASONS = ['missing_fields', 'no_security_token', 'server_refused', 'network'] as const

export async function recordFunnelEvent(supabase: AdminClient, event: FunnelEventInsert): Promise<boolean> {
  try {
    const { error } = await supabase.from('booking_funnel_events').insert(event)
    if (error) throw new Error(error.message)
    return true
  } catch (error) {
    logger.error('Could not record a booking funnel event', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { stage: event.stage, route: event.route, reasonCode: event.reason_code ?? null },
    })
    return false
  }
}

/** London calendar days from today to the requested date; null for a date that is not real. */
export function daysAhead(bookingDate: string, today: string = getTodayIsoDate()): number | null {
  const from = Date.parse(`${today}T00:00:00Z`)
  const to = Date.parse(`${bookingDate}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  const days = Math.round((to - from) / 86_400_000)
  // The table allows a day back (a late-night check for "today") and about a year ahead.
  return days >= -1 && days <= 400 ? days : null
}

export type AvailabilityOutcome = {
  calculationState: 'complete' | 'unknown'
  slotsOffered: number
  publicReason: string | null
}

/**
 * What an availability answer offered: whether it could be worked out at all, how many times
 * were bookable, and the public reason when none were. Anything unreadable counts as unknown.
 */
export function summariseAvailability(tableAvailability: unknown): AvailabilityOutcome {
  const record = tableAvailability && typeof tableAvailability === 'object' ? (tableAvailability as Record<string, unknown>) : null
  const state = record?.calculation_state === 'complete' ? 'complete' : 'unknown'
  const slots = Array.isArray(record?.slots) ? (record!.slots as unknown[]) : []
  const offered = state === 'complete'
    ? slots.filter((slot) => (slot as { state?: unknown } | null)?.state === 'available').length
    : 0
  const reason = typeof record?.public_reason === 'string' && FUNNEL_CODE_PATTERN.test(record.public_reason)
    ? record.public_reason
    : null
  return { calculationState: state, slotsOffered: Math.min(offered, 1000), publicReason: reason }
}
