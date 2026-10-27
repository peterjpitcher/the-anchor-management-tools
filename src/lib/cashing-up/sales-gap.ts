/**
 * The gap between till sales and takings at cash-up (BK-119, customer bookings review of 24
 * October 2026; owner decision D33).
 *
 * Since June, sales beat takings by £1 or more on 64 of 137 days, and nobody said why: deposits
 * set against a bill, prepaid tickets, vouchers, private-hire money paid by bank and real losses
 * all looked the same. The owner decided staff write a note at cash-up for any gap over £5.
 * Pure, so the daily screen and the submit action apply the same rule.
 */

/** A gap above this, either way, needs a note before the cash-up is submitted (D33). */
export const CASHUP_SALES_GAP_NOTE_THRESHOLD = 5

type GapInput = {
  paymentBreakdowns: Array<{ countedAmount: number }>
  salesBreakdowns?: Array<{ amount: number }> | null
}

/**
 * Till sales less takings, to the penny: positive when sales beat takings. Null when no sales split
 * was entered, so there is nothing to compare.
 */
export function cashupSalesGap(input: GapInput): number | null {
  const sales = (input.salesBreakdowns ?? []).reduce((total, line) => total + (Number(line.amount) || 0), 0)
  if (!(sales > 0)) return null
  const takings = input.paymentBreakdowns.reduce((total, line) => total + (Number(line.countedAmount) || 0), 0)
  return Math.round((sales - takings) * 100) / 100
}

export function needsSalesGapNote(gap: number | null): boolean {
  return gap !== null && Math.abs(gap) > CASHUP_SALES_GAP_NOTE_THRESHOLD
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/** What staff are told when a gap needs a note: which way, and by how much. */
export function salesGapNoteMessage(gap: number): string {
  const direction = gap >= 0 ? 'Till sales are' : 'Takings are'
  return `${direction} ${money(Math.abs(gap))} more than ${gap >= 0 ? 'takings' : 'till sales'}. Say why in the notes before submitting (any gap over ${money(CASHUP_SALES_GAP_NOTE_THRESHOLD)}).`
}
