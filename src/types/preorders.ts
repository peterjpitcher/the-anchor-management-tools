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

/**
 * What a guest is shown for a dish with no allergens recorded (BK-060). The exact words come from
 * the website's docs/SSOT.md, "Allergen wording": missing data means unknown, never "no allergens".
 */
export const PREORDER_ALLERGEN_FALLBACK = 'See menu or contact us for allergen information'

/** The same fact, said to staff. Shown wherever an add-on total appears on a staff or kitchen view. */
export const PREORDER_ADDON_STAFF_NOTE =
  'Add-ons are charged on the night. Nothing has been taken online for them, so put them on the bill.'

/**
 * The organiser's reminder ladder (owner decision D6, 6 November 2026), in the order they fall with
 * the usual 7 day cutoff: 21, 14 and 10 days before the booking by email, then the day before the
 * cutoff and 9am on cutoff day by email and text. `decidePreorderChases` says which one is due.
 */
export const PREORDER_ORGANISER_STAGES = [
  'booker_21d',
  'booker_14d',
  'booker_10d',
  'booker_day_before',
  'booker_cutoff_morning',
] as const
export type PreorderOrganiserStage = (typeof PREORDER_ORGANISER_STAGES)[number]

/** The owner's call list, the day before the cutoff, while anything is missing (D7). */
export const PREORDER_MANAGER_STAGE = 'manager_day_before' as const
export type PreorderManagerStage = typeof PREORDER_MANAGER_STAGE

/** Messages to one guest about their own seat. Their ledger rows always carry the seat (cover_id). */
export const PREORDER_GUEST_REMINDER_KINDS = ['guest_invite', 'guest_reminder'] as const
export type PreorderGuestReminderKind = (typeof PREORDER_GUEST_REMINDER_KINDS)[number]

/**
 * The single reminder and escalation of the first pre-order release. No longer sent once the
 * ladder is wired in, but kept so the ledger rows they left can still be read.
 */
export const PREORDER_LEGACY_REMINDER_KINDS = ['booker_reminder', 'manager_escalation'] as const
export type PreorderLegacyReminderKind = (typeof PREORDER_LEGACY_REMINDER_KINDS)[number]

/** Every kind `booking_preorder_reminders.kind` accepts (its CHECK constraint). */
export const PREORDER_REMINDER_KINDS = [
  ...PREORDER_LEGACY_REMINDER_KINDS,
  ...PREORDER_ORGANISER_STAGES,
  PREORDER_MANAGER_STAGE,
  ...PREORDER_GUEST_REMINDER_KINDS,
] as const
export type PreorderReminderKind = (typeof PREORDER_REMINDER_KINDS)[number]

/** How a chase goes out. A text is only ever as well as an email, never instead of one. */
export type PreorderChaseChannel = 'email' | 'sms'

/** Who last saved a seat, recorded on `booking_preorder_covers.last_saved_by`. */
export const PREORDER_SAVED_BY = ['organiser', 'guest', 'staff'] as const
export type PreorderSavedBy = (typeof PREORDER_SAVED_BY)[number]

/** Column limits, the same as the database CHECK constraints. */
export const PREORDER_GUEST_NAME_MAX_LENGTH = 100
export const PREORDER_DIETARY_NOTE_MAX_LENGTH = 200
export const PREORDER_ALLERGY_DETAIL_MAX_LENGTH = 300
export const PREORDER_INVITE_EMAIL_MAX_LENGTH = 254

// ---------------------------------------------------------------------------
// Raw rows
// ---------------------------------------------------------------------------

export type PreorderCoverRow = {
  id: string
  table_booking_id: string
  ordinal: number
  guest_name: string | null
  dietary_note: string | null
  /** The columns below arrived with 20261106210000_christmas_food_link. Optional so older fixtures still read. */
  has_allergies?: boolean | null
  allergy_detail?: string | null
  invite_email?: string | null
  invite_sent_at?: string | null
  invite_reminded_at?: string | null
  last_saved_by?: string | null
  last_saved_at?: string | null
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
  cover_id?: string | null
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
  /**
   * True when the dish is a kids main (`booking_period_menu_items.is_child_option`), which is 1
   * course only. Set by `loadPreorderOrder`; absent on selections built elsewhere.
   */
  isChildOption?: boolean
  createdAt: string
  updatedAt: string
}

/**
 * How many courses a Christmas guest is having, recorded per seat on
 * `table_bookings.christmas_course_counts`. Every tier has a main (owner decision D4, 6 November
 * 2026): 1 course is a main; 2 courses is a main and one other (a starter or a dessert); 3 courses
 * is a starter, a main and a dessert. Null means the booking recorded no tier, an older booking that
 * keeps its original rule: a main is required.
 */
export type PreorderCourseCount = 1 | 2 | 3

/**
 * A seat's tier as `table_bookings.christmas_course_counts` holds it since the food link release:
 * 0 means the guest has not chosen how many courses yet. Every Christmas booking taken without
 * courses starts with a 0 per guest, and a guest who joins starts on 0.
 */
export type PreorderSeatCourseCount = 0 | PreorderCourseCount

export type PreorderCover = {
  /** 0 to 3, or null when the booking recorded no list (an older booking on the main-only rule). */
  courseCount?: PreorderSeatCourseCount | null
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
  /**
   * The fields below are always set by `loadPreorderOrder` and `savePreorderCover`; optional only
   * so a seat drafted on screen can be judged by the same completeness rule.
   *
   * Null until the guest answers the allergy question. True needs `allergyDetail`. Like the dietary
   * note, staff, kitchen and the guest's own page only: never in a log, an audit row or a digest.
   */
  hasAllergies?: boolean | null
  allergyDetail?: string | null
  /** The guest's own address for their food link and one reminder (A4). Cleared after the booking. */
  inviteEmail?: string | null
  inviteSentAt?: string | null
  inviteRemindedAt?: string | null
  lastSavedBy?: PreorderSavedBy | null
  lastSavedAt?: string | null
  selections: PreorderSelection[]
  createdAt: string
  updatedAt: string
}

export type PreorderReminder = {
  id: string
  tableBookingId: string
  kind: PreorderReminderKind
  /** The seat a guest reminder was about; null for every booking-level kind. */
  coverId: string | null
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
  /**
   * Every guest has a seat for a name and a dietary note: a booking that requires a pre-order, or a
   * Christmas booking with courses recorded, 1 course guests included (BK-148, owner decision D23).
   * Since the food link release every one of those guests also chooses a main.
   */
  hasGuestSeats: boolean
  bookingAllergies: string[]
  periodId: string | null
  periodName: string | null
  /**
   * From the period row, not a snapshot, so it is null once the period is gone. The date after which
   * the form goes read-only, and the day the manager escalation fires, are both derived from this.
   */
  preorderCutoffDays: number | null
  /**
   * The course tier of every seat, seat 1 first, exactly as the booking recorded it. Carried on the
   * order as well as on each cover because a seat may have no cover row yet, and the screens still
   * have to say what that seat owes. Null when the booking recorded no tiers.
   */
  courseCounts?: PreorderSeatCourseCount[] | null
  /**
   * Every dish on the booking's seasonal menu, withdrawn ones included, with whether each is a kids
   * main. Empty when the booking has no period. Set by `loadPreorderOrder`.
   */
  menuItems?: PreorderMenuItemFacts[]
  covers: PreorderCover[]
}

/** What the completeness and tier rules need to know about a dish on the period's menu. */
export type PreorderMenuItemFacts = {
  id: string
  course: string
  name: string
  isActive: boolean
  isChildOption: boolean
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
