// ---------------------------------------------------------------------------
// What counts toward rota hours and cost.
//
// This is deliberately a POSITIVE rule: only `scheduled` rows count. It is not
// an exclusion list, because an exclusion list silently re-opens the bug every
// time a new status is added. A "couldn't work" absence marker is stored as a
// 00:00:00 row with status `sick`, and the old `status !== 'cancelled'` filters
// happily added it to the weekly total and costed it.
//
// Absence and cancelled rows stay visible on screen. They just never contribute
// to a number.
//
// Pure and client-safe: no server imports, no React.
// ---------------------------------------------------------------------------

/** The only shift status that contributes to hours and cost. */
export const COUNTING_SHIFT_STATUS = 'scheduled';

/** The shape any counting decision needs. Rota shifts and published snapshot
 *  rows both satisfy it. */
export interface CountableShift {
  status: string | null | undefined;
}

/**
 * Whether this shift contributes to scheduled hours.
 *
 * Unknown, missing or future statuses return false by design: a row only counts
 * when it is positively known to be a scheduled shift.
 */
export function countsTowardHours(shift: CountableShift): boolean {
  return shift.status === COUNTING_SHIFT_STATUS;
}

/**
 * Whether this shift contributes to estimated labour cost.
 *
 * Identical to countsTowardHours today. It is a separate function so cost can
 * gain its own rule later (open shifts, say) without anyone having to work out
 * whether the hours total was meant to move with it.
 */
export function countsTowardCost(shift: CountableShift): boolean {
  return countsTowardHours(shift);
}
