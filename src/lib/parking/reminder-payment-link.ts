import type { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl } from '@/lib/env'
import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { parkingGuestUrl, parkingPaymentReturnUrl } from '@/lib/parking/public-links'
import type { ParkingBooking } from '@/types/parking'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * The payment link a reminder text carries. Every reminder carries a real link: after a repriced
 * change there may be no pending payment, and the text used to say "We'll text your payment link
 * shortly" with nothing following. Uses the pending payment's link, or makes a new order when
 * there is none. Returns null (the caller skips the text and counts an error) when no link can be
 * had, including when the pending payment cannot be read: making an order then could leave a
 * second live link beside one we could not see.
 */
export async function ensurePendingPaymentLink(
  supabase: AdminClient,
  booking: Pick<ParkingBooking, 'id' | 'reference' | 'start_at' | 'end_at' | 'calculated_price' | 'override_price' | 'payment_due_at'>
): Promise<string | null> {
  const { data, error } = await supabase
    .from('parking_booking_payments')
    .select('metadata')
    .eq('booking_id', booking.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Failed to lookup parking payment metadata', booking.id, error)
    return null
  }

  const existing = (data?.metadata as { approve_url?: string } | null)?.approve_url
  if (existing) return existing

  try {
    const appUrl = getAppUrl()
    const order = await createParkingPaymentOrder(booking as ParkingBooking, {
      returnUrl: parkingPaymentReturnUrl(appUrl, booking.id),
      cancelUrl: parkingGuestUrl(appUrl, booking.id, 'cancelled'),
      client: supabase,
    })
    return order.approveUrl || null
  } catch (orderError) {
    console.error('Failed to make a parking payment link for a reminder', booking.id, orderError)
    return null
  }
}
