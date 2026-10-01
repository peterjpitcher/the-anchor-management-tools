/**
 * How payments are grouped by vendor in the workspace list. Pure, and shared by the server (which
 * totals each group across every matching payment) and the list (which draws the groups), so the
 * two always mean the same group.
 */

export const MISSING_VENDOR_LABEL = 'Missing vendor'

/** The heading a payment sits under: its vendor's name, or "Missing vendor". */
export function vendorGroupLabel(vendorName: string | null | undefined): string {
  return vendorName?.trim() || MISSING_VENDOR_LABEL
}

/** The key two payments share when they belong to the same group. Case does not split a vendor. */
export function vendorGroupKey(vendorName: string | null | undefined): string {
  return vendorGroupLabel(vendorName).toLocaleLowerCase('en-GB')
}

export type VendorGroupTotal = {
  /** Payments in the group across every page, not only the one on screen. */
  count: number
  totalIn: number
  totalOut: number
  totalAmount: number
}

/** A payment's value for totals and the heat colours: the total, or in plus out. */
export function paymentValue(payment: {
  amount_in?: number | string | null
  amount_out?: number | string | null
  amount_total?: number | string | null
}): number {
  const amountIn = Number(payment.amount_in ?? 0)
  const amountOut = Number(payment.amount_out ?? 0)
  return Number(payment.amount_total ?? amountIn + amountOut)
}

/** Totals for every vendor group in a set of payments. */
export function totalVendorGroups(
  payments: ReadonlyArray<{
    vendor_name?: string | null
    amount_in?: number | string | null
    amount_out?: number | string | null
    amount_total?: number | string | null
  }>
): Record<string, VendorGroupTotal> {
  const totals: Record<string, VendorGroupTotal> = {}
  for (const payment of payments) {
    const key = vendorGroupKey(payment.vendor_name)
    const total = totals[key] ?? { count: 0, totalIn: 0, totalOut: 0, totalAmount: 0 }
    total.count += 1
    total.totalIn += Number(payment.amount_in ?? 0)
    total.totalOut += Number(payment.amount_out ?? 0)
    total.totalAmount += paymentValue(payment)
    totals[key] = total
  }
  return totals
}
