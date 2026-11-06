import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'

// Untyped like the other pre-order loaders (preorder.ts): the generated types are not threaded through the admin client.
type Db = SupabaseClient<any, any, any>

/** PostgREST puts an in-list in the URL; chunks keep a busy week's list well under its limit. */
const CHUNK = 200

/**
 * Which of these bookings have a guest whose own seat says they have an allergy
 * (`booking_preorder_covers.has_allergies` true), so the FOH timeline and BOH list raise the
 * booking's allergy flag for it as they do for the booking-level allergy field.
 *
 * The pre-order tables are service-role only under RLS, so this reads with the admin client (or the
 * one passed in); callers MUST have proven the user's permission first. A failed read, the client
 * included, is logged and answers "none known": it must not take the floor plan or the list down
 * with it, and the booking-level flags still show.
 */
export async function loadSeatAllergyBookingIds(bookingIds: readonly string[], db?: Db): Promise<Set<string>> {
  const flagged = new Set<string>()
  const ids = Array.from(new Set(bookingIds.filter((id) => typeof id === 'string' && id.length > 0)))
  if (ids.length === 0) return flagged

  try {
    const admin = db ?? createAdminClient()
    for (let start = 0; start < ids.length; start += CHUNK) {
      const { data, error } = await admin
        .from('booking_preorder_covers')
        .select('table_booking_id')
        .in('table_booking_id', ids.slice(start, start + CHUNK))
        .eq('has_allergies', true)
      if (error) throw new Error(error.message || 'Seat allergy read failed')
      for (const row of (data ?? []) as Array<{ table_booking_id?: unknown }>) {
        if (typeof row.table_booking_id === 'string') flagged.add(row.table_booking_id)
      }
    }
  } catch (error) {
    // Counts only: never the guests or what they are allergic to.
    logger.error('Could not read which bookings have a guest allergy', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingCount: ids.length },
    })
    return new Set<string>()
  }

  return flagged
}
