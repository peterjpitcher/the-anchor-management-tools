import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { GUEST_CONTACT } from '@/lib/guest-contact'

/**
 * The table booking party limit (owner decision D30, BK-146): one limit for every channel, the
 * website, staff screens and guests changing their own booking alike. It lives in the setting
 * `table_booking_max_party_online`, which the booking functions read (create_table_booking_public_v06
 * and, since 20261027193656, create_table_booking_staff_v06), so the app reads the same setting
 * rather than a number of its own. Bigger groups are private bookings.
 */

/** What the booking functions fall back to when the setting is missing or unreadable. */
export const DEFAULT_TABLE_BOOKING_PARTY_LIMIT = 20

/**
 * A typo guard for parsing a request only, matching the range Settings accepts for the limit
 * (validate_table_booking_settings: 1 to 200). The real limit is checked with
 * readTableBookingPartyLimit after parsing.
 */
export const PARTY_SIZE_INPUT_CEILING = 200

export const PARTY_LIMIT_SETTING_KEY = 'table_booking_max_party_online'

/** The largest party a table booking may have, from the setting the booking functions read. */
export async function readTableBookingPartyLimit(
  supabase: SupabaseClient<any, 'public', any>
): Promise<number> {
  let data: { value?: unknown } | null = null
  let error: { code?: string; message: string } | null = null
  try {
    const result = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', PARTY_LIMIT_SETTING_KEY)
      .maybeSingle()
    data = result.data
    error = result.error
  } catch (thrown) {
    error = { message: thrown instanceof Error ? thrown.message : String(thrown) }
  }
  // The same fallback the booking functions use when the setting cannot be read, and they still
  // enforce the setting themselves, so a failed read here never lets a bigger party through.
  if (error) {
    logger.error('Could not read the table booking party limit; using the default', {
      metadata: { code: error.code ?? null, message: error.message },
    })
    return DEFAULT_TABLE_BOOKING_PARTY_LIMIT
  }
  const raw = (data?.value as { value?: unknown } | null | undefined)?.value
  const limit = typeof raw === 'number' ? raw : Number(raw)
  return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_TABLE_BOOKING_PARTY_LIMIT
}

/** For a guest: what to do with a group above the limit. */
export function guestPartyLimitMessage(limit: number): string {
  return `For more than ${limit} guests, please call us on ${GUEST_CONTACT.phoneDisplay} or send us a private hire enquiry.`
}

/** For staff: a group above the limit is a private booking. */
export function staffPartyLimitMessage(limit: number): string {
  return `Table bookings are for up to ${limit} guests. A bigger group is a private booking.`
}
