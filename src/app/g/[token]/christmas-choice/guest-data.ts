/**
 * What one guest's own food link may see and change: their seat on one booking, nothing else.
 *
 * The link is a `preorder_guest` token (`resolvePreorderGuestToken`), scoped to one seat and expiring
 * at the cutoff. A manage link, or any other token, is refused here, because a manage link reaches the
 * whole booking and this page must never be a way in to it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPreorderEnabled, loadPreorderOrder } from '@/lib/table-bookings/preorder'
import { resolvePreorderGuestToken } from '@/lib/table-bookings/preorder-guest-token'
import type { PreorderCover, PreorderOrder } from '@/types/preorders'

type Db = SupabaseClient<any, 'public', any>

export type GuestChoiceBlockReason = 'invalid_token' | 'expired_token' | 'booking_closed' | 'switched_off' | 'seat_missing'

export type GuestChoiceContext =
  | {
      ok: true
      order: PreorderOrder
      cover: PreorderCover
      startDateTime: string | null
    }
  | { ok: false; reason: GuestChoiceBlockReason }

export async function loadGuestChoiceContext(supabase: Db, rawToken: string, now: Date = new Date()): Promise<GuestChoiceContext> {
  const resolved = await resolvePreorderGuestToken(supabase, rawToken, now)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }

  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select('id, status, customer_id, start_datetime')
    .eq('id', resolved.tableBookingId)
    .maybeSingle()
  if (error) throw error
  const row = booking as { id: string; status: string | null; customer_id: string | null; start_datetime: string | null } | null
  if (!row || row.customer_id !== resolved.customerId) return { ok: false, reason: 'invalid_token' }
  if (row.status === 'cancelled' || row.status === 'no_show') return { ok: false, reason: 'booking_closed' }

  if (!(await isPreorderEnabled(supabase))) return { ok: false, reason: 'switched_off' }

  const order = await loadPreorderOrder(supabase, resolved.tableBookingId)
  if (!order || !order.hasGuestSeats || !order.courseCounts) return { ok: false, reason: 'booking_closed' }

  // The seat the link names, still on this booking. A guest who has since been taken off the party
  // has no seat, and is told so rather than shown someone else's.
  const cover = order.covers.find((entry) => entry.id === resolved.coverId)
  if (!cover || cover.ordinal > order.partySize) return { ok: false, reason: 'seat_missing' }

  return { ok: true, order, cover, startDateTime: row.start_datetime }
}
