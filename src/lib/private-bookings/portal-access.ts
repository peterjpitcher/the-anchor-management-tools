import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { readBookingToken } from './booking-token'

/**
 * Whether a private booking portal link still opens the booking (BK-204).
 *
 * The signed link proves which booking it is for and that it has not expired. Staff can also
 * switch off every link a booking has had (private_bookings.portal_links_revoked_at), for a link
 * that was forwarded or leaked: a link issued before that moment is refused, one issued after it
 * works. Links from before issue times were kept carry none, and count as issued before.
 *
 * Returns the booking id, or null for a link that does not open the booking. Throws when the
 * booking cannot be read, so an outage is shown as one and not as a bad link.
 */
export async function verifyPortalAccess(token: string): Promise<string | null> {
  const verified = readBookingToken(token)
  if (!verified) return null

  const { data, error } = await createAdminClient()
    .from('private_bookings')
    .select('id, portal_links_revoked_at')
    .eq('id', verified.bookingId)
    .maybeSingle()
  if (error) {
    // Until migration 20261029083100 is applied the column does not exist. The link then works as
    // it always has (signature and expiry), rather than every guest's link failing.
    if (/portal_links_revoked_at/.test(error.message ?? '')) return verified.bookingId
    throw new Error(`Could not check the booking link: ${error.message}`)
  }
  if (!data) return null

  const revokedAt = data.portal_links_revoked_at ? Date.parse(data.portal_links_revoked_at as string) : null
  if (revokedAt !== null && Number.isFinite(revokedAt)) {
    // To the millisecond, as the link carries it. A link issued at or before the switch-off is
    // refused; the replacement is issued strictly after it (generateBookingToken, issuedAfterMs).
    if (verified.issuedAt === null || verified.issuedAt <= revokedAt) return null
  }
  return verified.bookingId
}
