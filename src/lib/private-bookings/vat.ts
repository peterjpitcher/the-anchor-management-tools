/**
 * VAT-aware money maths for private bookings.
 *
 * Stored unit prices are NET (SOP 2026-07, owner-confirmed). Customer-facing
 * totals must show VAT and the VAT-inclusive amount payable. Booking-level
 * discounts apply to the net total before VAT; fixed discounts are spread
 * pro-rata across lines. This mirrors the SQL functions
 * `get_booking_vat_amount` / `get_booking_gross_total` — keep both in sync.
 */

export type VatableBookingItem = {
  quantity: number
  unit_price: number
  /** Generated in the DB; computed from quantity × unit_price (less item discount) when absent */
  line_total?: number | null
  vat_rate?: number | null
  discount_type?: 'percent' | 'fixed' | null
  discount_value?: number | null
}

export type BookingMoney = {
  /** Sum of line totals (net, after item-level discounts) */
  netTotal: number
  /** Net total after the booking-level discount */
  discountedNet: number
  /** VAT on the discounted net */
  vatAmount: number
  /** Amount payable by the customer: discounted net + VAT */
  grossTotal: number
}

export const DEFAULT_VAT_RATE = 20

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Mirror of the DB generated column: quantity × unit_price less item discount. */
export function itemLineTotal(item: VatableBookingItem): number {
  if (item.line_total !== undefined && item.line_total !== null) {
    return Number(item.line_total)
  }
  const base = Number(item.quantity) * Number(item.unit_price)
  const discountValue = Number(item.discount_value ?? 0)
  if (discountValue > 0) {
    if (item.discount_type === 'percent') {
      return Math.max(0, base * (1 - discountValue / 100))
    }
    if (item.discount_type === 'fixed') {
      return Math.max(0, base - discountValue)
    }
  }
  return base
}

export function computeBookingMoney(
  items: VatableBookingItem[],
  discountType?: 'percent' | 'fixed' | null,
  discountAmount?: number | null,
): BookingMoney {
  const netTotal = items.reduce((sum, item) => sum + itemLineTotal(item), 0)
  const vatRaw = items.reduce(
    (sum, item) => sum + itemLineTotal(item) * (Number(item.vat_rate ?? DEFAULT_VAT_RATE) / 100),
    0,
  )

  let factor = 1
  const discount = Number(discountAmount ?? 0)
  if (netTotal > 0 && discount > 0) {
    if (discountType === 'percent') {
      factor = Math.max(0, 1 - discount / 100)
    } else if (discountType === 'fixed') {
      factor = Math.max(0, netTotal - discount) / netTotal
    }
  }

  const discountedNet = netTotal <= 0 ? 0 : netTotal * factor
  const vatAmount = netTotal <= 0 ? 0 : round2(vatRaw * factor)
  const grossTotal = round2(round2(discountedNet) + vatAmount)

  return {
    netTotal: round2(netTotal),
    discountedNet: round2(discountedNet),
    vatAmount,
    grossTotal,
  }
}
