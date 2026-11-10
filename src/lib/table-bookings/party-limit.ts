import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { DEFAULT_CHRISTMAS_ONLINE_PARTY_LIMIT, DEFAULT_CHRISTMAS_STAFF_PARTY_LIMIT } from './christmas'

export { DEFAULT_CHRISTMAS_ONLINE_PARTY_LIMIT, DEFAULT_CHRISTMAS_STAFF_PARTY_LIMIT }

/**
 * The table booking party limit (owner decision D30, BK-146): one limit for every channel, the
 * website, staff screens and guests changing their own booking alike. It lives in the setting
 * `table_booking_max_party_online`, which the booking functions read (create_table_booking_public_v06
 * and, since 20261028125055, create_table_booking_staff_v06), so the app reads the same setting
 * rather than a number of its own. Bigger groups are private bookings. Sit-down Christmas dinner has
 * two ceilings of its own (owner decisions of 10 November 2026): online and for a guest changing their
 * own booking, `table_booking_max_party_christmas_online` (26); for staff, `christmas_staff_max_party`
 * (60).
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

/**
 * The largest Christmas party staff may book in the management app (A3, owner decisions of
 * 6 November 2026): the seated Christmas capacity. create_table_booking_staff_v06 reads the same
 * setting, with the same default, for a booking that accepted the Christmas period. Above the
 * online Christmas ceiling the party sits across tables that are not joined.
 */
export const CHRISTMAS_STAFF_PARTY_LIMIT_SETTING_KEY = 'christmas_staff_max_party'

/**
 * The largest sit-down Christmas dinner the website takes, and the most a guest may raise their own
 * Christmas booking to (owner decision of 10 November 2026). create_table_booking_public_v06,
 * create_table_booking_christmas_v01 and check_table_availability_v06 read the same setting, with
 * the same default, for a booking that accepted the Christmas period.
 */
export const CHRISTMAS_ONLINE_PARTY_LIMIT_SETTING_KEY = 'table_booking_max_party_christmas_online'

/** A positive whole-number setting, stored as {"value": n}, or the fallback the database also uses. */
async function readPartyLimitSetting(
  supabase: SupabaseClient<any, 'public', any>,
  key: string,
  fallback: number
): Promise<number> {
  let data: { value?: unknown } | null = null
  let error: { code?: string; message: string } | null = null
  try {
    const result = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    data = result.data
    error = result.error
  } catch (thrown) {
    error = { message: thrown instanceof Error ? thrown.message : String(thrown) }
  }
  // The same fallback the booking functions use when the setting cannot be read, and they still
  // enforce the setting themselves, so a failed read here never lets a bigger party through.
  if (error) {
    logger.error('Could not read a table booking party limit; using the default', {
      metadata: { key, code: error.code ?? null, message: error.message },
    })
    return fallback
  }
  const raw = (data?.value as { value?: unknown } | null | undefined)?.value
  const limit = typeof raw === 'number' ? raw : Number(raw)
  return Number.isInteger(limit) && limit > 0 ? limit : fallback
}

/** The largest party a table booking may have, from the setting the booking functions read. */
export async function readTableBookingPartyLimit(
  supabase: SupabaseClient<any, 'public', any>
): Promise<number> {
  return readPartyLimitSetting(supabase, PARTY_LIMIT_SETTING_KEY, DEFAULT_TABLE_BOOKING_PARTY_LIMIT)
}

/** The largest sit-down Christmas dinner a guest can book online or grow their own booking to. */
export async function readChristmasOnlinePartyLimit(
  supabase: SupabaseClient<any, 'public', any>
): Promise<number> {
  return readPartyLimitSetting(
    supabase,
    CHRISTMAS_ONLINE_PARTY_LIMIT_SETTING_KEY,
    DEFAULT_CHRISTMAS_ONLINE_PARTY_LIMIT
  )
}

/**
 * The largest party staff may book: the ordinary limit, or for a Christmas booking the larger of
 * that and `christmas_staff_max_party`, exactly as create_table_booking_staff_v06 decides it.
 */
export async function readStaffPartyLimit(
  supabase: SupabaseClient<any, 'public', any>,
  options: { christmas: boolean }
): Promise<number> {
  const ordinary = await readTableBookingPartyLimit(supabase)
  if (!options.christmas) return ordinary
  const christmas = await readPartyLimitSetting(
    supabase,
    CHRISTMAS_STAFF_PARTY_LIMIT_SETTING_KEY,
    DEFAULT_CHRISTMAS_STAFF_PARTY_LIMIT
  )
  return Math.max(ordinary, christmas)
}

/** For a guest: what to do with a group above the limit. */
export function guestPartyLimitMessage(limit: number): string {
  return `For more than ${limit} guests, please call us on ${GUEST_CONTACT.phoneDisplay} or send us a private hire enquiry.`
}

/** For staff: a group above the limit is a private booking. */
export function staffPartyLimitMessage(limit: number): string {
  return `Table bookings are for up to ${limit} guests. A bigger group is a private booking.`
}

/** For staff: a Christmas party above the staff Christmas limit is a private booking. */
export function staffChristmasPartyLimitMessage(limit: number): string {
  return `Christmas bookings are for up to ${limit} guests. A bigger group is a private booking.`
}
