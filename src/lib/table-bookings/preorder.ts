/**
 * Seasonal pre-orders: reading an order, writing a cover, and totting up what the kitchen has to cook.
 *
 * Every screen, route and cron in this feature goes through here, so there is one completeness rule,
 * one snapshotting rule and one set of totals. The functions take a Supabase client rather than
 * making one, exactly as period-lookup.ts does, so the caller decides whether it is the cookie client
 * or the service-role client. The tables are service-role only under RLS, so in practice the caller
 * has already proven permission before it gets here.
 *
 * These are library functions, not server actions: they throw on failure and the calling action turns
 * that into `{ error }`.
 *
 * THE COMPLETENESS RULE follows each guest's Christmas course tier (`christmas_course_counts`, SSOT
 * section 7): a 1 course guest owes nothing, a 2 course guest owes a main and one other course (a
 * starter or a dessert), and a 3 course guest owes a starter, a main and a dessert. A seat may not
 * hold more courses than its tier pays for, because the kitchen would cook a course nobody paid for.
 * A booking that recorded no tiers keeps the rule it was taken under, owner-confirmed 2026-08-04:
 * every cover needs a MAIN, and a starter and a dessert are optional.
 *
 * ADD-ONS, added 2026-08-04. An add-on is an optional extra a seat has ON TOP of its courses: the
 * farmhouse cheeseboard, which was mistakenly listed as a dessert and so cost the guest their pudding.
 * Three things follow, and all three are load bearing:
 *
 *   1. Add-ons are MULTI-SELECT. A seat holds one starter, one main and one dessert, but as many
 *      add-ons as it likes. The database says the same thing: a partial unique index on
 *      (cover_id, course) that excludes add-ons.
 *   2. Add-ons NEVER affect completeness. A main is still the only requirement, and an add-on can
 *      neither satisfy it nor break it.
 *   3. Add-on money is charged on the guest's BILL AT THE PUB. Nothing is taken online, the deposit
 *      is unrelated, and the totals below exist so the pub knows what to charge, not so anything can
 *      be collected. Totals come from the SNAPSHOT on each selection row, never from the live menu,
 *      so an owner editing a price later cannot restate what a guest was quoted.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isValidIsoDate, parseLondonDateTimeLocal } from '@/lib/dateUtils'
import {
  PREORDER_ADDON_COURSE,
  PREORDER_COURSES,
  PREORDER_SELECTION_COURSES,
  type PreorderAddonSummary,
  type PreorderCourse,
  type PreorderCourseCount,
  type PreorderCover,
  type PreorderCoverAddonSummary,
  type PreorderCoverRow,
  type PreorderOrder,
  type PreorderOrderAddonSummary,
  type PreorderReminderKind,
  type PreorderSelection,
  type PreorderSelectionCourse,
  type PreorderSelectionRow,
} from '@/types/preorders'

type Db = SupabaseClient<any, any, any>

/** Bookings that are off the books entirely. Their choices must not reach a kitchen prep list. */
const DEAD_BOOKING_STATUSES = ['cancelled', 'no_show'] as const

const COVER_COLUMNS = 'id, table_booking_id, ordinal, guest_name, dietary_note, created_at, updated_at'
const SELECTION_COLUMNS =
  'id, cover_id, course, menu_item_id, item_name, price_gbp, created_at, updated_at'

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** True only for the three single-choice courses. An add-on is NOT one of these. */
export function isPreorderCourse(value: string): value is PreorderCourse {
  return (PREORDER_COURSES as readonly string[]).includes(value)
}

/** True for anything that can legally sit on a selection row, add-ons included. */
export function isPreorderSelectionCourse(value: string): value is PreorderSelectionCourse {
  return (PREORDER_SELECTION_COURSES as readonly string[]).includes(value)
}

export function isPreorderAddon(
  selection: Pick<PreorderSelection, 'course'>,
): boolean {
  return selection.course === PREORDER_ADDON_COURSE
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export function mapPreorderSelectionRow(
  row: PreorderSelectionRow,
  options: { itemWithdrawn?: boolean } = {},
): PreorderSelection {
  if (!isPreorderSelectionCourse(row.course)) {
    // The database CHECK constraint makes this unreachable. If it ever fires, something has written
    // round the constraint and the kitchen list would be wrong rather than merely missing a line.
    throw new Error(`A pre-order selection has an unknown course: ${row.course}`)
  }

  return {
    id: row.id,
    coverId: row.cover_id,
    course: row.course,
    menuItemId: row.menu_item_id,
    itemName: row.item_name,
    priceGbp: toNullableNumber(row.price_gbp),
    itemWithdrawn: options.itemWithdrawn === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapPreorderCoverRow(
  row: PreorderCoverRow,
  selections: PreorderSelection[] = [],
): PreorderCover {
  return {
    id: row.id,
    tableBookingId: row.table_booking_id,
    ordinal: row.ordinal,
    guestName: row.guest_name ?? null,
    dietaryNote: row.dietary_note ?? null,
    selections,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// The completeness predicate
// ---------------------------------------------------------------------------

/** A recorded tier, or null for anything that is not 1, 2 or 3. */
export function toPreorderCourseCount(value: unknown): PreorderCourseCount | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : null
}

/**
 * The tier recorded for one seat (1-based), or null when the booking recorded none. Read from the
 * order's own list first, because a seat can have no cover row yet and still owe its courses.
 */
export function getSeatCourseCount(
  order: Pick<PreorderOrder, 'courseCounts' | 'covers'>,
  ordinal: number,
): PreorderCourseCount | null {
  const fromOrder = order.courseCounts?.[ordinal - 1]
  if (fromOrder !== undefined && fromOrder !== null) return toPreorderCourseCount(fromOrder)
  const cover = order.covers.find((entry) => entry.ordinal === ordinal)
  return toPreorderCourseCount(cover?.courseCount ?? null)
}

/** The single-choice courses a seat holds. Add-ons never count, so they cannot be in here. */
/** Only the course of each choice matters to the tier rule, so a draft on screen can be judged too. */
type CoursesHeld = {
  selections: ReadonlyArray<Pick<PreorderSelection, 'course'>>
  courseCount?: PreorderCourseCount | null
}

function chosenCourses(cover: Pick<CoursesHeld, 'selections'>): Set<PreorderCourse> {
  const chosen = new Set<PreorderCourse>()
  for (const selection of cover.selections) {
    if (isPreorderCourse(selection.course)) chosen.add(selection.course)
  }
  return chosen
}

/**
 * The most starters and desserts together that a seat on this tier may hold. A 2 course seat is a
 * main and ONE other, so a starter and a dessert together is a course nobody has paid for.
 */
function maxOtherCourses(courseCount: PreorderCourseCount | null | undefined): number {
  if (courseCount === 1) return 0
  if (courseCount === 2) return 1
  return 2
}

/**
 * What one seat still has to choose, as words that finish "Seat 2 needs ...", or null when nothing
 * is owed. Follows the seat's tier; a seat with no tier keeps the old rule of a main only.
 */
export function describeCoverMissingCourses(cover: CoursesHeld): string | null {
  const courseCount = toPreorderCourseCount(cover.courseCount ?? null)
  if (courseCount === 1) return null

  const chosen = chosenCourses(cover)
  const hasMain = chosen.has('main')

  if (courseCount === null) return hasMain ? null : 'a main'

  if (courseCount === 2) {
    const others = (chosen.has('starter') ? 1 : 0) + (chosen.has('dessert') ? 1 : 0)
    if (others > 1) {
      // Only reachable from a save made before the tier was enforced. Say what to take off.
      return hasMain ? 'only one of the starter and the dessert' : 'a main in place of the starter or the dessert'
    }
    if (!hasMain && others === 0) return 'a main, plus a starter or a dessert'
    if (!hasMain) return 'a main'
    if (others === 0) return 'a starter or a dessert'
    return null
  }

  const missing = (['starter', 'main', 'dessert'] as const)
    .filter((course) => !chosen.has(course))
    .map((course) => `a ${course}`)
  if (missing.length === 0) return null
  if (missing.length === 1) return missing[0]
  return `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
}

/**
 * A cover is complete when it holds exactly the courses its tier pays for, including a main: all
 * three on 3 courses, a main and one other on 2, nothing at all on 1. A cover with no tier recorded
 * keeps the rule it was booked under: a main, with a starter and a dessert optional.
 *
 * Add-ons deliberately cannot reach this function's answer. A seat that has ticked the cheeseboard
 * and chosen no main is NOT complete, and a seat with its courses and no add-ons IS. Anything else
 * would mean the chase cron nagged a guest for not buying an extra.
 */
export function isCoverComplete(cover: CoursesHeld): boolean {
  return describeCoverMissingCourses(cover) === null
}

/**
 * The one item this seat holds for a single-choice course.
 *
 * Takes `PreorderCourse`, not `PreorderSelectionCourse`, so it cannot be called for add-ons: a seat
 * may hold several of those and "the add-on" is not a question with one answer. Use `getCoverAddons`.
 */
export function getCoverCourse(
  cover: Pick<PreorderCover, 'selections'>,
  course: PreorderCourse,
): PreorderSelection | null {
  return cover.selections.find((selection) => selection.course === course) ?? null
}

/** Every add-on this seat has ticked, in the order the cover carries them. */
export function getCoverAddons(cover: Pick<PreorderCover, 'selections'>): PreorderSelection[] {
  return cover.selections.filter(isPreorderAddon)
}

export type PreorderSeatGap = {
  ordinal: number
  courseCount: PreorderCourseCount | null
  /** Words that finish "Seat 2 needs ...", for example "a dessert". */
  missing: string
}

export type PreorderCompleteness = {
  /** Every seat that owes a pre-order has a cover, and every cover holds the courses its tier pays for. */
  complete: boolean
  partySize: number
  coverCount: number
  /**
   * Seat numbers whose courses are not all chosen yet, following each seat's tier. Kept under its
   * old name for its callers; with tiers it means "still owes a course", not only "has no main".
   */
  ordinalsMissingMain: number[]
  /**
   * The same seats, with their tier and what each still needs, in seat order. Includes a seat with
   * no cover row yet, unless it is on 1 course, which owes nothing.
   */
  seatsIncomplete: PreorderSeatGap[]
  /** The seats in `seatsIncomplete` that have no cover row at all. */
  seatsWithoutCover: number[]
  /**
   * Seat numbers whose choice has since been withdrawn from the menu. Reported separately and
   * deliberately NOT counted as incomplete: the chase cron only messages incomplete bookings, and
   * the spec is explicit that a withdrawn dish becomes a short call list for a manager, not an
   * automated burst to every Christmas booker.
   */
  ordinalsWithWithdrawnChoice: number[]
}

export function getPreorderCompleteness(
  order: Pick<PreorderOrder, 'partySize' | 'covers'> & Partial<Pick<PreorderOrder, 'courseCounts'>>,
): PreorderCompleteness {
  const withTiers = { courseCounts: order.courseCounts ?? null, covers: order.covers }
  const coversByOrdinal = new Map(order.covers.map((cover) => [cover.ordinal, cover]))

  // Every seat in the party, whether or not it has a cover row yet: a seat with no row owes every
  // course its tier pays for, and saying which is more use than "no order started".
  const seatsIncomplete: PreorderSeatGap[] = []
  const seatsWithoutCover: number[] = []
  for (let ordinal = 1; ordinal <= order.partySize; ordinal += 1) {
    const cover = coversByOrdinal.get(ordinal)
    const courseCount = getSeatCourseCount(withTiers, ordinal)
    const missing = describeCoverMissingCourses({ selections: cover?.selections ?? [], courseCount })
    if (missing === null) continue
    seatsIncomplete.push({ ordinal, courseCount, missing })
    if (!cover) seatsWithoutCover.push(ordinal)
  }

  const ordinalsWithWithdrawnChoice = order.covers
    .filter((cover) => cover.selections.some((selection) => selection.itemWithdrawn))
    .map((cover) => cover.ordinal)
    .sort((a, b) => a - b)

  return {
    // More covers than seats is drift the nightly check reports, so it is never "complete".
    complete:
      order.covers.length <= order.partySize && seatsWithoutCover.length === 0 && seatsIncomplete.length === 0,
    partySize: order.partySize,
    coverCount: order.covers.length,
    ordinalsMissingMain: seatsIncomplete.map((gap) => gap.ordinal),
    seatsIncomplete,
    seatsWithoutCover,
    ordinalsWithWithdrawnChoice,
  }
}

/** "3 courses", for a seat's tier. Empty when the booking recorded no tier. */
export function describeCourseCount(courseCount: PreorderCourseCount | null | undefined): string {
  if (!courseCount) return ''
  return courseCount === 1 ? '1 course' : `${courseCount} courses`
}

/**
 * What is missing, in a sentence a member of staff can read out on the telephone: each seat, its
 * tier, and the course it still needs. Used on the staff screen and in the manager escalation.
 */
export function describePreorderGaps(completeness: PreorderCompleteness): string {
  if (completeness.complete) return 'All courses chosen.'

  const parts: string[] = []
  for (const gap of completeness.seatsIncomplete) {
    const tier = describeCourseCount(gap.courseCount)
    parts.push(`Seat ${gap.ordinal}${tier ? ` (${tier})` : ''} needs ${gap.missing}.`)
  }
  if (parts.length === 0 && completeness.coverCount > completeness.partySize) {
    parts.push(
      `There are ${completeness.coverCount} pre-order seats for a party of ${completeness.partySize}.`,
    )
  }
  return parts.length > 0 ? parts.join(' ') : 'Something is missing from this pre-order.'
}

// ---------------------------------------------------------------------------
// Add-on money
//
// Add-ons are quoted at pre-order and charged on the guest's bill at the pub. These totals exist so
// the pub knows what to charge. They are summed from the SNAPSHOT on each selection row, never from
// the live menu, so an owner editing a price in December cannot restate what a guest was quoted in
// November. Nothing here takes money and nothing here touches the deposit.
// ---------------------------------------------------------------------------

/**
 * Money is summed in whole pence and converted back once at the end.
 *
 * Adding pounds as floating point makes 8.10 + 4.20 come out at 12.299999999999999, and a bill
 * total that renders a penny out is the kind of thing a guest notices at the till.
 */
function toPence(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

/** '£8.50'. Use for any add-on money so four screens cannot round four different ways. */
export function formatPreorderMoney(valueGbp: number): string {
  return `£${valueGbp.toFixed(2)}`
}

/**
 * The price to show beside a tick-box.
 *
 * Every item on the Christmas menu is currently unpriced, so the null case is the common one and
 * must not read as free. Saying so plainly is better than showing '£0.00' and arguing later.
 */
export function formatPreorderAddonPrice(priceGbp: number | null): string {
  return priceGbp === null ? 'Price on the day' : formatPreorderMoney(priceGbp)
}

/** What one seat has ticked and what it adds to their bill. */
export function summariseCoverAddons(
  cover: Pick<PreorderCover, 'id' | 'ordinal' | 'guestName' | 'selections'>,
): PreorderCoverAddonSummary {
  const addons = getCoverAddons(cover)
  const pence = addons.reduce((running, addon) => running + toPence(addon.priceGbp), 0)

  return {
    coverId: cover.id,
    ordinal: cover.ordinal,
    guestName: cover.guestName,
    count: addons.length,
    totalGbp: pence / 100,
    hasUnpricedAddon: addons.some((addon) => addon.priceGbp === null),
    items: addons.map((addon) => ({
      menuItemId: addon.menuItemId,
      itemName: addon.itemName,
      priceGbp: addon.priceGbp,
      itemWithdrawn: addon.itemWithdrawn,
    })),
  }
}

/**
 * The whole booking's add-on bill, and the per-seat breakdown behind it.
 *
 * Seats with nothing ticked are kept in `perCover` with a count of zero, so a staff screen can render
 * one row per seat straight from this without having to reconcile two lists.
 */
export function summariseOrderAddons(
  order: Pick<PreorderOrder, 'covers'>,
): PreorderOrderAddonSummary {
  const perCover = order.covers
    .map((cover) => summariseCoverAddons(cover))
    .sort((a, b) => a.ordinal - b.ordinal)

  const totals = perCover.reduce<PreorderAddonSummary>(
    (running, cover) => ({
      count: running.count + cover.count,
      // Back to pence for the addition, for the same reason as above.
      totalGbp: (toPence(running.totalGbp) + toPence(cover.totalGbp)) / 100,
      hasUnpricedAddon: running.hasUnpricedAddon || cover.hasUnpricedAddon,
    }),
    { count: 0, totalGbp: 0, hasUnpricedAddon: false },
  )

  return { ...totals, perCover }
}

// ---------------------------------------------------------------------------
// The cutoff, and when to chase
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * How many days before the booking the booker is asked for their choices. 10, not the 7 of spec
 * section 7 (owner decision, 11 September 2026): with the Christmas pre-order closing at noon seven
 * days before, a 7-day reminder landed the minute the form locked, so the guest was asked for
 * something they could no longer do. At 10 days they have three days to answer.
 */
export const PREORDER_BOOKER_REMINDER_DAYS = 10

export type PreorderCutoff = {
  /**
   * The instant the form locks, or null when nothing ever locks it: the booking has no seasonal
   * period, or the period row has since gone. Staying open is the safer failure, because a locked
   * form loses orders the pub could still have taken.
   */
  closesAt: Date | null
  closed: boolean
}

/**
 * When a seasonal pre-order stops being editable: noon London, `preorderCutoffDays` before the
 * booking. Spec section 5 makes the form read-only from that moment, and section 7 hangs the
 * manager escalation off the same date.
 *
 * ONE RULE, ONE PLACE. This was written twice, once for the staff screen and once for the booker's
 * manage page, and the two agreed only by luck. It lives here for the same reason `judgeSlot` on the
 * website is a single function: a rule that decides whether a guest may still act must give the same
 * answer on every screen, and the way that guarantee is lost is two copies drifting a line at a time.
 * The remaining callers are thin adapters over this function, never second implementations.
 *
 * Noon rather than midnight is deliberate: the kitchen orders on the cutoff day, so a booker who
 * finishes their choices over breakfast still counts.
 */
export function getPreorderCutoff(input: {
  bookingDate: string
  preorderCutoffDays: number | null
  now?: Date
}): PreorderCutoff {
  const { bookingDate, preorderCutoffDays } = input
  if (preorderCutoffDays === null || !Number.isFinite(preorderCutoffDays)) {
    return { closesAt: null, closed: false }
  }
  if (!isValidIsoDate(bookingDate)) return { closesAt: null, closed: false }

  const [year, month, day] = bookingDate.split('-').map(Number)
  // Calendar arithmetic in UTC, then the wall time is applied in London, so the answer does not
  // move with the host machine's timezone or with the start of British Summer Time.
  const cutoffDate = new Date(Date.UTC(year, month - 1, day) - Math.max(0, preorderCutoffDays) * MS_PER_DAY)
  const cutoffIsoDate = cutoffDate.toISOString().slice(0, 10)

  const closesAt = parseLondonDateTimeLocal(`${cutoffIsoDate}T12:00`)
  if (!closesAt) return { closesAt: null, closed: false }

  const now = input.now ?? new Date()
  return { closesAt, closed: now.getTime() >= closesAt.getTime() }
}

/**
 * True when this row was written at or after the form locked. Guests and staff cannot save after the
 * cutoff, so a choice made after it was recorded by a manager as a late change (D21, BK-051), and
 * the kitchen sheet and totals say so: the kitchen ordered before it happened.
 */
export function isChangedAfterCutoff(writtenAtIso: string | null | undefined, closesAt: Date | null): boolean {
  if (!writtenAtIso || !closesAt) return false
  const written = new Date(writtenAtIso).getTime()
  return Number.isFinite(written) && written >= closesAt.getTime()
}

/** Whether any choice or detail on this seat was changed after the cutoff. */
export function isCoverChangedAfterCutoff(
  cover: Pick<PreorderCover, 'updatedAt' | 'createdAt' | 'selections'>,
  closesAt: Date | null,
): boolean {
  if (!closesAt) return false
  // A cover row created after the cutoff is a seat added by a party-size change, not a choice.
  const coverEdited = cover.updatedAt !== cover.createdAt && isChangedAfterCutoff(cover.updatedAt, closesAt)
  return coverEdited || cover.selections.some((selection) => isChangedAfterCutoff(selection.createdAt, closesAt))
}

export type PreorderChaseInput = {
  /** Whole days from today to the booking, on the London calendar. 0 means the booking is today. */
  daysUntilBooking: number
  /** The period's `preorder_cutoff_days`, or null when the booking has no seasonal period. */
  cutoffDays: number | null
  /** London date the booker's reminder was claimed, or null when it never has been. */
  bookerReminderSentOn: string | null
  managerEscalationSent: boolean
  /** Today, London, YYYY-MM-DD. */
  todayIso: string
  /**
   * Whether the pre-order form has already locked (`getPreorderCutoff(...).closed`). Once it has,
   * the booker cannot act on a reminder, so they are never sent one.
   */
  preorderClosed: boolean
}

/**
 * Which chases this booking is due, this run. Spec section 7: two messages per booking, ever.
 *
 * THE ESCALATION NEVER RIDES ALONG WITH THE FIRST REMINDER. The booker is asked at
 * `PREORDER_BOOKER_REMINDER_DAYS` and the manager is told at `preorder_cutoff_days`, and that column
 * ships defaulted to 7. When the two thresholds meet, the same sweep would ask the guest for their
 * choices and, in the same minute, tell a manager to ring them for not having given any. Fixing that
 * by asking someone to set the two numbers apart is not a fix, because nothing stops the next person
 * setting them back.
 *
 * So the escalation is gated on the booker having actually had their reminder on an EARLIER day. A
 * reminder claimed today has not been acted on yet by definition, so the manager waits for a later
 * sweep. With the shipped cutoff of 7, the booker is asked ten days out and, if nothing has arrived by
 * the cutoff, the manager is told seven days out. Slipping an internal email by a day costs nothing;
 * asking a guest and dobbing them in simultaneously costs the pub's manners.
 *
 * A BOOKING WHOSE FORM HAS ALREADY LOCKED is never sent the booker reminder. The reminder says
 * "choose here" and links to the manage page, and once the cutoff has passed that page will not take
 * a choice, so the text only tells a guest to do something they cannot. That was the case for every
 * booking made inside the cutoff, and also for every booking whose first sweep inside the reminder
 * window fell on the cutoff day: this cron runs at noon, which is the moment the form locks. The
 * manager is told instead, on that same sweep, because nobody else can now fill the gap.
 *
 * `bookerReminderSentOn` is the ledger row, which is claimed before the send and never rolled back.
 * That is on purpose here too: a reminder that failed to send still counts as the booker's turn
 * having passed, so the manager is told the next day rather than the booking going quiet.
 */
export function decidePreorderChases(input: PreorderChaseInput): PreorderReminderKind[] {
  const { daysUntilBooking, cutoffDays, bookerReminderSentOn, managerEscalationSent, todayIso, preorderClosed } =
    input

  const due: PreorderReminderKind[] = []

  // "At or inside" rather than "exactly on", so one failed cron run does not lose the message for
  // good. The ledger is what stops it being sent twice.
  const bookerDue =
    !preorderClosed && bookerReminderSentOn === null && daysUntilBooking <= PREORDER_BOOKER_REMINDER_DAYS
  if (bookerDue) due.push('booker_reminder')

  const bookerHasHadTheirTurn = bookerReminderSentOn !== null && bookerReminderSentOn < todayIso
  const noLaterSweep = daysUntilBooking <= 0
  // Locked before the booker was ever asked: waiting for their turn would mean waiting for ever.
  const bookerCannotAct = preorderClosed && bookerReminderSentOn === null

  if (
    !managerEscalationSent &&
    cutoffDays !== null &&
    daysUntilBooking <= cutoffDays &&
    (bookerHasHadTheirTurn || noLaterSweep || bookerCannotAct)
  ) {
    due.push('manager_escalation')
  }

  return due
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Which of these menu items have been withdrawn. Kept in one place because both the read model and
 * the nightly report need the same answer, and an item that is merely renamed is NOT withdrawn.
 */
async function loadWithdrawnMenuItemIds(supabase: Db, menuItemIds: string[]): Promise<Set<string>> {
  if (menuItemIds.length === 0) return new Set()

  const { data, error } = await supabase
    .from('booking_period_menu_items')
    .select('id, is_active')
    .in('id', menuItemIds)

  if (error) throw error

  const withdrawn = new Set<string>()
  for (const row of (data ?? []) as Array<{ id: string; is_active: boolean }>) {
    if (row.is_active === false) withdrawn.add(row.id)
  }
  return withdrawn
}

async function loadCoversWithSelections(supabase: Db, tableBookingId: string): Promise<PreorderCover[]> {
  const { data: coverRows, error: coverError } = await supabase
    .from('booking_preorder_covers')
    .select(COVER_COLUMNS)
    .eq('table_booking_id', tableBookingId)
    .order('ordinal', { ascending: true })

  if (coverError) throw coverError

  const covers = (coverRows ?? []) as unknown as PreorderCoverRow[]
  if (covers.length === 0) return []

  const { data: selectionRows, error: selectionError } = await supabase
    .from('booking_preorder_selections')
    .select(SELECTION_COLUMNS)
    .in(
      'cover_id',
      covers.map((cover) => cover.id),
    )

  if (selectionError) throw selectionError

  const selections = (selectionRows ?? []) as unknown as PreorderSelectionRow[]
  const withdrawn = await loadWithdrawnMenuItemIds(
    supabase,
    Array.from(new Set(selections.map((row) => row.menu_item_id))),
  )

  const byCover = new Map<string, PreorderSelection[]>()
  for (const row of selections) {
    const mapped = mapPreorderSelectionRow(row, { itemWithdrawn: withdrawn.has(row.menu_item_id) })
    const list = byCover.get(row.cover_id)
    if (list) list.push(mapped)
    else byCover.set(row.cover_id, [mapped])
  }

  return covers.map((cover) => {
    // Menu order, add-ons last because they sit alongside the meal rather than inside it. Ties broken
    // by name so the several add-ons a seat may hold come back in a stable order rather than whatever
    // order PostgREST happened to return them in.
    const coverSelections = (byCover.get(cover.id) ?? []).sort(
      (a, b) =>
        PREORDER_SELECTION_COURSES.indexOf(a.course) - PREORDER_SELECTION_COURSES.indexOf(b.course) ||
        a.itemName.localeCompare(b.itemName),
    )
    return mapPreorderCoverRow(cover, coverSelections)
  })
}

/**
 * The whole pre-order for one booking, or null when the booking does not exist.
 *
 * Returns an order with no covers rather than null when the booking exists but nothing has been
 * entered yet, so a caller can tell "nothing ordered" from "no such booking".
 */
export async function loadPreorderOrder(
  supabase: Db,
  tableBookingId: string,
): Promise<PreorderOrder | null> {
  const { data: bookingRow, error: bookingError } = await supabase
    .from('table_bookings')
    // Select the row so the optional snapshot remains compatible before its migration.
    .select('*')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (bookingError) throw bookingError
  if (!bookingRow) return null

  const booking = bookingRow as unknown as {
    id: string
    booking_reference: string
    booking_date: string
    booking_time: string
    party_size: number
    allergies: string[] | null
    booking_period_id: string | null
    booking_period_name: string | null
    booking_period_answer: boolean | null
    booking_period_requires_preorder: boolean | null
    christmas_course_counts?: Array<1 | 2 | 3> | null
  }

  const [covers, preorderCutoffDays] = await Promise.all([
    loadCoversWithSelections(supabase, tableBookingId),
    loadPreorderCutoffDays(supabase, booking.booking_period_id),
  ])

  const courseCounts = Array.isArray(booking.christmas_course_counts)
    ? booking.christmas_course_counts.map((count) => toPreorderCourseCount(count) ?? 1)
    : null

  return {
    tableBookingId: booking.id,
    bookingReference: booking.booking_reference,
    bookingDate: booking.booking_date,
    bookingTime: booking.booking_time,
    partySize: booking.party_size,
    // Both halves matter: the period may require a pre-order, but a guest who answered "no, this is
    // not a Christmas dinner" gets the normal menu at normal terms and owes nobody a choice.
    requiresPreorder:
      booking.booking_period_requires_preorder === true && booking.booking_period_answer === true,
    bookingAllergies: booking.allergies ?? [],
    periodId: booking.booking_period_id ?? null,
    periodName: booking.booking_period_name ?? null,
    preorderCutoffDays,
    courseCounts,
    covers: covers.map((cover) => ({ ...cover, courseCount: courseCounts?.[cover.ordinal - 1] ?? null })),
  }
}

async function loadPreorderCutoffDays(supabase: Db, periodId: string | null): Promise<number | null> {
  if (!periodId) return null

  const { data, error } = await supabase
    .from('booking_periods')
    .select('preorder_cutoff_days')
    .eq('id', periodId)
    .maybeSingle()

  if (error) throw error
  return toNullableNumber((data as { preorder_cutoff_days?: number | null } | null)?.preorder_cutoff_days)
}

/**
 * The master switch, `preorder_enabled`. Defaults to OFF on a failed read, which is the opposite of
 * the deposit switch and deliberately so: the deposit switch guesses ON because the database charges
 * regardless, whereas nothing here charges anybody. The worst case of guessing off is that a form
 * does not appear and staff take the order on the telephone, which is how the pub works today.
 */
export async function isPreorderEnabled(supabase: Db): Promise<boolean> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'preorder_enabled')
    .maybeSingle()

  if (error) {
    console.warn('[preorder] Could not read preorder_enabled; treating pre-orders as switched off')
    return false
  }

  // Stored wrapped, as {"value": true}. A bare boolean is honoured too, so a switch someone has
  // turned ON does not read as OFF just because the row was written in an older shape.
  const stored = (data as { value?: unknown } | null)?.value ?? null
  if (typeof stored === 'boolean') return stored
  if (stored && typeof stored === 'object' && typeof (stored as { value?: unknown }).value === 'boolean') {
    return (stored as { value: boolean }).value
  }
  return false
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type PreorderSelectionInput = {
  /**
   * A single-choice course only. Add-ons cannot come through here: they are multi-select, so
   * "the add-on for this seat" is not a question with one answer. Use `addonMenuItemIds`.
   */
  course: PreorderCourse
  /** null clears the course. Clearing a main leaves the cover incomplete, which is allowed: a booker
   *  half way through the form must be able to save. */
  menuItemId: string | null
}

export type SavePreorderCoverInput = {
  coverId: string
  /** Omit to leave as it is. Pass null to clear. */
  guestName?: string | null
  dietaryNote?: string | null
  /** Only the courses named here are touched. Omit a course to leave it alone. */
  selections?: PreorderSelectionInput[]
  /**
   * The COMPLETE set of add-ons this seat wants, as menu item ids. Whole-set, not a patch: whatever
   * is not in the list is unticked. Omit the field to leave add-ons alone, pass `[]` to clear them
   * all.
   *
   * It has to be whole-set because the form is tick-boxes. A patch shape cannot express "the guest
   * has just unticked the cheeseboard" without inventing a separate remove list, and a form that can
   * add but not remove is the classic way a guest ends up charged for something they took off.
   */
  addonMenuItemIds?: string[]
}

/**
 * Save one seat: its name, its dietary note and its courses.
 *
 * Both the staff screen and the booker's manage page write through here, so there is one rule and
 * one audit trail. Prices and dish names are SNAPSHOT from booking_period_menu_items at the moment
 * of choosing, so a later menu edit cannot rewrite what the guest picked or make the kitchen list
 * disagree with it.
 *
 * The item is validated against the booking's own period. Without that check a caller could snapshot
 * last year's turkey onto this year's booking, and nothing in the database would notice.
 */
export async function savePreorderCover(
  supabase: Db,
  input: SavePreorderCoverInput,
): Promise<PreorderCover> {
  const { data: coverRow, error: coverError } = await supabase
    .from('booking_preorder_covers')
    .select(COVER_COLUMNS)
    .eq('id', input.coverId)
    .maybeSingle()

  if (coverError) throw coverError
  if (!coverRow) throw new Error('That seat no longer exists on this booking.')

  const cover = coverRow as unknown as PreorderCoverRow

  const selections = input.selections ?? []
  for (const entry of selections) {
    // The type already forbids it, but this path is reached from a JSON request body on the
    // booker's manage page, where types are a promise rather than a guarantee. An add-on smuggled
    // in here would be written as a single-choice course and would silently replace whatever the
    // seat had.
    if (!isPreorderCourse(entry.course)) {
      throw new Error('Add-ons are ticked separately, not chosen as a course.')
    }
  }

  const cleared = selections.filter((entry) => !entry.menuItemId).map((entry) => entry.course)
  const chosen = selections.filter(
    (entry): entry is PreorderSelectionInput & { menuItemId: string } => Boolean(entry.menuItemId),
  )

  // Checked before anything is written, so a refused save changes nothing on the seat.
  if (chosen.length > 0) {
    await assertCoursesWithinTier(supabase, cover, cleared, chosen.map((entry) => entry.course))
  }

  const patch: Record<string, unknown> = {}
  if (input.guestName !== undefined) patch.guest_name = normaliseText(input.guestName, 100)
  if (input.dietaryNote !== undefined) patch.dietary_note = normaliseText(input.dietaryNote, 200)

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('booking_preorder_covers').update(patch).eq('id', cover.id)
    if (error) throw error
  }

  if (selections.length > 0) {
    // Clear every course this call names, whether it is being cleared or replaced, then insert the
    // replacements. This used to be an upsert on the (cover_id, course) UNIQUE constraint, and that
    // constraint is gone: the one that replaced it is PARTIAL, and Postgres will not infer a partial
    // index for ON CONFLICT without a matching predicate, which PostgREST has no way to send. A
    // delete then insert says the same thing and does not depend on index inference at all. The two
    // statements are not one transaction, so a failure between them leaves the course CLEARED rather
    // than wrong, and the guest picks again. That is the safe half of the pair: the kitchen is never
    // told about a dish nobody chose.
    const touched = [...cleared, ...chosen.map((entry) => entry.course)]
    if (touched.length > 0) {
      const { error } = await supabase
        .from('booking_preorder_selections')
        .delete()
        .eq('cover_id', cover.id)
        .in('course', Array.from(new Set(touched)))
      if (error) throw error
    }

    if (chosen.length > 0) {
      const items = await loadMenuItemsForSnapshot(
        supabase,
        cover.table_booking_id,
        chosen.map((entry) => entry.menuItemId),
      )

      const rows = chosen.map((entry) => {
        const item = items.get(entry.menuItemId)
        if (!item) throw new Error('That dish is not on the menu for this booking.')
        if (!item.isActive) throw new Error(`${item.name} has been taken off the menu. Please choose again.`)
        if (item.course !== entry.course) {
          throw new Error(`${item.name} is not a ${entry.course}.`)
        }
        return {
          cover_id: cover.id,
          course: entry.course,
          menu_item_id: entry.menuItemId,
          item_name: item.name,
          price_gbp: item.priceGbp,
        }
      })

      const { error } = await supabase.from('booking_preorder_selections').insert(rows)
      if (error) throw error
    }
  }

  if (input.addonMenuItemIds !== undefined) {
    await saveCoverAddons(supabase, cover, input.addonMenuItemIds)
  }

  const covers = await loadCoversWithSelections(supabase, cover.table_booking_id)
  const saved = covers.find((entry) => entry.id === cover.id)
  if (!saved) throw new Error('That seat no longer exists on this booking.')
  return saved
}

/**
 * A save that would give a seat more courses than its tier pays for. Its message is written for the
 * person saving, guest or staff, and names the seat and what its tier allows.
 */
export class PreorderCourseLimitError extends Error {
  readonly ordinal: number
  readonly courseCount: PreorderCourseCount

  constructor(ordinal: number, courseCount: PreorderCourseCount) {
    super(
      courseCount === 1
        ? `Seat ${ordinal} is on 1 course, so there is nothing to choose in advance.`
        : `Seat ${ordinal} is on 2 courses: choose a main, plus a starter or a dessert, not both.`,
    )
    this.name = 'PreorderCourseLimitError'
    this.ordinal = ordinal
    this.courseCount = courseCount
  }
}

/** The tier this seat's booking recorded for it, or null when the booking recorded none. */
async function loadSeatCourseCount(
  supabase: Db,
  tableBookingId: string,
  ordinal: number,
): Promise<PreorderCourseCount | null> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select('christmas_course_counts')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (error) throw error
  const counts = (data as { christmas_course_counts?: unknown } | null)?.christmas_course_counts
  return Array.isArray(counts) ? toPreorderCourseCount(counts[ordinal - 1]) : null
}

/**
 * Refuse a save that would leave the seat holding more courses than its tier: anything at all on 1
 * course, or a starter and a dessert together on 2. The database does not check this, and the
 * kitchen would otherwise cook a course the guest has not paid for. 3 courses and untiered seats
 * cannot go over: a seat holds at most one of each course.
 */
async function assertCoursesWithinTier(
  supabase: Db,
  cover: PreorderCoverRow,
  cleared: PreorderCourse[],
  chosen: PreorderCourse[],
): Promise<void> {
  const courseCount = await loadSeatCourseCount(supabase, cover.table_booking_id, cover.ordinal)
  if (courseCount !== 1 && courseCount !== 2) return

  const { data, error } = await supabase
    .from('booking_preorder_selections')
    .select('course')
    .eq('cover_id', cover.id)

  if (error) throw error

  const after = new Set<PreorderCourse>()
  for (const row of (data ?? []) as Array<{ course: string }>) {
    if (isPreorderCourse(row.course)) after.add(row.course)
  }
  for (const course of cleared) after.delete(course)
  for (const course of chosen) after.add(course)

  const others = (after.has('starter') ? 1 : 0) + (after.has('dessert') ? 1 : 0)
  const overTier = courseCount === 1 ? after.size > 0 : others > maxOtherCourses(courseCount)
  if (overTier) throw new PreorderCourseLimitError(cover.ordinal, courseCount)
}

/**
 * Make this seat's ticked add-ons match `wantedMenuItemIds` exactly.
 *
 * Written as a DIFF, not a wipe and rewrite. An add-on the guest has not touched keeps the row it
 * already had, and therefore keeps the price it was snapshotted at: a guest quoted £8 in November is
 * still charged £8 in December even if the owner has since put the menu up. Deleting and reinserting
 * everything would quietly re-quote every untouched add-on on every save, which is precisely the
 * silent restatement the snapshot exists to prevent.
 *
 * Rows are deleted by primary key rather than by a NOT IN filter on menu_item_id, because a long
 * negated uuid list is the sort of PostgREST filter that fails on quoting and takes the whole save
 * with it.
 */
async function saveCoverAddons(
  supabase: Db,
  cover: PreorderCoverRow,
  wantedMenuItemIds: string[],
): Promise<void> {
  const wanted = Array.from(new Set(wantedMenuItemIds.filter((id) => Boolean(id))))

  const { data: existingRows, error: existingError } = await supabase
    .from('booking_preorder_selections')
    .select('id, menu_item_id')
    .eq('cover_id', cover.id)
    .eq('course', PREORDER_ADDON_COURSE)

  if (existingError) throw existingError

  const existing = (existingRows ?? []) as Array<{ id: string; menu_item_id: string }>
  const keep = new Set(wanted)
  const doomed = existing.filter((row) => !keep.has(row.menu_item_id)).map((row) => row.id)
  const already = new Set(existing.map((row) => row.menu_item_id))
  const toAdd = wanted.filter((id) => !already.has(id))

  if (doomed.length > 0) {
    const { error } = await supabase.from('booking_preorder_selections').delete().in('id', doomed)
    if (error) throw error
  }

  if (toAdd.length === 0) return

  const items = await loadMenuItemsForSnapshot(supabase, cover.table_booking_id, toAdd)

  const rows = toAdd.map((menuItemId) => {
    const item = items.get(menuItemId)
    if (!item) throw new Error('That add-on is not on the menu for this booking.')
    if (!item.isActive) throw new Error(`${item.name} is no longer available.`)
    // An item is one thing or the other. Ticking a main as though it were an add-on would give the
    // seat two mains, one of them charged again on the night.
    if (item.course !== PREORDER_ADDON_COURSE) {
      throw new Error(`${item.name} is not an add-on.`)
    }
    return {
      cover_id: cover.id,
      course: PREORDER_ADDON_COURSE,
      menu_item_id: menuItemId,
      item_name: item.name,
      price_gbp: item.priceGbp,
    }
  })

  const { error } = await supabase.from('booking_preorder_selections').insert(rows)
  if (error) throw error
}

function normaliseText(value: string | null, maxLength: number): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed.slice(0, maxLength)
}

type SnapshotMenuItem = { name: string; course: string; priceGbp: number | null; isActive: boolean }

async function loadMenuItemsForSnapshot(
  supabase: Db,
  tableBookingId: string,
  menuItemIds: string[],
): Promise<Map<string, SnapshotMenuItem>> {
  const { data: bookingRow, error: bookingError } = await supabase
    .from('table_bookings')
    .select('booking_period_id')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (bookingError) throw bookingError

  const periodId = (bookingRow as { booking_period_id?: string | null } | null)?.booking_period_id ?? null
  if (!periodId) throw new Error('This booking has no seasonal menu, so there is nothing to pre-order.')

  const { data, error } = await supabase
    .from('booking_period_menu_items')
    .select('id, name, course, price_gbp, is_active')
    .eq('period_id', periodId)
    .in('id', Array.from(new Set(menuItemIds)))

  if (error) throw error

  const items = new Map<string, SnapshotMenuItem>()
  for (const row of (data ?? []) as Array<{
    id: string
    name: string
    course: string
    price_gbp: number | string | null
    is_active: boolean
  }>) {
    items.set(row.id, {
      name: row.name,
      course: row.course,
      priceGbp: toNullableNumber(row.price_gbp),
      isActive: row.is_active !== false,
    })
  }
  return items
}

export type PreorderRemovedCover = {
  id: string
  ordinal: number
  guestName: string | null
  courses: Array<{ course: string; itemName: string }>
}

export type PreorderCoverSyncResult = {
  partySize: number
  coverCount: number
  added: number
  /** Highest ordinals first is what the function drops, so this is what to tell the booker. */
  removed: PreorderRemovedCover[]
}

/**
 * Bring the cover count back in line with party size after an amendment.
 *
 * Call this from whichever path just changed party size. It is not a trigger, and must not become
 * one: a deferred constraint trigger breaks all four live party-size writers, one of which is SQL
 * inside the communal-event reallocation function.
 */
export async function syncPreorderCovers(
  supabase: Db,
  tableBookingId: string,
): Promise<PreorderCoverSyncResult> {
  const { data, error } = await supabase.rpc('preorder_sync_covers', { p_booking_id: tableBookingId })
  if (error) throw error

  const result = (data ?? {}) as {
    ok?: boolean
    error_code?: string
    party_size?: number
    cover_count?: number
    added?: number
    removed?: Array<{
      id: string
      ordinal: number
      guest_name: string | null
      courses?: Array<{ course: string; item_name: string }> | null
    }>
  }

  if (result.ok !== true) {
    throw new Error(
      result.error_code === 'booking_not_found'
        ? 'That booking no longer exists.'
        : 'Could not bring the pre-order seats in line with the new party size.',
    )
  }

  return {
    partySize: result.party_size ?? 0,
    coverCount: result.cover_count ?? 0,
    added: result.added ?? 0,
    removed: (result.removed ?? []).map((row) => ({
      id: row.id,
      ordinal: row.ordinal,
      guestName: row.guest_name ?? null,
      courses: (row.courses ?? []).map((entry) => ({
        course: entry.course,
        itemName: entry.item_name,
      })),
    })),
  }
}

// ---------------------------------------------------------------------------
// Dish totals for the kitchen
// ---------------------------------------------------------------------------

export type PreorderDishTotal = {
  menuItemId: string
  itemName: string
  count: number
}

/** An add-on line carries money as well as a count, because somebody has to charge for it. */
export type PreorderAddonDishTotal = PreorderDishTotal & {
  /**
   * The snapshot price most guests were quoted, or null when none of them carried one. Only a label:
   * `totalGbp` is summed from the individual snapshots, so a price that changed mid-season still
   * totals correctly even though one number cannot describe it.
   */
  unitPriceGbp: number | null
  totalGbp: number
  hasUnpricedSelection: boolean
}

/** A dish taken off the menu that guests had already chosen. Never counted in `byCourse`. */
export type PreorderWithdrawnDishTotal = PreorderDishTotal & { course: PreorderSelectionCourse }

/**
 * How many Christmas guests are on each tier that day, read from `table_bookings.christmas_course_counts`
 * rather than from cover rows: a booking where everyone is on 1 course has no covers at all, and
 * the kitchen still has to expect them.
 */
export type PreorderChristmasTierTotals = {
  oneCourse: number
  twoCourses: number
  threeCourses: number
  /** Guests on Christmas bookings that recorded no tiers (older staff bookings). */
  notRecorded: number
  /** Every guest on a Christmas booking that day. */
  guests: number
}

export type PreorderDishTotals = {
  date: string
  /** Bookings on that date that have at least one pre-order seat. */
  bookingCount: number
  coverCount: number
  /**
   * Bookings in these totals still waiting for their deposit. They are counted, because the guest
   * may still pay, and labelled, because an unpaid hold can lapse before the night.
   */
  pendingPaymentBookingCount: number
  /**
   * Choices a manager recorded after the cutoff (D21). They are in the counts, because they are what
   * the guest is now having, but the kitchen ordered before them, so the totals say how many.
   */
  lateChangeCount: number
  christmasTiers: PreorderChristmasTierTotals
  /**
   * Choices whose dish has since been withdrawn. Listed apart and kept OUT of `byCourse`, so the
   * kitchen does not order stock for a dish that is off the menu; each one is a guest to ring.
   */
  withdrawn: PreorderWithdrawnDishTotal[]
  byCourse: Record<PreorderCourse, PreorderDishTotal[]>
  /**
   * Add-ons, counted SEPARATELY from the courses and never folded into them. The kitchen reads the
   * course lists as "plates to make" and this as "extras to put out and charge for", and a
   * cheeseboard counted as a dessert would have the kitchen make one pudding too few.
   */
  addons: PreorderAddonDishTotal[]
  /** What the pub should take across the day for add-ons, on the night, from the snapshotted prices. */
  addonTotalGbp: number
  /** True when any add-on that day is unpriced, so `addonTotalGbp` is not the whole of it. */
  addonHasUnpricedSelection: boolean
}

/** The shape to return when a date has nothing on it. One definition, so no caller invents its own. */
export function emptyChristmasTierTotals(): PreorderChristmasTierTotals {
  return { oneCourse: 0, twoCourses: 0, threeCourses: 0, notRecorded: 0, guests: 0 }
}

/** Tally each guest's tier across a day's Christmas bookings. */
export function summariseChristmasTiers(
  bookings: Array<{ partySize: number | null; courseCounts: ReadonlyArray<number> | null }>,
): PreorderChristmasTierTotals {
  const totals = emptyChristmasTierTotals()
  for (const booking of bookings) {
    const counts = booking.courseCounts
    if (!counts || counts.length === 0) {
      const guests = Math.max(0, Math.trunc(Number(booking.partySize) || 0))
      totals.notRecorded += guests
      totals.guests += guests
      continue
    }
    for (const count of counts) {
      const tier = toPreorderCourseCount(count)
      if (tier === 1) totals.oneCourse += 1
      else if (tier === 2) totals.twoCourses += 1
      else if (tier === 3) totals.threeCourses += 1
      else totals.notRecorded += 1
      totals.guests += 1
    }
  }
  return totals
}

export function emptyPreorderDishTotals(date: string): PreorderDishTotals {
  return {
    date,
    bookingCount: 0,
    coverCount: 0,
    pendingPaymentBookingCount: 0,
    lateChangeCount: 0,
    christmasTiers: emptyChristmasTierTotals(),
    withdrawn: [],
    byCourse: { starter: [], main: [], dessert: [] },
    addons: [],
    addonTotalGbp: 0,
    addonHasUnpricedSelection: false,
  }
}

/**
 * Group choices into "how many of each dish", by course, with add-ons on their own list.
 *
 * Grouped by menu item id, not by name: names are snapshots, so a dish renamed mid-season would
 * otherwise split into two lines and the kitchen would cook the wrong quantities of both. The label
 * shown is whichever snapshot name appears most often, ties broken alphabetically, so the line reads
 * as the dish most guests actually chose.
 */
export function summarisePreorderDishTotals(input: {
  date: string
  bookingCount: number
  coverCount: number
  pendingPaymentBookingCount?: number
  lateChangeCount?: number
  christmasTiers?: PreorderChristmasTierTotals
  selections: Array<
    Pick<PreorderSelection, 'course' | 'menuItemId' | 'itemName'> & {
      priceGbp?: number | null
      itemWithdrawn?: boolean
    }
  >
}): PreorderDishTotals {
  const withdrawnTallies = new Map<string, PreorderWithdrawnDishTotal>()
  const live: typeof input.selections = []
  for (const selection of input.selections) {
    if (!selection.itemWithdrawn) {
      live.push(selection)
      continue
    }
    const key = `${selection.course}:${selection.menuItemId}`
    const tally = withdrawnTallies.get(key)
    if (tally) tally.count += 1
    else {
      withdrawnTallies.set(key, {
        course: selection.course,
        menuItemId: selection.menuItemId,
        itemName: selection.itemName,
        count: 1,
      })
    }
  }

  type Tally = {
    course: PreorderSelectionCourse
    names: Map<string, number>
    count: number
    /** Snapshot prices seen for this item, so the busiest one can label the line. */
    prices: Map<number, number>
    pence: number
    unpriced: number
  }

  const tallies = new Map<string, Tally>()

  for (const selection of live) {
    const key = `${selection.course}:${selection.menuItemId}`
    const tally: Tally = tallies.get(key) ?? {
      course: selection.course,
      names: new Map(),
      count: 0,
      prices: new Map(),
      pence: 0,
      unpriced: 0,
    }
    tally.count += 1
    tally.names.set(selection.itemName, (tally.names.get(selection.itemName) ?? 0) + 1)

    const price = selection.priceGbp ?? null
    if (price === null) tally.unpriced += 1
    else {
      tally.prices.set(price, (tally.prices.get(price) ?? 0) + 1)
      tally.pence += toPence(price)
    }

    tallies.set(key, tally)
  }

  const byCourse: Record<PreorderCourse, PreorderDishTotal[]> = {
    starter: [],
    main: [],
    dessert: [],
  }
  const addons: PreorderAddonDishTotal[] = []

  for (const [key, tally] of tallies) {
    const menuItemId = key.slice(key.indexOf(':') + 1)
    const itemName = Array.from(tally.names.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0][0]

    if (tally.course === PREORDER_ADDON_COURSE) {
      const commonestPrice =
        Array.from(tally.prices.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null
      addons.push({
        menuItemId,
        itemName,
        count: tally.count,
        unitPriceGbp: commonestPrice,
        totalGbp: tally.pence / 100,
        hasUnpricedSelection: tally.unpriced > 0,
      })
    } else {
      byCourse[tally.course].push({ menuItemId, itemName, count: tally.count })
    }
  }

  for (const course of PREORDER_COURSES) {
    // Busiest dish first: that is the order the kitchen prepping the day wants to read it in.
    byCourse[course].sort((a, b) => b.count - a.count || a.itemName.localeCompare(b.itemName))
  }
  addons.sort((a, b) => b.count - a.count || a.itemName.localeCompare(b.itemName))

  const withdrawn = Array.from(withdrawnTallies.values()).sort(
    (a, b) =>
      PREORDER_SELECTION_COURSES.indexOf(a.course) - PREORDER_SELECTION_COURSES.indexOf(b.course) ||
      b.count - a.count ||
      a.itemName.localeCompare(b.itemName),
  )

  return {
    date: input.date,
    bookingCount: input.bookingCount,
    coverCount: input.coverCount,
    pendingPaymentBookingCount: input.pendingPaymentBookingCount ?? 0,
    lateChangeCount: input.lateChangeCount ?? 0,
    christmasTiers: input.christmasTiers ?? emptyChristmasTierTotals(),
    withdrawn,
    byCourse,
    addons,
    addonTotalGbp: addons.reduce((running, addon) => running + toPence(addon.totalGbp), 0) / 100,
    addonHasUnpricedSelection: addons.some((addon) => addon.hasUnpricedSelection),
  }
}

/**
 * What the kitchen has to cook on a date.
 *
 * Deliberately three plain queries rather than one nested embed: PostgREST embeds break silently
 * when a second foreign key appears between the same pair of tables, and a kitchen prep list that
 * quietly returns nothing is worse than one that costs two extra round trips. Volumes are a day of
 * bookings, not a year.
 */
export async function loadPreorderDishTotals(
  supabase: Db,
  date: string,
  options: { cutoffDays?: number } = {},
): Promise<PreorderDishTotals> {
  const empty = emptyPreorderDishTotals(date)

  const { data: bookingRows, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id, status, booking_type, party_size, christmas_course_counts, booking_period_id')
    .eq('booking_date', date)
    .not('status', 'in', `(${DEAD_BOOKING_STATUSES.join(',')})`)

  if (bookingError) throw bookingError

  const dateBookings = (bookingRows ?? []) as Array<{
    id: string
    status: string | null
    booking_type: string | null
    party_size: number | null
    christmas_course_counts: number[] | null
    booking_period_id: string | null
  }>
  if (dateBookings.length === 0) return empty

  // When each booking's form locks: used to count a choice a manager recorded after it, and to
  // scope the noon kitchen order to the bookings whose own form has just locked.
  const periodIds = Array.from(
    new Set(dateBookings.map((row) => row.booking_period_id).filter((id): id is string => Boolean(id))),
  )
  const cutoffDaysByPeriod = new Map<string, number | null>()
  await Promise.all(
    periodIds.map(async (periodId) => {
      cutoffDaysByPeriod.set(periodId, await loadPreorderCutoffDays(supabase, periodId))
    }),
  )
  // A date can hold bookings from periods with different cutoffs; the later one is still being
  // edited, so its choices must not reach a kitchen order sent at the earlier cutoff.
  const bookings =
    options.cutoffDays === undefined
      ? dateBookings
      : dateBookings.filter(
          (row) => row.booking_period_id !== null && cutoffDaysByPeriod.get(row.booking_period_id) === options.cutoffDays,
        )
  if (bookings.length === 0) return empty

  const christmasTiers = summariseChristmasTiers(
    bookings
      .filter((row) => row.booking_type === 'christmas')
      .map((row) => ({ partySize: row.party_size, courseCounts: row.christmas_course_counts })),
  )
  const bookingIds = bookings.map((row) => row.id)
  const statusById = new Map(bookings.map((row) => [row.id, row.status]))

  const { data: coverRows, error: coverError } = await supabase
    .from('booking_preorder_covers')
    .select('id, table_booking_id')
    .in('table_booking_id', bookingIds)

  if (coverError) throw coverError

  const covers = (coverRows ?? []) as Array<{ id: string; table_booking_id: string }>
  if (covers.length === 0) return { ...empty, christmasTiers }

  // price_gbp is read here and nowhere else in this query, purely so the add-on money total is
  // summed from what each guest was actually quoted rather than from today's menu.
  const { data: selectionRows, error: selectionError } = await supabase
    .from('booking_preorder_selections')
    .select('cover_id, course, menu_item_id, item_name, price_gbp, created_at')
    .in(
      'cover_id',
      covers.map((cover) => cover.id),
    )

  if (selectionError) throw selectionError

  const rawSelections = (selectionRows ?? []) as Array<{
    cover_id: string
    course: string
    menu_item_id: string
    item_name: string
    price_gbp: number | string | null
    created_at: string | null
  }>

  const bookingIdByCover = new Map(covers.map((cover) => [cover.id, cover.table_booking_id]))
  const periodByBooking = new Map(bookings.map((row) => [row.id, row.booking_period_id]))
  const closesAtFor = (coverId: string): Date | null => {
    const periodId = periodByBooking.get(bookingIdByCover.get(coverId) ?? '') ?? null
    if (!periodId) return null
    return getPreorderCutoff({ bookingDate: date, preorderCutoffDays: cutoffDaysByPeriod.get(periodId) ?? null })
      .closesAt
  }
  const lateChangeCount = rawSelections.filter((row) =>
    isChangedAfterCutoff(row.created_at, closesAtFor(row.cover_id)),
  ).length
  const withdrawnIds = await loadWithdrawnMenuItemIds(
    supabase,
    Array.from(new Set(rawSelections.map((row) => row.menu_item_id))),
  )

  const selections: Array<
    Pick<PreorderSelection, 'course' | 'menuItemId' | 'itemName'> & {
      priceGbp: number | null
      itemWithdrawn: boolean
    }
  > = []
  for (const row of rawSelections) {
    if (!isPreorderSelectionCourse(row.course)) continue
    selections.push({
      course: row.course,
      menuItemId: row.menu_item_id,
      itemName: row.item_name,
      priceGbp: toNullableNumber(row.price_gbp),
      itemWithdrawn: withdrawnIds.has(row.menu_item_id),
    })
  }

  const coveredBookingIds = new Set(covers.map((cover) => cover.table_booking_id))
  return summarisePreorderDishTotals({
    date,
    bookingCount: coveredBookingIds.size,
    coverCount: covers.length,
    pendingPaymentBookingCount: Array.from(coveredBookingIds).filter(
      (id) => statusById.get(id) === 'pending_payment',
    ).length,
    lateChangeCount,
    christmasTiers,
    selections,
  })
}

// ---------------------------------------------------------------------------
// Withdrawn dishes
// ---------------------------------------------------------------------------

export type WithdrawnPreorderChoice = {
  tableBookingId: string
  bookingReference: string
  bookingDate: string
  coverId: string
  ordinal: number
  guestName: string | null
  /** May be 'addon': a withdrawn add-on is still a call to make, so it is reported like any other. */
  course: PreorderSelectionCourse
  menuItemId: string
  itemName: string
}

/**
 * Live choices pointing at a dish a manager has since deactivated.
 *
 * Drives three things: the "please choose again" flag on the staff screen and the booker's manage
 * page, and the nightly report. Explicitly NOT a trigger for mass re-messaging: at these volumes a
 * manager rings the affected bookings, and an automated burst to every Christmas booker is a worse
 * outcome than a short call list.
 */
export async function findWithdrawnPreorderChoices(
  supabase: Db,
  options: { fromDate: string; tableBookingIds?: string[] },
): Promise<WithdrawnPreorderChoice[]> {
  const { data: itemRows, error: itemError } = await supabase
    .from('booking_period_menu_items')
    .select('id')
    .eq('is_active', false)

  if (itemError) throw itemError

  const withdrawnItemIds = ((itemRows ?? []) as Array<{ id: string }>).map((row) => row.id)
  if (withdrawnItemIds.length === 0) return []

  const { data: selectionRows, error: selectionError } = await supabase
    .from('booking_preorder_selections')
    .select('cover_id, course, menu_item_id, item_name')
    .in('menu_item_id', withdrawnItemIds)

  if (selectionError) throw selectionError

  const selections = (selectionRows ?? []) as Array<{
    cover_id: string
    course: string
    menu_item_id: string
    item_name: string
  }>
  if (selections.length === 0) return []

  const { data: coverRows, error: coverError } = await supabase
    .from('booking_preorder_covers')
    .select('id, table_booking_id, ordinal, guest_name')
    .in('id', Array.from(new Set(selections.map((row) => row.cover_id))))

  if (coverError) throw coverError

  const covers = new Map<string, { tableBookingId: string; ordinal: number; guestName: string | null }>()
  for (const row of (coverRows ?? []) as Array<{
    id: string
    table_booking_id: string
    ordinal: number
    guest_name: string | null
  }>) {
    covers.set(row.id, {
      tableBookingId: row.table_booking_id,
      ordinal: row.ordinal,
      guestName: row.guest_name ?? null,
    })
  }

  const candidateBookingIds = Array.from(new Set(Array.from(covers.values()).map((c) => c.tableBookingId)))
  const wanted = options.tableBookingIds
    ? candidateBookingIds.filter((id) => options.tableBookingIds?.includes(id))
    : candidateBookingIds
  if (wanted.length === 0) return []

  const { data: bookingRows, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, booking_date')
    .in('id', wanted)
    // A dish withdrawn from a booking that has already happened is history, not a call to make.
    .gte('booking_date', options.fromDate)
    .not('status', 'in', `(${DEAD_BOOKING_STATUSES.join(',')})`)

  if (bookingError) throw bookingError

  const bookings = new Map<string, { bookingReference: string; bookingDate: string }>()
  for (const row of (bookingRows ?? []) as Array<{
    id: string
    booking_reference: string
    booking_date: string
  }>) {
    bookings.set(row.id, { bookingReference: row.booking_reference, bookingDate: row.booking_date })
  }

  const results: WithdrawnPreorderChoice[] = []
  for (const selection of selections) {
    if (!isPreorderSelectionCourse(selection.course)) continue
    const cover = covers.get(selection.cover_id)
    if (!cover) continue
    const booking = bookings.get(cover.tableBookingId)
    if (!booking) continue

    results.push({
      tableBookingId: cover.tableBookingId,
      bookingReference: booking.bookingReference,
      bookingDate: booking.bookingDate,
      coverId: selection.cover_id,
      ordinal: cover.ordinal,
      guestName: cover.guestName,
      course: selection.course,
      menuItemId: selection.menu_item_id,
      itemName: selection.item_name,
    })
  }

  return results.sort(
    (a, b) =>
      a.bookingDate.localeCompare(b.bookingDate) ||
      a.bookingReference.localeCompare(b.bookingReference) ||
      a.ordinal - b.ordinal,
  )
}
