/**
 * Pure presentation helpers for private-booking line items.
 *
 * These exist so the contract's schedule page can be reasoned about and tested
 * without rendering 800 lines of HTML. Nothing here emits markup or escapes
 * anything: the caller owns escaping, because it owns the output format.
 *
 * Money rules live in `./vat.ts` and are not duplicated here. In particular
 * `line_total` is a stored generated column clamped with GREATEST(0, ...), so
 * the applied discount is always derived from the line, never read from
 * `discount_value`. See supabase/migrations/20260629000001_clamp_line_total_nonnegative.sql.
 */

import type {
  ItemType,
  PricingModel,
  PrivateBookingItem,
  VendorServiceType,
} from '@/types/private-bookings'

/**
 * Customer-facing wording for a vendor's service type. Shared with the vendor
 * settings screen so the contract and the admin UI never name the same supplier
 * type differently.
 */
export const VENDOR_SERVICE_TYPE_LABELS: Record<VendorServiceType, string> = {
  dj: 'DJ',
  band: 'Band',
  photographer: 'Photographer',
  florist: 'Florist',
  decorator: 'Decorator',
  cake: 'Cake',
  entertainment: 'Entertainment',
  transport: 'Transport',
  equipment: 'Equipment Rental',
  other: 'Other',
}

/** Group headings on the contract schedule, in print order. */
export const GROUP_LABELS: Record<ItemType, string> = {
  space: 'Venue hire',
  catering: 'Food and drink',
  vendor: 'Suppliers and entertainment',
  other: 'Other charges',
}

/** Print order for the groups above. Empty groups are omitted by the caller. */
export const GROUP_ORDER: ItemType[] = ['space', 'catering', 'vendor', 'other']

/** Shown in place of a number that is missing or not a number. */
export const NOT_RECORDED = 'Not recorded'

/**
 * PostgREST returns numeric(10,2) as a string such as "5.00", while the
 * TypeScript type declares `number`. Every numeric field must go through this
 * or `formatCurrency` throws `amount.toFixed is not a function` and takes the
 * whole contract render down.
 */
export function toNum(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw)
  return Number.isFinite(n) ? n : null
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * "5.00" renders 5, "2.50" renders 2.5. The column is numeric(10,2), so 2dp is
 * the true precision and rounding only strips float noise.
 */
export function formatQuantityNumber(raw: unknown): string | null {
  const n = toNum(raw)
  if (n === null) return null
  return String(round2(n))
}

type QuantityWording = {
  /** e.g. "5 hours", or NOT_RECORDED when the quantity is unusable */
  text: string
  /** Singular or plural noun, null when the quantity is unusable */
  noun: string | null
  /** e.g. "per hour", always present so the columns stay uniform */
  unitSuffix: string
}

const CATERING_NOUNS: Partial<Record<PricingModel, { one: string; many: string; suffix: string }>> = {
  per_head: { one: 'guest', many: 'guests', suffix: 'per guest' },
  per_tray: { one: 'tray', many: 'trays', suffix: 'per tray' },
  per_jar: { one: 'jar', many: 'jars', suffix: 'per jar' },
  free: { one: 'guest', many: 'guests', suffix: 'per guest' },
  menu_priced: { one: 'guest', many: 'guests', suffix: 'per guest' },
  variable: { one: 'guest', many: 'guests', suffix: 'per guest' },
}

const CATERING_DEFAULT = { one: 'guest', many: 'guests', suffix: 'per guest' }

/**
 * Quantity noun and unit-price suffix for a line.
 *
 * Space quantity means hours (verified against 25 production rows on
 * 2026-08-04: every one is a number of hours, rounded up from the booking
 * duration). Catering quantity means guests in the staff mental model, except
 * for the tray, jar and whole-package pricing models.
 *
 * A missing join never changes the wording: `item_type` is a safe discriminator
 * because chk_item_references forces the FK pattern per type and all three FKs
 * are ON DELETE RESTRICT, so a dangling reference is impossible.
 */
export function quantityWording(item: PrivateBookingItem): QuantityWording {
  const qty = toNum(item.quantity)
  const isOne = qty !== null && round2(qty) === 1

  let one: string
  let many: string
  let suffix: string

  switch (item.item_type) {
    case 'space':
      one = 'hour'
      many = 'hours'
      suffix = 'per hour'
      break
    case 'catering': {
      const model = item.package?.pricing_model
      if (model === 'total_value') {
        one = 'package'
        many = 'packages'
        suffix = isOne ? 'for the package' : 'per package'
      } else {
        const nouns = (model && CATERING_NOUNS[model]) || CATERING_DEFAULT
        one = nouns.one
        many = nouns.many
        suffix = nouns.suffix
      }
      break
    }
    case 'vendor':
      one = 'service'
      many = 'services'
      suffix = 'each'
      break
    default:
      one = 'item'
      many = 'items'
      suffix = 'each'
      break
  }

  const formatted = formatQuantityNumber(item.quantity)
  if (formatted === null) {
    return { text: NOT_RECORDED, noun: null, unitSuffix: suffix }
  }

  const noun = isOne ? one : many
  return { text: `${formatted} ${noun}`, noun, unitSuffix: suffix }
}

/** Convenience wrapper: just the "per hour" / "each" part. */
export function unitPriceSuffix(item: PrivateBookingItem): string {
  return quantityWording(item).unitSuffix
}

/**
 * The name to print. Prefers the joined record, because `item.description` is a
 * snapshot taken at add time and is never editable afterwards, so it goes stale
 * on rename. Each contract generation mints a new version and stores an
 * immutable snapshot, so nothing historical is lost. The internal event sheet
 * already resolves names the same way.
 */
export function itemDisplayName(item: PrivateBookingItem): string {
  const fallback = (item.description || '').trim()

  switch (item.item_type) {
    case 'space':
      return (item.space?.name || '').trim() || fallback
    case 'catering':
      return (item.package?.name || '').trim() || fallback
    case 'vendor': {
      const name = (item.vendor?.name || '').trim()
      if (!name) return fallback
      const serviceType = item.vendor?.service_type
      // "other" tells the customer nothing, so it gets no bracketed qualifier.
      // Deliberate divergence from the settings screen label.
      if (!serviceType || serviceType === 'other') return name
      const label = VENDOR_SERVICE_TYPE_LABELS[serviceType]
      return label ? `${name} (${label})` : name
    }
    default:
      return fallback
  }
}

/**
 * Bracketed qualifier for catering priced at nil. Suppressed whenever the unit
 * price is above zero: a "free" package with a real price is contradictory
 * data, so trust the money and say nothing.
 */
export function cateringZeroPriceQualifier(item: PrivateBookingItem): string | null {
  if (item.item_type !== 'catering') return null
  const unitPrice = toNum(item.unit_price)
  if (unitPrice === null || round2(unitPrice) !== 0) return null

  switch (item.package?.pricing_model) {
    case 'free':
      return 'included at no charge'
    case 'menu_priced':
      return 'priced from the menu'
    case 'variable':
      return 'price to be confirmed'
    default:
      return null
  }
}

/**
 * The discount phrase for a line, or null when no discount should be shown.
 *
 * Gated on three conditions, not one. The generated column has an ELSE arm, so
 * a stored `discount_value` with a null `discount_type` applies NO discount:
 * printing one would state a discount the line total does not reflect.
 * Production has 18 space items marked 'percent' against only 16 with a value
 * above zero.
 *
 * The amount printed for a fixed discount is always the derived effective
 * amount, never the stored value, because GREATEST(0, ...) clamps a discount
 * larger than the line.
 */
export function discountPhrase(
  item: PrivateBookingItem,
  base: number,
  lineTotal: number,
): string | null {
  const storedValue = toNum(item.discount_value) ?? 0
  if (storedValue <= 0) return null
  if (item.discount_type !== 'percent' && item.discount_type !== 'fixed') return null

  // An impossible line (zero or negative base) should look odd, not balanced.
  if (base <= 0) return null

  const effective = round2(base - lineTotal)
  if (effective <= 0) return null

  if (item.discount_type === 'percent') {
    const pct = String(round2(storedValue))
    return round2(storedValue) === 100
      ? '100% discount applied (included at no charge)'
      : `${pct}% discount applied`
  }

  return `£${effective.toFixed(2)} discount applied`
}

export function itemGroup(item: PrivateBookingItem): ItemType {
  return GROUP_ORDER.includes(item.item_type) ? item.item_type : 'other'
}
