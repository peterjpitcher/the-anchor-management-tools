/**
 * Where "back" goes from a booking's sheet. The shared FOH login may not open the booking page
 * itself (it is sent away from it), so it goes back to the floor screen; everyone else goes back
 * to the booking. Its own function so the FOH containment test can pin it.
 */
export function bookingSheetBackButton(fohOnly: boolean, bookingId: string): { label: string; href: string } {
  return fohOnly
    ? { label: 'Back to Front of House', href: '/table-bookings/foh' }
    : { label: 'Back to the booking', href: `/table-bookings/${bookingId}` }
}
