/**
 * Seasonal pre-orders: the shapes every screen, route and cron shares.
 *
 * A pre-order is what each person at a seasonal booking is eating. One cover per seat, one selection
 * per course that seat is having. Backed by booking_preorder_covers, booking_preorder_selections and
 * booking_preorder_reminders (supabase/migrations/20260804000100_seasonal_preorders.sql).
 *
 * The row types below are the raw snake_case shapes. They exist so the mapping in
 * src/lib/table-bookings/preorder.ts names every column by hand: this project has no `fromDb<T>()`
 * helper, deliberately, so a column rename cannot pass silently through a generic converter.
 */

/**
 * The three courses a seat picks exactly ONE of. Deliberately does NOT include add-ons.
 *
 * Every dropdown in the app iterates this list, so appending 'addon' here would offer the
 * cheeseboard as if it were a course a guest chooses instead of their pudding, which is the exact
 * bug add-ons exist to fix. Use `PREORDER_SELECTION_COURSES` when you mean "anything that can appear
 * on a selection row", and this list when you mean "a course with a single answer".
 *
 * NOT the same list as `MENU_COURSES` in src/lib/table-bookings/periods.ts, which also carries
 * sides, drinks and other.
 */
export const PREORDER_COURSES = ['starter', 'main', 'dessert'] as const
export type PreorderCourse = (typeof PREORDER_COURSES)[number]

export const PREORDER_COURSE_LABELS: Record<PreorderCourse, string> = {
  starter: 'Starter',
  main: 'Main',
  dessert: 'Dessert',
}

/**
 * The tick-box course. An add-on is an optional extra a guest has ON TOP of their courses, not
 * instead of one, and a seat may hold several.
 */
export const PREORDER_ADDON_COURSE = 'addon' as const
export type PreorderAddonCourse = typeof PREORDER_ADDON_COURSE

/**
 * Everything that can legally sit in `booking_preorder_selections.course`. Matches the database
 * CHECK constraint (supabase/migrations/20260804000300_preorder_addons.sql). Use this to read and to
 * sort; use `PREORDER_COURSES` to offer a choice.
 */
export const PREORDER_SELECTION_COURSES = [...PREORDER_COURSES, PREORDER_ADDON_COURSE] as const
export type PreorderSelectionCourse = PreorderCourse | PreorderAddonCourse

export const PREORDER_SELECTION_COURSE_LABELS: Record<PreorderSelectionCourse, string> = {
  ...PREORDER_COURSE_LABELS,
  addon: 'Add-on',
}

/**
 * What every surface must tell the guest about add-on money, in one place so all four screens say
 * the same thing.
 *
 * The pub quotes the price at pre-order and charges it on the night. No money is taken online for an
 * add-on and the deposit is unrelated to it. Left to four separate wordings, one of them eventually
 * implies the guest has already paid, and that argument happens at the till.
 */
export const PREORDER_ADDON_GUEST_NOTE =
  'Add-ons are extras on top of your meal. You pay for them on your bill at the pub on the day, not now.'

/** The same fact, said to staff. Shown wherever an add-on total appears on a staff or kitchen view. */
export const PREORDER_ADDON_STAFF_NOTE =
  'Add-ons are charged on the night. Nothing has been taken online for them, so put them on the bill.'

export const PREORDER_REMINDER_KINDS = ['booker_reminder', 'manager_escalation'] as const
export type PreorderReminderKind = (typeof PREORDER_REMINDER_KINDS)[number]

// ---------------------------------------------------------------------------
// Raw rows
// ---------------------------------------------------------------------------

export type PreorderCoverRow = {
  id: string
  table_booking_id: string
  ordinal: number
  guest_name: string | null
  dietary_note: string | null
  created_at: string
  updated_at: string
}

export type PreorderSelectionRow = {
  id: string
  cover_id: string
  course: string
  menu_item_id: string
  item_name: string
  price_gbp: number | string | null
  created_at: string
  updated_at: string
}

export type PreorderReminderRow = {
  id: string
  table_booking_id: string
  kind: string
  sent_at: string
}

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

export type PreorderSelection = {
  id: string
  coverId: string
  /**
   * One of the three courses, or 'addon'. Widened when add-ons arrived, so a caller that assumes
   * three values will now fail to compile rather than silently drop the cheeseboard off a list.
   */
  course: PreorderSelectionCourse
  menuItemId: string
  /** Frozen at the moment of choosing. A later menu rename must not rewrite what the guest picked. */
  itemName: string
  /**
   * Frozen at the moment of choosing. For an add-on this is what the guest was quoted and what the
   * pub charges on the night, which is why totals are summed from here and never from the live menu.
   * Null when the item carried no price, which is true of the whole Christmas menu at the time of
   * writing: a null contributes nothing to a total and must be surfaced, not treated as free.
   */
  priceGbp: number | null
  /**
   * True when the dish behind this choice has since been deactivated. The guest needs to pick again,
   * but the booking is NOT treated as incomplete: see the note on `PreorderCompleteness`.
   */
  itemWithdrawn: boolean
  createdAt: string
  updatedAt: string
}

export type PreorderCover = {
  id: string
  tableBookingId: string
  /** Seat number, 1-based. Stable, and the number staff and the kitchen see. */
  ordinal: number
  guestName: string | null
  /**
   * A dietary requirement the guest typed. Staff and kitchen only. Never email it, never log it,
   * never put it in a manager digest.
   */
  dietaryNote: string | null
  selections: PreorderSelection[]
  createdAt: string
  updatedAt: string
}

export type PreorderReminder = {
  id: string
  tableBookingId: string
  kind: PreorderReminderKind
  sentAt: string
}

/**
 * The whole pre-order for one booking, and the booking facts every consumer needs alongside it.
 *
 * `bookingAllergies` is the booking-level list that already exists on `table_bookings.allergies` and
 * is already shown to the kitchen today. It is carried here so no new kitchen output can silently
 * drop an allergy the pub records now: every kitchen surface must show both that and the per-cover
 * dietary notes, each labelled.
 */
export type PreorderOrder = {
  tableBookingId: string
  bookingReference: string
  bookingDate: string
  bookingTime: string
  partySize: number
  /** The booking's own snapshot: this guest accepted a seasonal offer that requires a pre-order. */
  requiresPreorder: boolean
  bookingAllergies: string[]
  periodId: string | null
  periodName: string | null
  /**
   * From the period row, not a snapshot, so it is null once the period is gone. The date after which
   * the form goes read-only, and the day the manager escalation fires, are both derived from this.
   */
  preorderCutoffDays: number | null
  covers: PreorderCover[]
}

// ---------------------------------------------------------------------------
// Add-on money
//
// Summed from the SNAPSHOT on each selection row, never from the live menu, so an owner editing a
// price in December cannot restate what a guest was quoted in November.
// ---------------------------------------------------------------------------

export type PreorderAddonSummary = {
  /** How many add-ons are ticked. */
  count: number
  /** Sum of the snapshotted prices, in pounds. An unpriced add-on contributes nothing. */
  totalGbp: number
  /**
   * True when at least one ticked add-on carries no price, so `totalGbp` is not the whole charge.
   * Every Christmas menu item is currently unpriced, so this is the normal case today and a screen
   * that shows a bare total without honouring this flag will understate the bill.
   */
  hasUnpricedAddon: boolean
}

export type PreorderCoverAddonSummary = PreorderAddonSummary & {
  coverId: string
  ordinal: number
  guestName: string | null
  items: Array<{
    menuItemId: string
    itemName: string
    priceGbp: number | null
    itemWithdrawn: boolean
  }>
}

export type PreorderOrderAddonSummary = PreorderAddonSummary & {
  /** One entry per seat, in seat order. Seats with no add-ons are included, with a count of zero. */
  perCover: PreorderCoverAddonSummary[]
}
