// The discount actually given when a percentage voucher is redeemed (spec
// tasks/spec-2026-11-02-table-booking-return-visits.md, section 6.2). A percentage voucher's
// value_pence is only a liability estimate, so cash-up uses this amount when staff record it.

// Matches the voucher_redeem check: 0 to 10,000 pounds.
export const MAX_DISCOUNT_GIVEN_PENCE = 1_000_000

export type DiscountGivenParse =
  | { ok: true; pence: number | null }
  | { ok: false; error: string }

/**
 * Turns what staff typed ("12", "12.5", "£12.50") into whole pence. Blank means not recorded.
 * Anything else that is not a plain amount with at most two decimal places is refused rather
 * than guessed, because the figure lands in the day's cash-up.
 */
export function parseDiscountGiven(input: string): DiscountGivenParse {
  const cleaned = input.trim().replace(/^£\s*/, '')
  if (cleaned === '') {
    return { ok: true, pence: null }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: 'Enter the discount in pounds, for example 6.50' }
  }
  const [pounds, fraction = ''] = cleaned.split('.')
  const pence = Number(pounds) * 100 + Number(fraction.padEnd(2, '0'))
  if (pence > MAX_DISCOUNT_GIVEN_PENCE) {
    return { ok: false, error: 'That discount is too large. Check the amount.' }
  }
  return { ok: true, pence }
}

/**
 * The money a redeemed voucher cost: the recorded discount when there is one, otherwise the
 * type's estimate. Used by cash-up and the voucher overview.
 */
export function redeemedVoucherPence(voucher: {
  value_pence: number | null
  redeemed_value_pence?: number | null
}): number {
  return Number(voucher.redeemed_value_pence ?? voucher.value_pence ?? 0)
}
