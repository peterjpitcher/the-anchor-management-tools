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
 * THE COMPLETENESS RULE, owner-confirmed 2026-08-04. Every cover must have a MAIN. That is the whole
 * requirement. A starter and a dessert are optional, and not choosing one is a complete answer rather
 * than a missing one. Covers in the same party may differ: one person has three courses, the next has
 * just a main. There is deliberately no "chosen / declined / not answered" state per course, because
 * with only the main required "not chosen" and "declined" mean the same thing.
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

/**
 * A cover is complete when it has a main. Starter, dessert and add-ons are optional by design.
 *
 * Add-ons deliberately cannot reach this function's answer. A seat that has ticked the cheeseboard
 * and chosen no main is NOT complete, and a seat with a main and no add-ons IS. Anything else would
 * mean the chase cron nagged a guest for not buying an extra.
 */
export function isCoverComplete(cover: Pick<PreorderCover, 'selections'>): boolean {
  return cover.selections.some((selection) => selection.course === 'main')
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

export type PreorderCompleteness = {
  /** One cover per seat, and every cover has a main. */
  complete: boolean
  partySize: number
  coverCount: number
  /** Seat numbers with no main yet. Empty when every seat has one. */
  ordinalsMissingMain: number[]
  /**
   * Seat numbers whose choice has since been withdrawn from the menu. Reported separately and
   * deliberately NOT counted as incomplete: the chase cron only messages incomplete bookings, and
   * the spec is explicit that a withdrawn dish becomes a short call list for a manager, not an
   * automated burst to every Christmas booker.
   */
  ordinalsWithWithdrawnChoice: number[]
}

export function getPreorderCompleteness(
  order: Pick<PreorderOrder, 'partySize' | 'covers'>,
): PreorderCompleteness {
  const ordinalsMissingMain = order.covers
    .filter((cover) => !isCoverComplete(cover))
    .map((cover) => cover.ordinal)
    .sort((a, b) => a - b)

  const ordinalsWithWithdrawnChoice = order.covers
    .filter((cover) => cover.selections.some((selection) => selection.itemWithdrawn))
    .map((cover) => cover.ordinal)
    .sort((a, b) => a - b)

  return {
    complete: order.covers.length === order.partySize && ordinalsMissingMain.length === 0,
    partySize: order.partySize,
    coverCount: order.covers.length,
    ordinalsMissingMain,
    ordinalsWithWithdrawnChoice,
  }
}

/** What is missing, in a sentence a member of staff can read out on the telephone. */
export function describePreorderGaps(completeness: PreorderCompleteness): string {
  if (completeness.complete) return 'All courses chosen.'

  const parts: string[] = []
  if (completeness.coverCount < completeness.partySize) {
    parts.push(
      `${completeness.partySize - completeness.coverCount} of ${completeness.partySize} seats have no order started`,
    )
  }
  if (completeness.ordinalsMissingMain.length > 0) {
    parts.push(`no main chosen for seat ${completeness.ordinalsMissingMain.join(', ')}`)
  }
  return parts.length > 0 ? `${parts.join(', and ')}.` : 'Something is missing from this pre-order.'
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

/** How many days before the booking the booker is asked for their choices. Spec section 7. */
export const PREORDER_BOOKER_REMINDER_DAYS = 7

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
}

/**
 * Which chases this booking is due, this run. Spec section 7: two messages per booking, ever.
 *
 * THE ESCALATION NEVER RIDES ALONG WITH THE FIRST REMINDER. The booker is asked at
 * `PREORDER_BOOKER_REMINDER_DAYS` and the manager is told at `preorder_cutoff_days`, and that column
 * ships defaulted to 7. Left to the raw thresholds, the default configuration fires both in the same
 * sweep: the guest is asked for their choices and, in the same minute, a manager is told to ring them
 * for not having given any. Fixing that by asking someone to set the two numbers apart is not a fix,
 * because nothing stops the next person setting them back.
 *
 * So the escalation is gated on the booker having actually had their reminder on an EARLIER day. A
 * reminder claimed today has not been acted on yet by definition, so the manager waits for tomorrow's
 * sweep. At the shipped default that means the booker is asked seven days out and, if nothing has
 * arrived by the next sweep, the manager is told six days out. Slipping an internal email by a day
 * costs nothing; asking a guest and dobbing them in simultaneously costs the pub's manners.
 *
 * A BOOKING MADE INSIDE THE CUTOFF still gets both, in one run, but only on its last chance: when the
 * booking is today (`daysUntilBooking <= 0`) there is no later sweep to defer to, so holding the
 * escalation back would mean the manager never hears at all. A booking taken two days out therefore
 * gets its reminder today and, if the choices are still missing, its escalation on tomorrow's sweep.
 *
 * `bookerReminderSentOn` is the ledger row, which is claimed before the send and never rolled back.
 * That is on purpose here too: a reminder that failed to send still counts as the booker's turn
 * having passed, so the manager is told the next day rather than the booking going quiet.
 */
export function decidePreorderChases(input: PreorderChaseInput): PreorderReminderKind[] {
  const { daysUntilBooking, cutoffDays, bookerReminderSentOn, managerEscalationSent, todayIso } = input

  const due: PreorderReminderKind[] = []

  // "At or inside" rather than "exactly on", so one failed cron run does not lose the message for
  // good. The ledger is what stops it being sent twice.
  const bookerDue =
    bookerReminderSentOn === null && daysUntilBooking <= PREORDER_BOOKER_REMINDER_DAYS
  if (bookerDue) due.push('booker_reminder')

  const bookerHasHadTheirTurn = bookerReminderSentOn !== null && bookerReminderSentOn < todayIso
  const noLaterSweep = daysUntilBooking <= 0

  if (
    !managerEscalationSent &&
    cutoffDays !== null &&
    daysUntilBooking <= cutoffDays &&
    (bookerHasHadTheirTurn || noLaterSweep)
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
    .select(
      'id, booking_reference, booking_date, booking_time, party_size, allergies, ' +
        'booking_period_id, booking_period_name, booking_period_answer, booking_period_requires_preorder',
    )
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
  }

  const [covers, preorderCutoffDays] = await Promise.all([
    loadCoversWithSelections(supabase, tableBookingId),
    loadPreorderCutoffDays(supabase, booking.booking_period_id),
  ])

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
    covers,
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

  const patch: Record<string, unknown> = {}
  if (input.guestName !== undefined) patch.guest_name = normaliseText(input.guestName, 100)
  if (input.dietaryNote !== undefined) patch.dietary_note = normaliseText(input.dietaryNote, 200)

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('booking_preorder_covers').update(patch).eq('id', cover.id)
    if (error) throw error
  }

  const selections = input.selections ?? []
  if (selections.length > 0) {
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

export type PreorderDishTotals = {
  date: string
  /** Bookings on that date that have at least one pre-order seat. */
  bookingCount: number
  coverCount: number
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
export function emptyPreorderDishTotals(date: string): PreorderDishTotals {
  return {
    date,
    bookingCount: 0,
    coverCount: 0,
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
  selections: Array<
    Pick<PreorderSelection, 'course' | 'menuItemId' | 'itemName'> & { priceGbp?: number | null }
  >
}): PreorderDishTotals {
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

  for (const selection of input.selections) {
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

  return {
    date: input.date,
    bookingCount: input.bookingCount,
    coverCount: input.coverCount,
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
export async function loadPreorderDishTotals(supabase: Db, date: string): Promise<PreorderDishTotals> {
  const empty = emptyPreorderDishTotals(date)

  const { data: bookingRows, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id')
    .eq('booking_date', date)
    .not('status', 'in', `(${DEAD_BOOKING_STATUSES.join(',')})`)

  if (bookingError) throw bookingError

  const bookingIds = ((bookingRows ?? []) as Array<{ id: string }>).map((row) => row.id)
  if (bookingIds.length === 0) return empty

  const { data: coverRows, error: coverError } = await supabase
    .from('booking_preorder_covers')
    .select('id, table_booking_id')
    .in('table_booking_id', bookingIds)

  if (coverError) throw coverError

  const covers = (coverRows ?? []) as Array<{ id: string; table_booking_id: string }>
  if (covers.length === 0) return empty

  // price_gbp is read here and nowhere else in this query, purely so the add-on money total is
  // summed from what each guest was actually quoted rather than from today's menu.
  const { data: selectionRows, error: selectionError } = await supabase
    .from('booking_preorder_selections')
    .select('cover_id, course, menu_item_id, item_name, price_gbp')
    .in(
      'cover_id',
      covers.map((cover) => cover.id),
    )

  if (selectionError) throw selectionError

  const selections: Array<
    Pick<PreorderSelection, 'course' | 'menuItemId' | 'itemName'> & { priceGbp: number | null }
  > = []
  for (const row of (selectionRows ?? []) as Array<{
    course: string
    menu_item_id: string
    item_name: string
    price_gbp: number | string | null
  }>) {
    if (!isPreorderSelectionCourse(row.course)) continue
    selections.push({
      course: row.course,
      menuItemId: row.menu_item_id,
      itemName: row.item_name,
      priceGbp: toNullableNumber(row.price_gbp),
    })
  }

  return summarisePreorderDishTotals({
    date,
    bookingCount: new Set(covers.map((cover) => cover.table_booking_id)).size,
    coverCount: covers.length,
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
