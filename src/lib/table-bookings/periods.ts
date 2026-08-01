/**
 * Seasonal booking periods: types, row mapping and the "is this period offerable" rule.
 *
 * A period is a manager-defined window (Christmas dinner, Mother's Day, Easter, Father's Day) with
 * its own dates, its own guest question, its own deposit and its own pre-order requirement.
 *
 * Two things here are load-bearing and easy to get wrong later:
 *
 *   1. `periodKind` is the stable value machinery matches on. `name` is free text the manager owns
 *      and may change to anything at any time. NOTHING may ever branch on the word "Christmas"
 *      appearing in a name.
 *   2. A period only reaches a guest when it is offerable: active, not archived, in date, and, when
 *      it requires a pre-order, carrying at least one live menu item. A period requiring a pre-order
 *      with an empty menu is NOT bookable, and the guest is told so plainly rather than being shown
 *      an empty menu to choose from.
 *
 * The database mirrors both rules (see supabase/migrations/20260803000100_seasonal_booking_periods.sql).
 * This module exists so the settings screen and the website endpoint agree with it without each
 * re-deriving the logic.
 */

export const PERIOD_KINDS = [
  'christmas',
  'mothers_day',
  'fathers_day',
  'easter',
  'new_year',
  'valentines',
  'other',
] as const

export type PeriodKind = (typeof PERIOD_KINDS)[number]

export const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  christmas: 'Christmas',
  mothers_day: "Mother's Day",
  fathers_day: "Father's Day",
  easter: 'Easter',
  new_year: 'New Year',
  valentines: "Valentine's Day",
  other: 'Other',
}

export const DEPOSIT_BASES = ['none', 'per_head', 'per_booking'] as const
export type DepositBasis = (typeof DEPOSIT_BASES)[number]

export const MENU_COURSES = ['starter', 'main', 'dessert', 'side', 'drink', 'other'] as const
export type MenuCourse = (typeof MENU_COURSES)[number]

export type BookingPeriodMenuItem = {
  id: string
  course: MenuCourse
  name: string
  description: string | null
  priceGbp: number | null
  allergens: string | null
  sortOrder: number
  isActive: boolean
}

export type BookingPeriod = {
  id: string
  code: string
  periodKind: PeriodKind
  name: string
  startsOn: string
  endsOn: string
  guestQuestion: string
  guestBlurb: string | null
  requiresPreorder: boolean
  preorderCutoffDays: number
  depositBasis: DepositBasis
  depositAmount: number
  refundCutoffDays: number
  minPartySize: number | null
  maxPartySize: number | null
  minNoticeHours: number
  legacyBookingType: string | null
  isActive: boolean
  archivedAt: string | null
  menuReady: boolean
  bookingCount: number
  menuItems: BookingPeriodMenuItem[]
}

/** Raw shape as returned by `get_booking_periods()` and by a direct select. */
export type BookingPeriodRow = {
  id: string
  code: string
  period_kind: string
  name: string
  starts_on: string
  ends_on: string
  guest_question: string
  guest_blurb: string | null
  requires_preorder: boolean
  preorder_cutoff_days: number
  deposit_basis: string
  deposit_amount: number | string
  refund_cutoff_days: number
  min_party_size: number | null
  max_party_size: number | null
  min_notice_hours: number
  legacy_booking_type: string | null
  is_active: boolean
  archived_at: string | null
  menu_ready?: boolean
  booking_count?: number
  menu_items?: BookingPeriodMenuItemRow[] | null
}

export type BookingPeriodMenuItemRow = {
  id: string
  course: string
  name: string
  description: string | null
  price_gbp: number | string | null
  allergens: string | null
  sort_order: number
  is_active: boolean
}

function toNumber(value: number | string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toPeriodKind(value: string): PeriodKind {
  return (PERIOD_KINDS as readonly string[]).includes(value) ? (value as PeriodKind) : 'other'
}

function toDepositBasis(value: string): DepositBasis {
  return (DEPOSIT_BASES as readonly string[]).includes(value) ? (value as DepositBasis) : 'none'
}

function toMenuCourse(value: string): MenuCourse {
  return (MENU_COURSES as readonly string[]).includes(value) ? (value as MenuCourse) : 'other'
}

export function mapMenuItemRow(row: BookingPeriodMenuItemRow): BookingPeriodMenuItem {
  return {
    id: row.id,
    course: toMenuCourse(row.course),
    name: row.name,
    description: row.description ?? null,
    priceGbp: toNullableNumber(row.price_gbp),
    allergens: row.allergens ?? null,
    sortOrder: toNumber(row.sort_order, 0),
    isActive: row.is_active !== false,
  }
}

/**
 * Manual snake_case to camelCase mapping. This project has no `fromDb<T>()` helper, deliberately:
 * every field is named here so a column rename cannot pass silently through a generic converter.
 */
export function mapBookingPeriodRow(row: BookingPeriodRow): BookingPeriod {
  const menuItems = (row.menu_items ?? []).map(mapMenuItemRow)
  const requiresPreorder = row.requires_preorder === true

  return {
    id: row.id,
    code: row.code,
    periodKind: toPeriodKind(row.period_kind),
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    guestQuestion: row.guest_question,
    guestBlurb: row.guest_blurb ?? null,
    requiresPreorder,
    preorderCutoffDays: toNumber(row.preorder_cutoff_days, 7),
    depositBasis: toDepositBasis(row.deposit_basis),
    depositAmount: toNumber(row.deposit_amount, 0),
    refundCutoffDays: toNumber(row.refund_cutoff_days, 7),
    minPartySize: toNullableNumber(row.min_party_size),
    maxPartySize: toNullableNumber(row.max_party_size),
    minNoticeHours: toNumber(row.min_notice_hours, 0),
    legacyBookingType: row.legacy_booking_type ?? null,
    isActive: row.is_active === true,
    archivedAt: row.archived_at ?? null,
    // Trust the database's own answer when it sent one; otherwise derive it from the items we have.
    menuReady:
      typeof row.menu_ready === 'boolean'
        ? row.menu_ready
        : !requiresPreorder || menuItems.some((item) => item.isActive),
    bookingCount: toNumber(row.booking_count, 0),
    menuItems,
  }
}

/** Why a period that exists is nonetheless not offerable to a guest right now. */
export type PeriodUnavailableReason = 'inactive' | 'archived' | 'out_of_range' | 'menu_not_ready'

export const PERIOD_UNAVAILABLE_MESSAGES: Record<PeriodUnavailableReason, string> = {
  inactive: 'This booking period is switched off.',
  archived: 'This booking period has been archived.',
  out_of_range: 'This booking period does not cover that date.',
  menu_not_ready:
    'The menu for this period has not been published yet, so it cannot be booked. Please give us a ring on 01753 682707.',
}

export type PeriodOfferability =
  | { offerable: true }
  | { offerable: false; reason: PeriodUnavailableReason; message: string }

/**
 * The single rule for "may this period be offered for this date". Mirrors the SQL in
 * `resolve_table_booking_deposit` and `booking_period_menu_ready`.
 *
 * An INACTIVE period is completely inert. That is what makes the seeded, unpublished Christmas
 * period safe to ship: it produces no question, no deposit and no availability effect until a
 * manager switches it on.
 */
export function getPeriodOfferability(period: BookingPeriod, bookingDate: string): PeriodOfferability {
  if (period.archivedAt) {
    return { offerable: false, reason: 'archived', message: PERIOD_UNAVAILABLE_MESSAGES.archived }
  }
  if (!period.isActive) {
    return { offerable: false, reason: 'inactive', message: PERIOD_UNAVAILABLE_MESSAGES.inactive }
  }
  if (bookingDate < period.startsOn || bookingDate > period.endsOn) {
    return { offerable: false, reason: 'out_of_range', message: PERIOD_UNAVAILABLE_MESSAGES.out_of_range }
  }
  if (period.requiresPreorder && !period.menuReady) {
    return { offerable: false, reason: 'menu_not_ready', message: PERIOD_UNAVAILABLE_MESSAGES.menu_not_ready }
  }
  return { offerable: true }
}

export function formatGbp(amount: number): string {
  return Number.isInteger(amount) ? `GBP ${amount}` : `GBP ${amount.toFixed(2)}`
}

/** A one-line description of the deposit, for the settings list and for staff-facing copy. */
export function describeDeposit(basis: DepositBasis, amount: number): string {
  if (basis === 'none' || amount <= 0) return 'No deposit'
  const money = formatGbp(amount)
  return basis === 'per_head' ? `${money} per guest` : `${money} per booking`
}
