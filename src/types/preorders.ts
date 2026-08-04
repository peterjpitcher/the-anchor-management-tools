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
 * The three courses a pre-order covers. NOT the same list as `MENU_COURSES` in
 * src/lib/table-bookings/periods.ts, which also carries sides, drinks and other. A guest pre-orders
 * a meal, not a round of drinks, and the database CHECK constraint matches this list.
 */
export const PREORDER_COURSES = ['starter', 'main', 'dessert'] as const
export type PreorderCourse = (typeof PREORDER_COURSES)[number]

export const PREORDER_COURSE_LABELS: Record<PreorderCourse, string> = {
  starter: 'Starter',
  main: 'Main',
  dessert: 'Dessert',
}

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
  course: PreorderCourse
  menuItemId: string
  /** Frozen at the moment of choosing. A later menu rename must not rewrite what the guest picked. */
  itemName: string
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
