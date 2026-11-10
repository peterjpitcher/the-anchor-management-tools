/**
 * Turns a private booking into invoice line items and header totals.
 *
 * This is the readable, unit-testable half of the invoice feature. The
 * transactional half lives in the `create_private_booking_invoice_atomic`
 * Postgres function, which re-checks the total this file produces against
 * `get_booking_gross_total` and refuses to write anything if they differ.
 *
 * Three rules drive everything here:
 *
 * 1. The invoice total MUST equal the booking's gross total to the penny. The
 *    customer already holds that figure on their signed contract and has been
 *    sent it by SMS. `computeBookingMoney` is the single source of that number
 *    (and mirrors the SQL functions), so the header total is taken from it
 *    directly. Spreading a fixed discount and rounding VAT per line can leave
 *    the printed lines a few pence out; those pence go on the largest line,
 *    and the header net and VAT are taken from the lines as printed, so they
 *    may differ from the contract's split by a penny while the total matches.
 *
 * 2. Discounts should stay visible where possible. Room hire is routinely
 *    given away at 100% off, and a customer seeing "100% off, £0.00" is being
 *    shown value they would otherwise never know they received. So an
 *    item-level percentage discount is carried as the line's
 *    `discount_percentage` rather than folded into the price.
 *
 * 3. Exactness beats prettiness. Where a discount cannot be represented on a
 *    line without penny drift (a fixed-amount discount that does not divide
 *    evenly by the quantity), the line collapses to a single unit at the exact
 *    net price and the detail moves into the description. Never ship a line
 *    that does not sum to the invoice total.
 */

import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'
import { computeBookingMoney, DEFAULT_VAT_RATE, itemLineTotal } from '@/lib/private-bookings/vat'
import { GROUP_LABELS, itemDisplayName, toNum } from '@/lib/private-bookings/item-labels'
import type { PrivateBookingItem } from '@/types/private-bookings'

/** A line item ready to be handed to create_private_booking_invoice_atomic. */
export interface MappedInvoiceLine {
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
  display_order: number
  catalog_item_id: null
}

export interface MappedInvoiceTotals {
  subtotal_amount: number
  discount_amount: number
  invoice_discount_percentage: number
  vat_amount: number
  total_amount: number
}

export interface InvoiceMappingResult {
  lineItems: MappedInvoiceLine[]
  totals: MappedInvoiceTotals
  /** Non-fatal notes worth showing the operator before they send. */
  warnings: string[]
}

export interface MappableBooking {
  items?: PrivateBookingItem[] | null
  discount_type?: 'percent' | 'fixed' | null
  discount_amount?: number | null
}

export class InvoiceMappingError extends Error {
  readonly code: string
  readonly detail: Record<string, unknown>

  constructor(code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.name = 'InvoiceMappingError'
    this.code = code
    this.detail = detail
  }
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Pennies, so comparisons are integer-exact rather than float-fuzzy. */
const pence = (n: number): number => Math.round((n + Number.EPSILON) * 100)

/**
 * Build the customer-facing description.
 *
 * `itemDisplayName` already resolves the space, package or vendor name and
 * falls back to the free-text description, so this only adds the category
 * prefix that tells a customer what kind of charge it is.
 */
function buildDescription(item: PrivateBookingItem): string {
  const group = GROUP_LABELS[item.item_type] ?? 'Other charges'
  const name = itemDisplayName(item)
  return name.startsWith(group) ? name : `${group}: ${name}`
}

/**
 * Represent one booking item as an invoice line whose net, after the line's
 * own discount, is exactly `targetNet`.
 *
 * Preferred shape keeps the real quantity and unit price so the customer can
 * see "20 @ £16.00". That is only used when it reproduces `targetNet` to the
 * penny. Otherwise the line collapses to one unit priced at `targetNet`, and
 * the quantity detail moves into the description so nothing is lost.
 */
function buildLine(
  item: PrivateBookingItem,
  targetNet: number,
  displayOrder: number,
  warnings: string[],
): MappedInvoiceLine {
  const description = buildDescription(item)
  const vatRate = toNum(item.vat_rate) ?? DEFAULT_VAT_RATE
  const quantity = toNum(item.quantity) ?? 0
  const unitPrice = toNum(item.unit_price) ?? 0
  const discountType = item.discount_type ?? null
  const discountValue = toNum(item.discount_value) ?? 0

  // Best: keep quantity, unit price and the discount exactly as booked, so the
  // customer sees "4 hrs @ £25.00, 100% off". Only valid when it reproduces
  // the target to the penny.
  if (quantity > 0 && unitPrice > 0) {
    const percentage = discountType === 'percent' && discountValue > 0 ? discountValue : 0
    const net = quantity * unitPrice * (1 - percentage / 100)

    if (pence(net) === pence(targetNet)) {
      return {
        description,
        quantity,
        unit_price: unitPrice,
        discount_percentage: percentage,
        vat_rate: vatRate,
        display_order: displayOrder,
        catalog_item_id: null,
      }
    }
  }

  // Next best: keep the quantity but restate the unit price, so a per-head or
  // per-hour charge still reads as one. Used when a discount has to be folded
  // into the price and happens to divide evenly.
  if (quantity > 0) {
    const scaled = round2(targetNet / quantity)
    if (pence(quantity * scaled) === pence(targetNet)) {
      return {
        description,
        quantity,
        unit_price: scaled,
        discount_percentage: 0,
        vat_rate: vatRate,
        display_order: displayOrder,
        catalog_item_id: null,
      }
    }
  }

  // Last resort: one unit at the exact net, detail preserved in the description.
  const parts: string[] = []
  if (quantity > 0 && unitPrice > 0) {
    parts.push(`${formatQuantity(quantity)} at ${formatMoney(unitPrice)}`)
  }
  if (discountValue > 0) {
    parts.push(
      discountType === 'percent'
        ? `less ${formatQuantity(discountValue)}% discount`
        : `less ${formatMoney(discountValue)} discount`,
    )
  }

  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  warnings.push(
    `"${description}" is shown as a single charge because its discount does not divide evenly.`,
  )

  return {
    description: `${description}${suffix}`,
    quantity: 1,
    unit_price: round2(targetNet),
    discount_percentage: 0,
    vat_rate: vatRate,
    display_order: displayOrder,
    catalog_item_id: null,
  }
}

function formatQuantity(n: number): string {
  return Number.isInteger(n) ? String(n) : String(round2(n))
}

function formatMoney(n: number): string {
  return `£${round2(n).toFixed(2)}`
}

/**
 * Map a booking to invoice lines and totals.
 *
 * Throws `InvoiceMappingError` rather than returning a best guess. A private
 * booking invoice that does not match the signed contract is worse than no
 * invoice at all, because the customer has already been told the figure.
 */
export function mapBookingToInvoice(booking: MappableBooking): InvoiceMappingResult {
  const warnings: string[] = []
  const items = (booking.items ?? []).slice()

  if (items.length === 0) {
    throw new InvoiceMappingError('booking_has_no_priced_items', 'This booking has no items.')
  }

  items.sort((a, b) => {
    const orderA = toNum(a.display_order) ?? 0
    const orderB = toNum(b.display_order) ?? 0
    if (orderA !== orderB) return orderA - orderB
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  })

  // The authoritative figures. Everything below must reconcile to these.
  const money = computeBookingMoney(
    items.map(item => ({
      quantity: toNum(item.quantity) ?? 0,
      unit_price: toNum(item.unit_price) ?? 0,
      line_total: toNum(item.line_total),
      vat_rate: toNum(item.vat_rate),
      discount_type: item.discount_type ?? null,
      discount_value: toNum(item.discount_value),
    })),
    booking.discount_type ?? null,
    booking.discount_amount ?? null,
  )

  if (money.grossTotal <= 0) {
    throw new InvoiceMappingError(
      'booking_has_no_priced_items',
      'This booking has no priced items to invoice.',
    )
  }

  // A booking-level percentage discount maps exactly onto the invoice's own
  // discount field, so the customer sees it called out. A fixed-amount
  // discount does not: converting it to a percentage is capped at two decimals
  // and drifts, so it is spread across the lines instead and explained in the
  // notes.
  const bookingDiscountType = booking.discount_type ?? null
  const bookingDiscountValue = toNum(booking.discount_amount) ?? 0
  const usesInvoiceDiscount = bookingDiscountType === 'percent' && bookingDiscountValue > 0

  const spreadFactor =
    !usesInvoiceDiscount && money.netTotal > 0 ? money.discountedNet / money.netTotal : 1

  if (bookingDiscountType === 'fixed' && bookingDiscountValue > 0) {
    warnings.push(
      `The ${formatMoney(bookingDiscountValue)} booking discount is spread across the lines rather than shown separately.`,
    )
  }

  const lineItems = items.map((item, index) => {
    const net = itemLineTotal({
      quantity: toNum(item.quantity) ?? 0,
      unit_price: toNum(item.unit_price) ?? 0,
      line_total: toNum(item.line_total),
      vat_rate: toNum(item.vat_rate),
      discount_type: item.discount_type ?? null,
      discount_value: toNum(item.discount_value),
    })
    return buildLine(item, net * spreadFactor, index + 1, warnings)
  })

  // Spreading a fixed discount, and rounding VAT line by line, can leave the
  // printed lines a few pence away from the contract total even though every
  // line is right to the penny on its own. Absorb that rounding in the largest
  // line rather than refusing an invoice the customer is owed.
  const reconciled = absorbRoundingDifference(
    lineItems,
    money.grossTotal,
    usesInvoiceDiscount ? bookingDiscountValue : 0,
    warnings,
  )

  // The guard. `calculateInvoiceTotals` is what the PDF uses to render the line
  // table, so if it disagrees with the header we would print an invoice whose
  // lines do not sum to its own total. Refuse rather than send that.
  const rendered = renderLines(reconciled, usesInvoiceDiscount ? bookingDiscountValue : 0)

  if (pence(rendered.totalAmount) !== pence(money.grossTotal)) {
    throw new InvoiceMappingError(
      'invoice_total_reconciliation_failed',
      'The invoice lines do not add up to the booking total, so no invoice was created.',
      {
        bookingGrossTotal: money.grossTotal,
        renderedTotal: rendered.totalAmount,
        differencePence: pence(rendered.totalAmount) - pence(money.grossTotal),
      },
    )
  }

  // Header figures come from the lines as printed, so the invoice's own net,
  // discount and VAT always agree with its line table. The total is the
  // booking's gross total, which the database re-checks.
  const totals: MappedInvoiceTotals = {
    subtotal_amount: round2(rendered.subtotalBeforeInvoiceDiscount),
    discount_amount: round2(rendered.invoiceDiscountAmount),
    invoice_discount_percentage: usesInvoiceDiscount ? bookingDiscountValue : 0,
    vat_amount: rendered.vatAmount,
    total_amount: money.grossTotal,
  }

  return { lineItems: reconciled, totals, warnings }
}

function renderLines(lines: MappedInvoiceLine[], invoiceDiscountPercentage: number) {
  return calculateInvoiceTotals(
    lines.map(line => ({
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount_percentage: line.discount_percentage,
      vat_rate: line.vat_rate,
    })),
    invoiceDiscountPercentage,
  )
}

/** Net of a line after its own discount, before any invoice-level discount. */
function lineNet(line: MappedInvoiceLine): number {
  return line.quantity * line.unit_price * (1 - line.discount_percentage / 100)
}

/**
 * Restate a line as one unit at its exact net, keeping the detail in the
 * description, so its price can move by a penny without inventing a unit price.
 */
function asSingleCharge(line: MappedInvoiceLine): MappedInvoiceLine {
  if (line.quantity === 1 && line.discount_percentage === 0) return line
  const parts = [`${formatQuantity(line.quantity)} at ${formatMoney(line.unit_price)}`]
  if (line.discount_percentage > 0) {
    parts.push(`less ${formatQuantity(line.discount_percentage)}% discount`)
  }
  return {
    ...line,
    description: `${line.description} (${parts.join(', ')})`,
    quantity: 1,
    unit_price: round2(lineNet(line)),
    discount_percentage: 0,
  }
}

/** Furthest a line is moved, in pence. Real drift is a few pence at most. */
const MAX_ADJUSTMENT_PENCE = 25

/**
 * Make the printed lines total exactly `grossTotal` by moving the largest line
 * (and, if one line alone cannot land on the figure, the next largest by a
 * penny or two) by the fewest pence.
 *
 * Two lines are sometimes needed because VAT is rounded per line: moving one
 * line's net by a penny moves its gross by 1p or 2p, so a single line can step
 * over the target. Returns the lines unchanged when they already reconcile,
 * and unchanged when no small adjustment works (the caller then refuses).
 */
function absorbRoundingDifference(
  lines: MappedInvoiceLine[],
  grossTotal: number,
  invoiceDiscountPercentage: number,
  warnings: string[],
): MappedInvoiceLine[] {
  const target = pence(grossTotal)
  const totalOf = (candidate: MappedInvoiceLine[]) =>
    pence(renderLines(candidate, invoiceDiscountPercentage).totalAmount)

  if (totalOf(lines) === target) return lines

  const bySize = lines
    .map((line, index) => ({ index, net: lineNet(line) }))
    .filter(entry => entry.net > 0)
    .sort((a, b) => b.net - a.net)
    .map(entry => entry.index)

  if (bySize.length === 0) return lines

  const [first, second] = bySize
  const firstDeltas = penceSearchOrder(MAX_ADJUSTMENT_PENCE)
  const secondDeltas = second === undefined ? [0] : penceSearchOrder(2)

  const firstBase = asSingleCharge(lines[first])
  const secondBase = second === undefined ? null : asSingleCharge(lines[second])

  for (const secondDelta of secondDeltas) {
    for (const firstDelta of firstDeltas) {
      const firstPrice = round2(firstBase.unit_price + firstDelta / 100)
      if (firstPrice < 0) continue

      // The candidate is exactly what gets returned, so what was checked is
      // what is sent. An untouched second line keeps its natural shape.
      const candidate = lines.slice()
      candidate[first] = { ...firstBase, unit_price: firstPrice }

      if (second !== undefined && secondBase && secondDelta !== 0) {
        const secondPrice = round2(secondBase.unit_price + secondDelta / 100)
        if (secondPrice < 0) continue
        candidate[second] = { ...secondBase, unit_price: secondPrice }
      }

      if (totalOf(candidate) !== target) continue

      const moved = [first, ...(second !== undefined && secondDelta !== 0 ? [second] : [])]
      for (const index of moved) {
        warnings.push(
          `"${lines[index].description}" carries a rounding adjustment of a few pence so the invoice matches the contract total.`,
        )
      }
      return candidate
    }
  }

  return lines
}

/** 0, -1, 1, -2, 2 ... up to the limit, so the smallest move is tried first. */
function penceSearchOrder(limit: number): number[] {
  const order = [0]
  for (let step = 1; step <= limit; step++) order.push(-step, step)
  return order
}
