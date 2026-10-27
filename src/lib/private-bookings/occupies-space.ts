/**
 * Whether a private hire holds its room, so tables in that room come off sale.
 *
 * The same rule as `private_booking_occupies_space` in the database (migration
 * 20261026175212_private_hire_occupies_space), which the clash check, the table block and the
 * garden block all use. The app applies it itself only where it lists hires directly: the day load
 * (src/services/day-load.ts), the private hire night view and the event form's list of hires. The
 * FOH schedule now reads its blocks from the database (private_hire_table_blocks). Keep the two in
 * step.
 *
 * A confirmed hire holds its room. So does a draft whose deposit is paid (confirmation can be
 * blocked after payment, which clears the hold) or whose hold is still live. A hire whose date is
 * still to be confirmed never does: its date is a placeholder.
 */
export function privateBookingOccupiesSpace(
  booking: {
    status: string | null
    deposit_paid_date: string | null
    hold_expiry: string | null
    date_tbd: boolean | null
  },
  now: Date = new Date(),
): boolean {
  if (booking.date_tbd) return false
  if (booking.status === 'confirmed') return true
  if (booking.status !== 'draft') return false
  if (booking.deposit_paid_date) return true
  if (!booking.hold_expiry) return false
  const holdEnds = new Date(booking.hold_expiry).getTime()
  return Number.isFinite(holdEnds) && holdEnds > now.getTime()
}
