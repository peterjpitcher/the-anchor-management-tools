/**
 * Whether a FOH booking skips the arrival limits: kitchen pacing for food and the drinks arrivals
 * ceiling (both are p_bypass_pacing in create_table_booking_core_v06).
 *
 * Walk-ins and drinks never consume kitchen pacing: a walk-in is already standing at the bar, and
 * drinks add no kitchen covers. The FOH create route and the FOH free-times list both read this,
 * so the times staff are shown are the times that will save. A manager can also override pacing
 * for one advance food booking when saving it; that is a choice made on submit, not here.
 */
export function fohBookingBypassesPacing(input: { walkIn: boolean; purpose: string }): boolean {
  return input.walkIn || input.purpose === 'drinks'
}
