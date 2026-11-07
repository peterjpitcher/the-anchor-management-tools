/**
 * The per-booking one-pager for the kitchen and the floor (owner decision D14, spec section 3.5).
 *
 * Pure: everything here takes facts already read from the database and returns pre-formatted text,
 * so the screen view, the PDF and the tests all work from the same model. The reads live in
 * ./booking-sheet-load.ts and the markup in src/lib/table-booking-one-pager-template.ts.
 *
 * Allergy and dietary text is staff and kitchen only: never log it, never put it in an audit row.
 */

import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { mentionsAllergy } from '@/lib/table-bookings/allergy-words'
import {
  describeCourseCount,
  getPreorderCompleteness,
  getPreorderCutoff,
  getSeatCourseCount,
  isCoverChangedAfterCutoff,
  isPreorderAddon,
} from '@/lib/table-bookings/preorder'
import {
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  type PreorderCourse,
  type PreorderCover,
  type PreorderOrder,
  type PreorderSeatCourseCount,
  type PreorderSelection,
} from '@/types/preorders'
import type { UserPermission } from '@/types/rbac'

// ---------------------------------------------------------------------------
// Access (D14)
// ---------------------------------------------------------------------------

/** Anyone who can see table bookings can view the sheet on screen, the shared FOH login included. */
export function canViewBookingSheet(permissions: readonly UserPermission[]): boolean {
  return permissions.some((permission) => permission.module_name === 'table_bookings' && permission.action === 'view')
}

/**
 * Who may download the PDF: the same people the day booking-sheets PDF serves, which is anyone with
 * table_bookings view who is not the FOH-only login (`requireBohTableBookingPermission`). The PDF
 * route asks that function itself; this mirrors it so the screen hides the button from exactly the
 * people the route refuses.
 */
export function canDownloadBookingSheet(permissions: readonly UserPermission[]): boolean {
  return canViewBookingSheet(permissions) && !isFohOnlyUser([...permissions])
}

// ---------------------------------------------------------------------------
// Shared formatting
// ---------------------------------------------------------------------------

type SheetTableRow = {
  id: string
  name: string | null
  table_number: string | null
  is_bookable: boolean | null
}

export type SheetTableAssignment = {
  table: SheetTableRow | SheetTableRow[] | null
}

function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

const tableCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * The tables a booking sits at, as staff read them: "Outside", "Unassigned" or the names in the
 * BOH screen's order.
 *
 * Outside-ness is a property of the BOOKING, not the table: an outside booking with a stray indoor
 * assignment must still read "Outside", so that check comes first. Sorted by table_number
 * numerically, then name, to match the BOH screen (src/app/api/boh/table-bookings/route.ts); sorting
 * by the label would order "Dining Room 6a, High 4" where the screen shows "High 4, Dining Room 6a".
 */
export function formatSheetTableLabel(row: {
  is_outside_seating: boolean | null
  table_booking_tables: SheetTableAssignment[] | null
}): string {
  if (row.is_outside_seating) return 'Outside'

  const seen = new Map<string, { label: string; tableNumber: string; name: string }>()
  for (const assignment of row.table_booking_tables ?? []) {
    const table = firstOrSelf(assignment?.table ?? null)
    if (!table || table.is_bookable === false) continue
    const label = table.name || table.table_number
    if (!label) continue
    seen.set(table.id, { label, tableNumber: table.table_number || '', name: table.name || '' })
  }

  const labels = [...seen.values()]
    .sort((a, b) => {
      if (a.tableNumber && b.tableNumber) {
        const byNumber = tableCollator.compare(a.tableNumber, b.tableNumber)
        if (byNumber !== 0) return byNumber
      }
      return tableCollator.compare(a.name, b.name)
    })
    .map((table) => table.label)

  return labels.length ? labels.join(', ') : 'Unassigned'
}

/**
 * A Christmas booking's tiers in one line: "4 x 3 courses, 2 x 1 course, 2 not chosen yet". Seats on
 * 0 have not picked their number of courses yet (the food link release) and are said, not dropped.
 * Empty when the booking recorded no list.
 */
export function describeChristmasTiers(counts: readonly number[] | null | undefined): string {
  if (!counts?.length) return ''
  const parts = [3, 2, 1]
    .map((course) => {
      const guests = counts.filter((count) => Number(count) === course).length
      return guests ? `${guests} x ${course} course${course === 1 ? '' : 's'}` : null
    })
    .filter((part): part is string => Boolean(part))
  const notChosen = counts.filter((count) => ![1, 2, 3].includes(Number(count))).length
  if (notChosen) parts.push(`${notChosen} not chosen yet`)
  return parts.join(', ')
}

/**
 * Whether the booking has a seat per guest to choose for: the same rule as `loadPreorderOrder`'s
 * `hasGuestSeats` and the staff detail page, read from the booking's own snapshot.
 */
export function bookingHasGuestSeats(row: {
  booking_period_answer: boolean | null
  booking_period_requires_preorder: boolean | null
  christmas_course_counts: readonly number[] | null
}): boolean {
  return (
    row.booking_period_answer === true &&
    (row.booking_period_requires_preorder === true || Array.isArray(row.christmas_course_counts))
  )
}

/** "Seat 3, Sam: peanuts", or "Seat 3: peanuts" with no name. */
export function describeSeatAllergy(seat: { ordinal: number; guestName: string | null; detail: string | null }): string {
  const who = seat.guestName?.trim() ? `Seat ${seat.ordinal}, ${seat.guestName.trim()}` : `Seat ${seat.ordinal}`
  const detail = seat.detail?.trim() || 'allergy, details not given'
  return `${who}: ${detail}`
}

/** What the tier column says for a seat. */
export function describeSeatTier(courseCount: PreorderSeatCourseCount | null): string {
  if (courseCount === null) return 'Not recorded'
  if (courseCount === 0) return 'Not chosen yet'
  return describeCourseCount(courseCount)
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** What the booking's payment data says about money to take off the bill. Never invented. */
export type BookingSheetDeposit =
  | { kind: 'paid'; heldGbp: number; refundsChecked: boolean }
  | { kind: 'refunded' }
  | { kind: 'waived' }
  | { kind: 'unpaid' }
  | { kind: 'none' }

export type BookingSheetBookingFacts = {
  id: string
  reference: string
  /** yyyy-mm-dd, London. */
  bookingDate: string
  /** HH:mm or HH:mm:ss, London wall time. */
  bookingTime: string | null
  partySize: number
  /** Pre-formatted, e.g. "Booked". */
  statusLabel: string
  organiserName: string
  organiserMobile: string | null
  tableLabel: string
  allergies: readonly string[]
  dietary: readonly string[]
  notes: string | null
  deposit: BookingSheetDeposit
}

export type BookingSheetCellState = 'chosen' | 'missing' | 'not_included' | 'off_menu'

export type BookingSheetCell = {
  text: string
  state: BookingSheetCellState
}

export type BookingSheetSeatRow = {
  seat: number
  name: string
  courses: string
  starter: BookingSheetCell
  main: BookingSheetCell
  dessert: BookingSheetCell
  extras: string
  allergy: { state: 'yes' | 'no' | 'not_answered'; text: string }
  dietary: string
  /** A manager changed this seat after the cutoff, so the kitchen ordered before it. */
  lateChange: boolean
}

export type BookingSheetDishCount = {
  name: string
  count: number
}

export type BookingSheetCourseTally = {
  course: PreorderCourse
  label: string
  /** Adult dishes for this course, busiest first. For mains, kids mains are in `kidsMains`. */
  dishes: BookingSheetDishCount[]
  /** Seats whose tier needs this course and have none chosen. */
  notChosen: number
  /** Chosen dishes since taken off the menu: never cooked as chosen, each a guest to ring. */
  offMenu: BookingSheetDishCount[]
}

export type BookingSheetTierTally = {
  notChosen: number
  one: number
  two: number
  three: number
}

export type BookingSheetTally = {
  /** Null when the booking recorded no tiers (an older booking on the main-only rule). */
  tiers: BookingSheetTierTally | null
  courses: BookingSheetCourseTally[]
  kidsMains: BookingSheetDishCount[]
  /** 2 course seats with neither a starter nor a dessert. */
  starterOrDessertNotChosen: number
  extras: BookingSheetDishCount[]
}

export type BookingSheetAllergyBox = {
  bookingAllergies: string[]
  bookingDietary: string[]
  /**
   * The booking notes, here only when they mention an allergen: allergies mostly arrived in the
   * notes before the allergy field existed (BK-052). Other notes go in the header.
   */
  bookingNotes: string | null
  /** "Seat 3, Sam: peanuts", one per guest with `has_allergies` true. */
  seatAllergies: string[]
  /** Seats where the allergy question is still unanswered (`has_allergies` null). */
  seatsNotAnswered: number[]
  /** True when neither the booking, its notes nor any guest records an allergy. */
  noneRecorded: boolean
}

export type BookingSheetHeader = {
  dayDate: string
  time: string
  reference: string
  organiserName: string
  organiserMobile: string
  tables: string
  guests: string
  deposit: string
  choices: string
  status: string
  /** The booking notes when they do not mention an allergy (those go in the allergy box). */
  notes: string | null
}

export type BookingSheetModel = {
  bookingId: string
  header: BookingSheetHeader
  allergy: BookingSheetAllergyBox
  /** Null for a booking with no food pre-order: the sheet is then the header and allergy box only. */
  preorder: { tally: BookingSheetTally; seats: BookingSheetSeatRow[] } | null
}

function formatMoney(valueGbp: number): string {
  return `£${valueGbp.toFixed(2)}`
}

export function describeSheetDeposit(deposit: BookingSheetDeposit): string {
  switch (deposit.kind) {
    case 'paid':
      return deposit.refundsChecked
        ? `${formatMoney(deposit.heldGbp)} paid, take it off the bill`
        : `${formatMoney(deposit.heldGbp)} paid, take it off the bill (refunds could not be checked, see the booking)`
    case 'refunded':
      return 'Deposit refunded, nothing to take off'
    case 'waived':
      return 'Deposit waived, nothing to take off'
    case 'unpaid':
      return 'Deposit not paid, nothing to take off'
    default:
      return 'No deposit'
  }
}

function clean(values: readonly string[] | null | undefined): string[] {
  return (values ?? []).map((value) => (typeof value === 'string' ? value.trim() : '')).filter((value) => value.length > 0)
}

function seatCourseCell(input: {
  course: PreorderCourse
  courseCount: PreorderSeatCourseCount | null
  selection: PreorderSelection | null
  otherChosen: boolean
}): BookingSheetCell {
  const { course, courseCount, selection } = input
  if (selection) {
    if (selection.itemWithdrawn) return { text: `${selection.itemName} (off the menu, ring the guest)`, state: 'off_menu' }
    return { text: course === 'main' && selection.isChildOption ? `${selection.itemName} (kids main)` : selection.itemName, state: 'chosen' }
  }
  // Every tier has a main, 0 and the old no-list rule included.
  if (course === 'main') return { text: 'Not chosen', state: 'missing' }
  if (courseCount === null) return { text: 'None', state: 'not_included' }
  if (courseCount === 0) return { text: 'Courses not chosen yet', state: 'missing' }
  if (courseCount === 1) return { text: 'Not included', state: 'not_included' }
  if (courseCount === 2) {
    return input.otherChosen
      ? { text: 'Not included', state: 'not_included' }
      : { text: 'Starter or dessert not chosen', state: 'missing' }
  }
  return { text: 'Not chosen', state: 'missing' }
}

function courseSelection(cover: PreorderCover | undefined, course: PreorderCourse): PreorderSelection | null {
  return cover?.selections.find((selection) => selection.course === course) ?? null
}

function countInto(map: Map<string, { name: string; count: number }>, key: string, name: string): void {
  const entry = map.get(key)
  if (entry) entry.count += 1
  else map.set(key, { name, count: 1 })
}

function sortedCounts(map: Map<string, { name: string; count: number }>): BookingSheetDishCount[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * Seat numbers to show: every guest in the party, plus any cover beyond it (drift the nightly check
 * reports), so nothing a guest chose can fall off the bottom of the kitchen's list.
 */
function seatOrdinals(order: PreorderOrder): number[] {
  const highest = Math.max(order.partySize, ...order.covers.map((cover) => cover.ordinal), 0)
  return Array.from({ length: highest }, (_, index) => index + 1)
}

/** Guests per tier, dishes per course, kids mains, extras and what is still not chosen. */
export function buildBookingSheetTally(order: PreorderOrder): BookingSheetTally {
  const coversByOrdinal = new Map(order.covers.map((cover) => [cover.ordinal, cover]))
  const hasTiers = Array.isArray(order.courseCounts)
  const tiers: BookingSheetTierTally = { notChosen: 0, one: 0, two: 0, three: 0 }
  const dishes: Record<PreorderCourse, Map<string, { name: string; count: number }>> = {
    starter: new Map(),
    main: new Map(),
    dessert: new Map(),
  }
  const offMenu: Record<PreorderCourse, Map<string, { name: string; count: number }>> = {
    starter: new Map(),
    main: new Map(),
    dessert: new Map(),
  }
  const notChosen: Record<PreorderCourse, number> = { starter: 0, main: 0, dessert: 0 }
  const kidsMains = new Map<string, { name: string; count: number }>()
  const extras = new Map<string, { name: string; count: number }>()
  let starterOrDessertNotChosen = 0

  for (const ordinal of seatOrdinals(order)) {
    const cover = coversByOrdinal.get(ordinal)
    const courseCount = getSeatCourseCount(order, ordinal)

    if (hasTiers) {
      if (courseCount === 1) tiers.one += 1
      else if (courseCount === 2) tiers.two += 1
      else if (courseCount === 3) tiers.three += 1
      else tiers.notChosen += 1
    }

    for (const course of PREORDER_COURSES) {
      const selection = courseSelection(cover, course)
      if (!selection) continue
      if (selection.itemWithdrawn) countInto(offMenu[course], selection.menuItemId, selection.itemName)
      else if (course === 'main' && selection.isChildOption) countInto(kidsMains, selection.menuItemId, selection.itemName)
      else countInto(dishes[course], selection.menuItemId, selection.itemName)
    }
    for (const selection of cover?.selections ?? []) {
      if (isPreorderAddon(selection)) countInto(extras, selection.menuItemId, selection.itemName)
    }

    const hasStarter = Boolean(courseSelection(cover, 'starter'))
    const hasDessert = Boolean(courseSelection(cover, 'dessert'))
    if (!courseSelection(cover, 'main')) notChosen.main += 1
    if (courseCount === 3) {
      if (!hasStarter) notChosen.starter += 1
      if (!hasDessert) notChosen.dessert += 1
    }
    if (courseCount === 2 && !hasStarter && !hasDessert) starterOrDessertNotChosen += 1
  }

  return {
    tiers: hasTiers ? tiers : null,
    courses: PREORDER_COURSES.map((course) => ({
      course,
      label: PREORDER_COURSE_LABELS[course],
      dishes: sortedCounts(dishes[course]),
      notChosen: notChosen[course],
      offMenu: sortedCounts(offMenu[course]),
    })),
    kidsMains: sortedCounts(kidsMains),
    starterOrDessertNotChosen,
    extras: sortedCounts(extras),
  }
}

/** One row per seat for the guest table. */
export function buildBookingSheetSeats(order: PreorderOrder): BookingSheetSeatRow[] {
  const coversByOrdinal = new Map(order.covers.map((cover) => [cover.ordinal, cover]))
  const closesAt = getPreorderCutoff({
    bookingDate: order.bookingDate,
    preorderCutoffDays: order.preorderCutoffDays,
  }).closesAt

  return seatOrdinals(order).map((ordinal) => {
    const cover = coversByOrdinal.get(ordinal)
    const courseCount = getSeatCourseCount(order, ordinal)
    const starter = courseSelection(cover, 'starter')
    const dessert = courseSelection(cover, 'dessert')
    const extras = (cover?.selections ?? []).filter(isPreorderAddon).map((selection) => selection.itemName)
    const hasAllergies = cover?.hasAllergies ?? null
    const allergyDetail = cover?.allergyDetail?.trim() || null

    return {
      seat: ordinal,
      name: cover?.guestName?.trim() || 'No name yet',
      courses: describeSeatTier(courseCount),
      starter: seatCourseCell({ course: 'starter', courseCount, selection: starter, otherChosen: Boolean(dessert) }),
      main: seatCourseCell({ course: 'main', courseCount, selection: courseSelection(cover, 'main'), otherChosen: false }),
      dessert: seatCourseCell({ course: 'dessert', courseCount, selection: dessert, otherChosen: Boolean(starter) }),
      extras: extras.length ? extras.join(', ') : 'None',
      allergy:
        hasAllergies === true
          ? { state: 'yes', text: `Yes: ${allergyDetail ?? 'details not given, ask the guest'}` }
          : hasAllergies === false
            ? { state: 'no', text: 'None' }
            : { state: 'not_answered', text: 'Not answered' },
      dietary: cover?.dietaryNote?.trim() || 'None',
      lateChange: cover ? isCoverChangedAfterCutoff(cover, closesAt) : false,
    }
  })
}

/** "All 8 chosen", "5 of 8 chosen, 3 missing", or the line for a booking with no pre-order. */
export function describeChoicesStatus(order: PreorderOrder | null): string {
  if (!order) return 'No food choices for this booking'
  const completeness = getPreorderCompleteness(order)
  const missing = completeness.seatsIncomplete.length
  const chosen = Math.max(0, order.partySize - missing)
  if (missing === 0 && completeness.complete) return `All ${order.partySize} chosen`
  return `${chosen} of ${order.partySize} chosen, ${missing} missing`
}

function buildAllergyBox(booking: BookingSheetBookingFacts, order: PreorderOrder | null): BookingSheetAllergyBox {
  const bookingAllergies = clean(booking.allergies)
  const bookingDietary = clean(booking.dietary)
  const notes = booking.notes?.trim() || null
  const bookingNotes = notes && mentionsAllergy(notes) ? notes : null
  const seatAllergies: string[] = []
  const seatsNotAnswered: number[] = []

  if (order) {
    const coversByOrdinal = new Map(order.covers.map((cover) => [cover.ordinal, cover]))
    for (const ordinal of seatOrdinals(order)) {
      const cover = coversByOrdinal.get(ordinal)
      if (cover?.hasAllergies === true) {
        seatAllergies.push(describeSeatAllergy({ ordinal, guestName: cover.guestName, detail: cover.allergyDetail ?? null }))
      } else if (cover?.hasAllergies !== false) {
        seatsNotAnswered.push(ordinal)
      }
    }
  }

  return {
    bookingAllergies,
    bookingDietary,
    bookingNotes,
    seatAllergies,
    seatsNotAnswered,
    noneRecorded: bookingAllergies.length === 0 && !bookingNotes && seatAllergies.length === 0,
  }
}

/**
 * The whole one-pager. `order` is the booking's pre-order when it has guest seats, otherwise null,
 * which gives the minimal sheet: header and allergy box.
 */
export function buildBookingSheetModel(input: {
  booking: BookingSheetBookingFacts
  order: PreorderOrder | null
}): BookingSheetModel {
  const { booking, order } = input
  const time = formatTime12Hour(booking.bookingTime)

  return {
    bookingId: booking.id,
    header: {
      dayDate: formatDateFull(booking.bookingDate),
      time,
      reference: booking.reference || 'No reference',
      organiserName: booking.organiserName || 'No name given',
      organiserMobile: booking.organiserMobile?.trim() || 'No mobile given',
      tables: booking.tableLabel,
      guests: String(Math.max(0, Math.trunc(Number(booking.partySize) || 0))),
      deposit: describeSheetDeposit(booking.deposit),
      choices: describeChoicesStatus(order),
      status: booking.statusLabel,
      notes: booking.notes?.trim() && !mentionsAllergy(booking.notes) ? booking.notes.trim() : null,
    },
    allergy: buildAllergyBox(booking, order),
    preorder: order ? { tally: buildBookingSheetTally(order), seats: buildBookingSheetSeats(order) } : null,
  }
}
