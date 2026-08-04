/**
 * Mint a booking-management link for one table booking, and print it.
 *
 * The link normally reaches a guest in their confirmation message, so a booking that has not been
 * confirmed yet has none. That makes a `pending_payment` booking impossible to open as the guest
 * sees it, which is exactly the booking you want when testing without taking money.
 *
 * Uses the same `createTableManageToken` the app uses, so what comes out is a real link with the
 * real expiry, not a special case that only works for staff.
 *
 *   npx tsx scripts/mint-manage-link.ts TB-C7976890
 *
 * The URL it prints is a bearer credential: anyone holding it can view and amend that booking until
 * it expires. Treat it like a password and do not paste it anywhere public.
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { createTableManageToken } from '../src/lib/table-bookings/manage-booking'

async function main(): Promise<void> {
  const reference = process.argv[2]
  if (!reference) {
    console.error('Usage: npx tsx scripts/mint-manage-link.ts <booking_reference>')
    process.exit(1)
  }

  const supabase = createAdminClient()

  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select('id, customer_id, booking_reference, booking_date, booking_time, party_size, status, start_datetime')
    .eq('booking_reference', reference)
    .maybeSingle()

  if (error) throw error
  if (!booking) {
    console.error(`No booking found with reference ${reference}`)
    process.exit(1)
  }
  if (!booking.customer_id) {
    console.error(`Booking ${reference} has no customer, so no manage link can be issued`)
    process.exit(1)
  }

  const token = await createTableManageToken(supabase, {
    customerId: booking.customer_id,
    tableBookingId: booking.id,
    bookingStartIso: booking.start_datetime ?? null,
  })

  console.warn(`Booking:  ${booking.booking_reference}  ${booking.booking_date} ${booking.booking_time}  party of ${booking.party_size}  (${booking.status})`)
  console.warn(`Expires:  ${token.expiresAt}`)
  console.warn(`Link:     ${token.url}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
