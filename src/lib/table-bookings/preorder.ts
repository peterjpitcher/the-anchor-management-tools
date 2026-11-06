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
 * THE COMPLETENESS RULE (owner decision D4, 6 November 2026). On a booking with a course list, which
 * is every Christmas booking since the food link release, each seat needs a name, an answer to the
 * allergy question (with details when it is yes), its number of courses (`christmas_course_counts`,
 * 0 meaning not chosen yet), a main, and on 2 courses one of a starter or a dessert, on 3 courses
 * both. A seat may not hold more courses than its tier pays for, because the kitchen would cook a
 * course nobody paid for, and a kids main is 1 course only. A booking that recorded no tiers keeps
 * the rule it was taken under, owner-confirmed 2026-08-04: every cover needs a MAIN, and a starter
 * and a dessert are optional.
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
import { isValidIsoDate, parseLondonDateTimeLocal, shiftIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import {
  PREORDER_ADDON_COURSE,
  PREORDER_ALLERGY_DETAIL_MAX_LENGTH,
  PREORDER_COURSES,
  PREORDER_DIETARY_NOTE_MAX_LENGTH,
  PREORDER_GUEST_NAME_MAX_LENGTH,
  PREORDER_INVITE_EMAIL_MAX_LENGTH,
  PREORDER_MANAGER_STAGE,
  PREORDER_SAVED_BY,
  PREORDER_SELECTION_COURSES,
  type PreorderAddonSummary,
  type PreorderChaseChannel,
  type PreorderCourse,
  type PreorderCourseCount,
  type PreorderCover,
  type PreorderCoverAddonSummary,
  type PreorderCoverRow,
  type PreorderLegacyReminderKind,
  type PreorderManagerStage,
  type PreorderMenuItemFacts,
  type PreorderOrder,
  type PreorderOrderAddonSummary,
  type PreorderOrganiserStage,
  type PreorderSavedBy,
  type PreorderSeatCourseCount,
  type PreorderSelection,
  type PreorderSelectionCourse,
  type PreorderSelectionRow,
} from '@/types/preorders'

type Db = SupabaseClient<any, any, any>

/** Bookings that are off the books entirely. Their choices must not reach a kitchen prep list. */
const DEAD_BOOKING_STATUSES = ['cancelled', 'no_show'] as const

const COVER_COLUMNS =
  'id, table_booking_id, ordinal, guest_name, dietary_note, has_allergies, allergy_detail, invite_email, ' +
  'invite_sent_at, invite_reminded_at, last_saved_by, last_saved_at, created_at, updated_at'
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

function toPreorderSavedBy(value: string | null | undefined): PreorderSavedBy | null {
  return (PREORDER_SAVED_BY as readonly string[]).includes(value ?? '') ? (value as PreorderSavedBy) : null
}

export function mapPreorderSelectionRow(
  row: PreorderSelectionRow,
  options: { itemWithdrawn?: boolean; isChildOption?: boolean } = {},
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
    ...(options.isChildOption === undefined ? {} : { isChildOption: options.isChildOption }),
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
    hasAllergies: typeof row.has_allergies === 'boolean' ? row.has_allergies : null,
    allergyDetail: row.allergy_detail ?? null,
    inviteEmail: row.invite_email ?? null,
    inviteSentAt: row.invite_sent_at ?? null,
    inviteRemindedAt: row.invite_reminded_at ?? null,
    lastSavedBy: toPreorderSavedBy(row.last_saved_by),
    lastSavedAt: row.last_saved_at ?? null,
    selections,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// The completeness predicate
// ---------------------------------------------------------------------------

/** A recorded tier of 1, 2 or 3, or null for anything else (0 included). */
export function toPreorderCourseCount(value: unknown): PreorderCourseCount | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : null
}

/** A seat's tier as the booking may now hold it, 0 ("not chosen yet") to 3, or null for anything else. */
export function toPreorderSeatCourseCount(value: unknown): PreorderSeatCourseCount | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return parsed === 0 ? 0 : toPreorderCourseCount(parsed)
}

/**
 * The tier recorded for one seat (1-based): 0 to 3, or null when the booking recorded no list. Read
 * from the order's own list first, because a seat can have no cover row yet and still owe its courses.
 */
export function getSeatCourseCount(
  order: Pick<PreorderOrder, 'courseCounts' | 'covers'>,
  ordinal: number,
): PreorderSeatCourseCount | null {
  const fromOrder = order.courseCounts?.[ordinal - 1]
  if (fromOrder !== undefined && fromOrder !== null) return toPreorderSeatCourseCount(fromOrder)
  const cover = order.covers.find((entry) => entry.ordinal === ordinal)
  return toPreorderSeatCourseCount(cover?.courseCount ?? null)
}

/**
 * One seat as the completeness rule reads it: a saved cover, or a draft on screen. Only the course of
 * each choice matters, so add-ons can sit in `selections` without changing the answer.
 *
 * `courseCount` is the seat's tier from the booking's list, 0 to 3. Null or absent means the booking
 * has no list at all, an older booking that keeps the rule it was taken under (a main only), and the
 * name and allergy fields are then not asked for.
 */
export type PreorderSeatDraft = {
  selections: ReadonlyArray<Pick<PreorderSelection, 'course'>>
  courseCount?: PreorderSeatCourseCount | null
  guestName?: string | null
  hasAllergies?: boolean | null
  allergyDetail?: string | null
}

function chosenCourses(cover: Pick<PreorderSeatDraft, 'selections'>): Set<PreorderCourse> {
  const chosen = new Set<PreorderCourse>()
  for (const selection of cover.selections) {
    if (isPreorderCourse(selection.course)) chosen.add(selection.course)
  }
  return chosen
}

/**
 * The most starters and desserts together that a seat on this tier may hold. Every tier has a main;
 * a 2 course seat is a main and ONE other, so a starter and a dessert together is a course nobody has
 * paid for, and a seat on 0 or 1 has neither.
 */
function maxOtherCourses(courseCount: PreorderSeatCourseCount | null | undefined): number {
  if (courseCount === 0 || courseCount === 1) return 0
  if (courseCount === 2) return 1
  return 2
}

/** "a, b and c". */
function joinMissing(parts: string[]): string | null {
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * What one seat still needs, as words that finish "Seat 2 needs ...", or null when nothing is owed.
 * For example "a name, their allergies and a main".
 *
 * A seat on a booking with a course list (every Christmas booking since the food link release, owner
 * decision D4 of 6 November 2026) needs, in this order: a name, an answer to the allergy question
 * (with details when the answer is yes), its number of courses, a main, and on 2 courses one of a
 * starter or a dessert, on 3 courses both. A seat on a booking with no list keeps the old rule: a
 * main, nothing else. Add-ons never count either way.
 */
export function describeCoverMissingCourses(cover: PreorderSeatDraft): string | null {
  const courseCount = toPreorderSeatCourseCount(cover.courseCount ?? null)
  const chosen = chosenCourses(cover)
  const hasMain = chosen.has('main')

  if (courseCount === null) return hasMain ? null : 'a main'

  const missing: string[] = []
  if (!cover.guestName || cover.guestName.trim() === '') missing.push('a name')
  if (cover.hasAllergies === null || cover.hasAllergies === undefined) missing.push('their allergies')
  else if (cover.hasAllergies && (!cover.allergyDetail || cover.allergyDetail.trim() === '')) {
    missing.push('details of their allergies')
  }
  if (courseCount === 0) missing.push('their number of courses')

  if (courseCount === 2) {
    const others = (chosen.has('starter') ? 1 : 0) + (chosen.has('dessert') ? 1 : 0)
    if (others > 1) {
      // Only reachable from a save made before the tier was enforced. Say what to take off.
      missing.push(hasMain ? 'only one of the starter and the dessert' : 'a main in place of the starter or the dessert')
    } else if (!hasMain && others === 0) missing.push('a main, plus a starter or a dessert')
    else if (!hasMain) missing.push('a main')
    else if (others === 0) missing.push('a starter or a dessert')
  } else if (courseCount === 3) {
    for (const course of ['starter', 'main', 'dessert'] as const) {
      if (!chosen.has(course)) missing.push(`a ${course}`)
    }
  } else if (!hasMain) {
    missing.push('a main')
  }

  return joinMissing(missing)
}

/**
 * A seat is complete when `describeCoverMissingCourses` finds nothing missing: on a booking with a
 * course list, a tier of 1 to 3, a name, the allergy question answered, a main and the other courses
 * its tier pays for; on a booking without one, a main.
 *
 * Add-ons deliberately cannot reach this function's answer. A seat that has ticked the cheeseboard
 * and chosen no main is NOT complete, and a seat with its courses and no add-ons IS. Anything else
 * would mean the chase cron nagged a guest for not buying an extra.
 */
export function isCoverComplete(cover: PreorderSeatDraft): boolean {
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
  /** 0 to 3, or null on a booking with no course list. */
  courseCount: PreorderSeatCourseCount | null
  /** The name on the seat, so a reminder can say who is still missing. Null when none is given yet. */
  guestName: string | null
  /** Words that finish "Seat 2 needs ...", for example "a name, their allergies and a main". */
  missing: string
}

export type PreorderCompleteness = {
  /** Every seat has a cover, and every cover has everything `describeCoverMissingCourses` asks for. */
  complete: boolean
  partySize: number
  coverCount: number
  /**
   * Seat numbers that still owe something, in seat order. Kept under its old name for its callers;
   * it means "still owes something", not only "has no main".
   */
  ordinalsMissingMain: number[]
  /** The same seats, with their tier, name and what each still needs, in seat order. */
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

  // Every seat in the party, whether or not it has a cover row yet: a seat with no row owes
  // everything, and saying what is more use than "no order started".
  const seatsIncomplete: PreorderSeatGap[] = []
  const seatsWithoutCover: number[] = []
  for (let ordinal = 1; ordinal <= order.partySize; ordinal += 1) {
    const cover = coversByOrdinal.get(ordinal)
    const courseCount = getSeatCourseCount(withTiers, ordinal)
    const missing = describeCoverMissingCourses({
      selections: cover?.selections ?? [],
      courseCount,
      guestName: cover?.guestName ?? null,
      hasAllergies: cover?.hasAllergies ?? null,
      allergyDetail: cover?.allergyDetail ?? null,
    })
    if (missing === null) continue
    seatsIncomplete.push({ ordinal, courseCount, guestName: cover?.guestName?.trim() || null, missing })
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
export function describeCourseCount(courseCount: PreorderSeatCourseCount | null | undefined): string {
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

// ---------------------------------------------------------------------------
// The reminder ladder (owner decisions D6 and D7, 6 November 2026)
// ---------------------------------------------------------------------------

/** One rung of the ladder, with when it falls due. */
export type PreorderLadderStage = {
  kind: PreorderOrganiserStage | PreorderManagerStage
  audience: 'organiser' | 'manager'
  channels: PreorderChaseChannel[]
  dueAt: Date
}

/**
 * When each rung falls due for a booking, earliest first, or an empty list when the booking has no
 * cutoff (no seasonal period, or the period has gone).
 *
 *   booker_21d, booker_14d, booker_10d   12:00 London on the booking date less 21, 14 and 10 days, email
 *   booker_day_before                    12:00 London on the day before the cutoff, email and text
 *   booker_cutoff_morning                09:00 London on cutoff day, email and text
 *   manager_day_before                   12:00 London on the day before the cutoff, email
 *
 * The cutoff day is the booking date less `preorderCutoffDays`, the date `getPreorderCutoff` locks
 * the form at noon. The noon rungs are sent by the 12:00 cron and the 09:00 rung by the 09:00 cron,
 * which is 9am London through the Christmas window (A5). Times are worked out with the project's
 * date module on the London clock, so the answer does not move with the server's time zone.
 */
export function getPreorderLadderStages(input: {
  bookingDate: string
  preorderCutoffDays: number | null
}): PreorderLadderStage[] {
  const { bookingDate, preorderCutoffDays } = input
  if (preorderCutoffDays === null || !Number.isInteger(preorderCutoffDays) || preorderCutoffDays < 0) return []
  if (!isValidIsoDate(bookingDate)) return []
  const cutoffDate = shiftIsoDate(bookingDate, -preorderCutoffDays)
  if (!cutoffDate) return []

  const at = (isoDate: string | null, time: string): Date | null =>
    isoDate ? whenLondonClockReaches(isoDate, time) : null
  const dayBeforeCutoff = shiftIsoDate(cutoffDate, -1)

  const rungs: Array<[PreorderLadderStage['kind'], PreorderLadderStage['audience'], PreorderChaseChannel[], Date | null]> = [
    ['booker_21d', 'organiser', ['email'], at(shiftIsoDate(bookingDate, -21), '12:00')],
    ['booker_14d', 'organiser', ['email'], at(shiftIsoDate(bookingDate, -14), '12:00')],
    ['booker_10d', 'organiser', ['email'], at(shiftIsoDate(bookingDate, -10), '12:00')],
    ['booker_day_before', 'organiser', ['email', 'sms'], at(dayBeforeCutoff, '12:00')],
    ['booker_cutoff_morning', 'organiser', ['email', 'sms'], at(cutoffDate, '09:00')],
    ['manager_day_before', 'manager', ['email'], at(dayBeforeCutoff, '12:00')],
  ]

  return rungs
    .filter((rung): rung is [PreorderLadderStage['kind'], PreorderLadderStage['audience'], PreorderChaseChannel[], Date] => rung[3] !== null)
    .map(([kind, audience, channels, dueAt]) => ({ kind, audience, channels, dueAt }))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
}

/** A seat that may be owed a guest reminder: one the organiser sent a link for. */
export type PreorderChaseSeat = {
  coverId: string
  ordinal: number
  /** When the guest's invite went out (`invite_sent_at`), or null when they were never sent a link. */
  inviteSentAt: string | Date | null
  /** `isCoverComplete` for this seat. */
  complete: boolean
}

export type PreorderChaseInput = {
  /** The moment of the run. Injected so the ladder is a pure function. */
  now: Date
  /** The booking date, YYYY-MM-DD (London). */
  bookingDate: string
  /** The period's `preorder_cutoff_days`, or null when the booking has no seasonal period. */
  preorderCutoffDays: number | null
  /** When the booking was made. A rung that fell due before this is never sent. Null skips the check. */
  bookingCreatedAt: string | Date | null
  /** Whether the whole order is complete (`getPreorderCompleteness(order).complete`). */
  complete: boolean
  /** Ledger rows already claimed for this booking, of any kind. A guest row carries its seat. */
  sent: ReadonlyArray<{ kind: string; coverId?: string | null }>
  /** The seats, for the guest reminders. Omit when there are none to consider. */
  seats?: ReadonlyArray<PreorderChaseSeat>
}

/** One message the run should claim in the ledger and send. */
export type PreorderChase =
  | { audience: 'organiser'; kind: PreorderOrganiserStage; channels: PreorderChaseChannel[]; dueAt: Date }
  | { audience: 'manager'; kind: PreorderManagerStage; channels: PreorderChaseChannel[]; dueAt: Date }
  | {
      audience: 'guest'
      kind: 'guest_reminder'
      coverId: string
      ordinal: number
      channels: PreorderChaseChannel[]
      dueAt: Date
    }

export type PreorderChaseDecision = {
  /** What to send this run, organiser first, then the manager, then guests in seat order. */
  due: PreorderChase[]
  /** When the form locks (noon London on cutoff day), or null when nothing locks it. */
  cutoffAt: Date | null
  /** True once the form has locked: nothing more goes to the organiser or a guest. */
  locked: boolean
}

function toTime(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Which chases a booking is due this run: the D6 ladder for the organiser, the D7 call list for the
 * owner, and one reminder for each guest who was sent their own link.
 *
 * ORGANISER. While the order is incomplete and the form has not locked, the organiser is sent the
 * LATEST rung that is due and has not been sent. Earlier rungs that were missed are skipped, never
 * sent in a burst: a cron that was down for a week sends one message when it comes back, not three.
 * A rung that fell due before the booking was made is skipped too, so a booking made 12 days out
 * starts at the 10 day rung. Nothing goes to the organiser once the form locks or the order is
 * complete.
 *
 * MANAGER. `manager_day_before`, once due, while anything is missing and the form has not locked,
 * and not for a booking made after it fell due. Sent once.
 *
 * GUESTS. One `guest_reminder` per seat whose guest was sent a link before the day-before-the-cutoff
 * rung fell due and whose seat is still incomplete, at that rung's time, until the form locks. Once
 * per seat, whatever happens to the rest of the booking.
 *
 * The ledger (`booking_preorder_reminders`) is still the idempotency: the caller claims each kind
 * (with the seat, for a guest) before sending, and a duplicate key means somebody already sent it.
 * The legacy kinds (`booker_reminder`, `manager_escalation`) never count as a rung of this ladder.
 */
export function decidePreorderChases(input: PreorderChaseInput): PreorderChaseDecision {
  const nowMs = input.now.getTime()
  const cutoff = getPreorderCutoff({
    bookingDate: input.bookingDate,
    preorderCutoffDays: input.preorderCutoffDays,
    now: input.now,
  })
  if (!cutoff.closesAt) return { due: [], cutoffAt: null, locked: false }
  if (cutoff.closed) return { due: [], cutoffAt: cutoff.closesAt, locked: true }

  const stages = getPreorderLadderStages(input)
  const createdMs = toTime(input.bookingCreatedAt)
  const sentKinds = new Set(input.sent.filter((row) => !row.coverId).map((row) => row.kind))
  const isDue = (stage: PreorderLadderStage) =>
    stage.dueAt.getTime() <= nowMs && (createdMs === null || stage.dueAt.getTime() >= createdMs)

  const due: PreorderChase[] = []
  if (!input.complete) {
    const organiserDue = stages.filter((stage) => stage.audience === 'organiser' && isDue(stage))
    const latest = organiserDue[organiserDue.length - 1]
    if (latest && !sentKinds.has(latest.kind)) {
      due.push({
        audience: 'organiser',
        kind: latest.kind as PreorderOrganiserStage,
        channels: latest.channels,
        dueAt: latest.dueAt,
      })
    }

    const manager = stages.find((stage) => stage.kind === PREORDER_MANAGER_STAGE)
    if (manager && isDue(manager) && !sentKinds.has(manager.kind)) {
      due.push({ audience: 'manager', kind: PREORDER_MANAGER_STAGE, channels: manager.channels, dueAt: manager.dueAt })
    }
  }

  const guestRung = stages.find((stage) => stage.kind === 'booker_day_before')
  if (guestRung && guestRung.dueAt.getTime() <= nowMs) {
    const remindedSeats = new Set(
      input.sent.filter((row) => row.kind === 'guest_reminder' && row.coverId).map((row) => row.coverId as string),
    )
    const seats = [...(input.seats ?? [])].sort((a, b) => a.ordinal - b.ordinal)
    for (const seat of seats) {
      const invitedMs = toTime(seat.inviteSentAt)
      if (seat.complete || invitedMs === null || invitedMs > guestRung.dueAt.getTime()) continue
      if (remindedSeats.has(seat.coverId)) continue
      due.push({
        audience: 'guest',
        kind: 'guest_reminder',
        coverId: seat.coverId,
        ordinal: seat.ordinal,
        channels: ['email'],
        dueAt: guestRung.dueAt,
      })
    }
  }

  return { due, cutoffAt: cutoff.closesAt, locked: false }
}

/**
 * The first release's two-message chase, kept unchanged so the reminder cron keeps working until it
 * is moved onto `decidePreorderChases`. Do not use it for anything new.
 */
export type LegacyPreorderChaseInput = {
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
 * THE ESCALATION WAITS FOR THE FORM TO LOCK. While the organiser can still choose online, the
 * manager is not asked to ring them, whichever sweep of the day this is.
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
export function decideLegacyPreorderChases(input: LegacyPreorderChaseInput): PreorderLegacyReminderKind[] {
  const { daysUntilBooking, cutoffDays, bookerReminderSentOn, managerEscalationSent, todayIso, preorderClosed } =
    input

  const due: PreorderLegacyReminderKind[] = []

  // "At or inside" rather than "exactly on", so one failed cron run does not lose the message for
  // good. The ledger is what stops it being sent twice.
  const bookerDue =
    !preorderClosed && bookerReminderSentOn === null && daysUntilBooking <= PREORDER_BOOKER_REMINDER_DAYS
  if (bookerDue) due.push('booker_reminder')

  const bookerHasHadTheirTurn = bookerReminderSentOn !== null && bookerReminderSentOn < todayIso
  const noLaterSweep = daysUntilBooking <= 0
  // Locked before the booker was ever asked: waiting for their turn would mean waiting for ever.
  const bookerCannotAct = preorderClosed && bookerReminderSentOn === null

  // Only once the form has locked. The cron used to run once, at 12:00 UTC, which is at or after
  // noon London, so on the cutoff day the form had always locked by the time the manager was told.
  // It now runs at 09:00 as well, while the form is still open until noon: the manager must not be
  // asked to ring a booker who can still choose online, so the escalation waits for the locked run.
  if (
    preorderClosed &&
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
  return (await loadMenuItemFlags(supabase, menuItemIds)).withdrawn
}

/** Which of these dishes are withdrawn, and which are kids mains, in one read. */
async function loadMenuItemFlags(
  supabase: Db,
  menuItemIds: string[],
): Promise<{ withdrawn: Set<string>; childOption: Set<string> }> {
  const withdrawn = new Set<string>()
  const childOption = new Set<string>()
  if (menuItemIds.length === 0) return { withdrawn, childOption }

  const { data, error } = await supabase
    .from('booking_period_menu_items')
    .select('id, is_active, is_child_option')
    .in('id', menuItemIds)

  if (error) throw error

  for (const row of (data ?? []) as Array<{ id: string; is_active: boolean; is_child_option?: boolean | null }>) {
    if (row.is_active === false) withdrawn.add(row.id)
    if (row.is_child_option === true) childOption.add(row.id)
  }
  return { withdrawn, childOption }
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
  const flags = await loadMenuItemFlags(
    supabase,
    Array.from(new Set(selections.map((row) => row.menu_item_id))),
  )

  const byCover = new Map<string, PreorderSelection[]>()
  for (const row of selections) {
    const mapped = mapPreorderSelectionRow(row, {
      itemWithdrawn: flags.withdrawn.has(row.menu_item_id),
      isChildOption: flags.childOption.has(row.menu_item_id),
    })
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
    christmas_course_counts?: number[] | null
  }

  const [covers, preorderCutoffDays, menuItems] = await Promise.all([
    loadCoversWithSelections(supabase, tableBookingId),
    loadPreorderCutoffDays(supabase, booking.booking_period_id),
    loadPeriodMenuItemFacts(supabase, booking.booking_period_id),
  ])

  // 0 is "not chosen yet". Anything the database could not have written is read as not chosen too,
  // so the seat is asked again rather than given a tier nobody picked.
  const courseCounts = Array.isArray(booking.christmas_course_counts)
    ? booking.christmas_course_counts.map((count) => toPreorderSeatCourseCount(count) ?? 0)
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
    // Matches preorder_sync_covers, which keeps a seat per guest on both (BK-148).
    hasGuestSeats:
      booking.booking_period_answer === true &&
      (booking.booking_period_requires_preorder === true || courseCounts !== null),
    bookingAllergies: booking.allergies ?? [],
    periodId: booking.booking_period_id ?? null,
    periodName: booking.booking_period_name ?? null,
    preorderCutoffDays,
    courseCounts,
    menuItems,
    covers: covers.map((cover) => ({ ...cover, courseCount: courseCounts?.[cover.ordinal - 1] ?? null })),
  }
}

/** Every dish on the period's menu, withdrawn ones included, with whether each is a kids main. */
async function loadPeriodMenuItemFacts(supabase: Db, periodId: string | null): Promise<PreorderMenuItemFacts[]> {
  if (!periodId) return []

  const { data, error } = await supabase
    .from('booking_period_menu_items')
    .select('id, course, name, is_active, is_child_option, sort_order')
    .eq('period_id', periodId)
    .order('sort_order', { ascending: true })

  if (error) throw error

  return ((data ?? []) as Array<{
    id: string
    course: string
    name: string
    is_active: boolean
    is_child_option?: boolean | null
  }>).map((row) => ({
    id: row.id,
    course: row.course,
    name: row.name,
    isActive: row.is_active !== false,
    isChildOption: row.is_child_option === true,
  }))
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

/**
 * Who is saving, which decides what the save may touch.
 *
 *   organiser  the booker, from their own food page;
 *   guest      one guest, from the link sent to them. `coverId` is the seat that link is scoped to
 *              (`resolvePreorderGuestToken`), and the save is refused for any other seat;
 *   staff      the management app. Only a staff save sets the seat's tier through the deadline.
 *
 * Callers still decide whether the form is open (`getPreorderCutoff`): this function does not lock
 * anyone out, because staff may save after the cutoff and the booking route saves at booking time.
 */
export type PreorderSaveActor =
  | { savedBy: 'organiser' }
  | { savedBy: 'staff' }
  | { savedBy: 'guest'; coverId: string }

export type SavePreorderCoverInput = {
  coverId: string
  /** Who is saving. Recorded on the seat as `last_saved_by`, with `last_saved_at`. */
  actor: PreorderSaveActor
  /**
   * The booking the caller has proven access to. When given, a seat on any other booking is refused,
   * so a cover id from a request body cannot reach another party's seat.
   */
  tableBookingId?: string
  /** Omit to leave as it is. Pass null to clear. */
  guestName?: string | null
  dietaryNote?: string | null
  /** Omit to leave as it is. Null is "not answered". False also clears `allergyDetail`. */
  hasAllergies?: boolean | null
  allergyDetail?: string | null
  /**
   * The guest's own address for their food link (A4). Organiser and staff only; a guest save that
   * sends one is refused. Stored trimmed and in lower case.
   */
  inviteEmail?: string | null
  /**
   * The seat's tier, 0 to 3. Set through `set_christmas_seat_course_v01` before any dish is checked,
   * so a guest choosing "2 courses" and a starter in one save is judged on 2 courses. Moving down
   * clears the dishes the new tier does not have, in the database. Only for a booking with a course
   * list; omit to leave the tier alone.
   */
  courseCount?: PreorderSeatCourseCount
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

/** A save that reaches past what its actor may touch. Its message is safe to show to that person. */
export class PreorderSaveScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreorderSaveScopeError'
  }
}

/** Loose shape check, the same one the email-capture page uses. */
function isPlausibleInviteEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

/**
 * Save one seat: its name, allergies, dietary note, invite address, tier and courses.
 *
 * The organiser's page, a guest's own link and the staff screen all write through here, so there is
 * one rule and one audit trail. Prices and dish names are SNAPSHOT from booking_period_menu_items at
 * the moment of choosing, so a later menu edit cannot rewrite what the guest picked or make the
 * kitchen list disagree with it.
 *
 * The item is validated against the booking's own period. Without that check a caller could snapshot
 * last year's turkey onto this year's booking, and nothing in the database would notice.
 *
 * Every save records who made it (`last_saved_by`) and when (`last_saved_at`), so the organiser's
 * page can show "Chosen by Sam" and the kitchen sheet can tell a staff correction from a guest's own
 * choice.
 */
export async function savePreorderCover(
  supabase: Db,
  input: SavePreorderCoverInput,
): Promise<PreorderCover> {
  const savedBy = input.actor?.savedBy
  if (!(PREORDER_SAVED_BY as readonly string[]).includes(savedBy ?? '')) {
    throw new Error('A pre-order save must say who is saving it.')
  }
  if (input.actor.savedBy === 'guest' && input.actor.coverId !== input.coverId) {
    // A guest's link names one seat. Anything else is somebody else's dinner.
    throw new PreorderSaveScopeError('This link is for one guest only, so it cannot change anyone else.')
  }
  if (input.actor.savedBy === 'guest' && input.inviteEmail !== undefined) {
    throw new PreorderSaveScopeError('Only the organiser can change who is sent a link.')
  }

  const { data: coverRow, error: coverError } = await supabase
    .from('booking_preorder_covers')
    .select(COVER_COLUMNS)
    .eq('id', input.coverId)
    .maybeSingle()

  if (coverError) throw coverError
  if (!coverRow) throw new Error('That seat no longer exists on this booking.')

  const cover = coverRow as unknown as PreorderCoverRow
  if (input.tableBookingId !== undefined && cover.table_booking_id !== input.tableBookingId) {
    throw new PreorderSaveScopeError('That seat is not on this booking. Refresh the page and try again.')
  }

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

  // Checked before anything is written, so a refused save changes nothing on the seat.
  let inviteEmail: string | null | undefined
  if (input.inviteEmail !== undefined) {
    inviteEmail = normaliseText(input.inviteEmail, PREORDER_INVITE_EMAIL_MAX_LENGTH + 1)?.toLowerCase() ?? null
    if (inviteEmail !== null && (inviteEmail.length > PREORDER_INVITE_EMAIL_MAX_LENGTH || !isPlausibleInviteEmail(inviteEmail))) {
      throw new PreorderSaveScopeError('That email address does not look right. Check it and try again.')
    }
  }
  if (input.courseCount !== undefined && toPreorderSeatCourseCount(input.courseCount) === null) {
    throw new Error('Choose 1, 2 or 3 courses.')
  }

  const cleared = selections.filter((entry) => !entry.menuItemId).map((entry) => entry.course)
  const chosen = selections.filter(
    (entry): entry is PreorderSelectionInput & { menuItemId: string } => Boolean(entry.menuItemId),
  )

  // Every dish is checked against the tier the seat will have after this save, BEFORE the tier is
  // set and before any dish is deleted, so a refused save leaves the seat's tier and dishes exactly
  // as they were. (A withdrawn dessert on a move from 2 to 3 courses used to leave the seat on 3
  // courses with its starter or dessert cleared.)
  const currentCourseCount = await loadSeatCourseCount(supabase, cover.table_booking_id, cover.ordinal)
  const nextCourseCount =
    input.courseCount !== undefined ? toPreorderSeatCourseCount(input.courseCount) : currentCourseCount
  let items: Map<string, SnapshotMenuItem> = new Map()
  if (chosen.length > 0) {
    items = await loadMenuItemsForSnapshot(
      supabase,
      cover.table_booking_id,
      chosen.map((entry) => entry.menuItemId),
    )
    for (const entry of chosen) {
      const item = items.get(entry.menuItemId)
      // Not found here means it is not on this booking's own period.
      if (!item) throw new Error('That dish is not on the menu for this booking.')
      if (!item.isActive) throw new Error(`${item.name} has been taken off the menu. Please choose again.`)
      if (item.course !== entry.course) {
        throw new Error(`${item.name} is not a ${entry.course}.`)
      }
      // Kids mains are 1 course only (A1). The database refuses it too; this says why.
      if (item.isChildOption && (nextCourseCount === 2 || nextCourseCount === 3)) {
        throw new PreorderCourseLimitError(cover.ordinal, nextCourseCount, 'child_option')
      }
    }
    await assertCoursesWithinTier(supabase, cover, {
      from: currentCourseCount,
      to: nextCourseCount,
      cleared,
      chosen: chosen.map((entry) => entry.course),
    })
  }

  // Then the tier, one seat at a time and atomically, so an organiser and a guest saving different
  // seats never overwrite each other's tier. The database clears any dish the new tier does not have.
  if (input.courseCount !== undefined) {
    const { error } = await supabase.rpc('set_christmas_seat_course_v01', {
      p_table_booking_id: cover.table_booking_id,
      p_ordinal: cover.ordinal,
      p_course_count: input.courseCount,
      p_staff_override: input.actor.savedBy === 'staff',
    })
    if (error) throw error
  }

  const courseCount = input.courseCount !== undefined
    ? await loadSeatCourseCount(supabase, cover.table_booking_id, cover.ordinal)
    : currentCourseCount

  const patch: Record<string, unknown> = {
    last_saved_by: input.actor.savedBy,
    last_saved_at: new Date().toISOString(),
  }
  if (input.guestName !== undefined) patch.guest_name = normaliseText(input.guestName, PREORDER_GUEST_NAME_MAX_LENGTH)
  if (input.dietaryNote !== undefined) {
    patch.dietary_note = normaliseText(input.dietaryNote, PREORDER_DIETARY_NOTE_MAX_LENGTH)
  }
  if (input.hasAllergies !== undefined) {
    patch.has_allergies = input.hasAllergies
    if (input.hasAllergies !== true) patch.allergy_detail = null
  }
  if (input.allergyDetail !== undefined && input.hasAllergies !== false && input.hasAllergies !== null) {
    patch.allergy_detail = normaliseText(input.allergyDetail, PREORDER_ALLERGY_DETAIL_MAX_LENGTH)
  }
  if (inviteEmail !== undefined) patch.invite_email = inviteEmail

  const { error: patchError } = await supabase.from('booking_preorder_covers').update(patch).eq('id', cover.id)
  if (patchError) throw patchError

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
      // Every item was checked above, before anything was written.
      const rows = chosen.map((entry) => {
        const item = items.get(entry.menuItemId)
        if (!item) throw new Error('That dish is not on the menu for this booking.')
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
  return { ...saved, courseCount }
}

/**
 * A save that would give a seat more courses than its tier pays for, or a kids main on 2 or 3
 * courses. Its message is written for the person saving, guest or staff, and names the seat and what
 * its tier allows.
 */
export class PreorderCourseLimitError extends Error {
  readonly ordinal: number
  readonly courseCount: PreorderSeatCourseCount
  readonly reason: 'too_many_courses' | 'child_option'

  constructor(
    ordinal: number,
    courseCount: PreorderSeatCourseCount,
    reason: 'too_many_courses' | 'child_option' = 'too_many_courses',
  ) {
    super(
      reason === 'child_option'
        ? `Kids Christmas dinners are 1 course only. Choose 1 course for seat ${ordinal}, or an adult main.`
        : courseCount === 0
          ? `Choose how many courses seat ${ordinal} is having before choosing a starter or a dessert.`
          : courseCount === 1
            ? `Seat ${ordinal} is on 1 course, so choose a main only.`
            : `Seat ${ordinal} is on 2 courses: choose a main, plus a starter or a dessert, not both.`,
    )
    this.name = 'PreorderCourseLimitError'
    this.ordinal = ordinal
    this.courseCount = courseCount
    this.reason = reason
  }
}

/** The tier this seat's booking recorded for it, 0 to 3, or null when the booking recorded none. */
async function loadSeatCourseCount(
  supabase: Db,
  tableBookingId: string,
  ordinal: number,
): Promise<PreorderSeatCourseCount | null> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select('christmas_course_counts')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (error) throw error
  const counts = (data as { christmas_course_counts?: unknown } | null)?.christmas_course_counts
  return Array.isArray(counts) ? (toPreorderSeatCourseCount(counts[ordinal - 1]) ?? 0) : null
}

/**
 * Refuse a save that would leave the seat holding more courses than its tier: a starter or a dessert
 * on 0 or 1 course, or both together on 2. A main is allowed on every tier. The database refuses the
 * first case too, and the kitchen would otherwise cook a course the guest has not paid for. 3 courses
 * and untiered seats cannot go over: a seat holds at most one of each course.
 *
 * Runs before the tier is set, so it judges the seat as it WILL stand: when the tier changes, the
 * database trigger (assert_christmas_course_snapshot_v01) first clears both the starter and the
 * dessert if the new tier is 0 or 1 course, or if the seat holds more of them than the new tier
 * allows. That clearing is mirrored here, then this save's own changes are applied on top.
 */
async function assertCoursesWithinTier(
  supabase: Db,
  cover: PreorderCoverRow,
  tier: {
    from: PreorderSeatCourseCount | null
    to: PreorderSeatCourseCount | null
    cleared: PreorderCourse[]
    chosen: PreorderCourse[]
  },
): Promise<void> {
  const courseCount = tier.to
  if (courseCount === null || courseCount === 3) return

  const { data, error } = await supabase
    .from('booking_preorder_selections')
    .select('course')
    .eq('cover_id', cover.id)

  if (error) throw error

  const after = new Set<PreorderCourse>()
  for (const row of (data ?? []) as Array<{ course: string }>) {
    if (isPreorderCourse(row.course)) after.add(row.course)
  }
  if (tier.from !== courseCount) {
    const others = (after.has('starter') ? 1 : 0) + (after.has('dessert') ? 1 : 0)
    if (courseCount <= 1 || others > courseCount - 1) {
      after.delete('starter')
      after.delete('dessert')
    }
  }
  for (const course of tier.cleared) after.delete(course)
  for (const course of tier.chosen) after.add(course)

  const others = (after.has('starter') ? 1 : 0) + (after.has('dessert') ? 1 : 0)
  if (others > maxOtherCourses(courseCount)) throw new PreorderCourseLimitError(cover.ordinal, courseCount)
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

type SnapshotMenuItem = {
  name: string
  course: string
  priceGbp: number | null
  isActive: boolean
  isChildOption: boolean
}

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
    .select('id, name, course, price_gbp, is_active, is_child_option')
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
    is_child_option?: boolean | null
  }>) {
    items.set(row.id, {
      name: row.name,
      course: row.course,
      priceGbp: toNullableNumber(row.price_gbp),
      isActive: row.is_active !== false,
      isChildOption: row.is_child_option === true,
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
  /**
   * Guests whose seat is on 0, "not chosen yet": since the food link release every Christmas
   * booking starts with a 0 per guest, and the guest chooses their courses on the food page.
   */
  notChosen: number
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
  return { oneCourse: 0, twoCourses: 0, threeCourses: 0, notRecorded: 0, notChosen: 0, guests: 0 }
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
      const tier = toPreorderSeatCourseCount(count)
      if (tier === 1) totals.oneCourse += 1
      else if (tier === 2) totals.twoCourses += 1
      else if (tier === 3) totals.threeCourses += 1
      else if (tier === 0) totals.notChosen += 1
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
