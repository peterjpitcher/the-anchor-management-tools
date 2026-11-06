import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'
export const maxDuration = 300

import { getLondonDateIso, requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import {
  formatDateDdMmmmYyyy,
  formatDateFull,
  formatTime12Hour,
  toLondonDateTimeLocalValue,
} from '@/lib/dateUtils'
import { getTableBookingStatusLabel, getTableBookingVisualState } from '@/lib/table-bookings/ui'
import {
  generateTableBookingSheetsHTML,
  type TableBookingSheetData,
  type TableBookingSheetGuestNotes,
  type TableBookingSheetPreorder,
  type TableBookingSheetPreorderAddonTotal,
  type TableBookingSheetPreorderCover,
} from '@/lib/table-booking-sheet-template'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadDayLoads, type DayLoadHire } from '@/services/day-load'
import { privateHireSheet, privateHireSortTime, privateHiresNotLoadedSheet } from '@/lib/table-bookings/private-hire-sheets'
import {
  bookingHasGuestSeats,
  describeChristmasTiers,
  describeSeatAllergy,
  describeSeatTier,
  formatSheetTableLabel,
} from '@/lib/table-bookings/booking-sheet'
import {
  formatPreorderAddonPrice,
  getPreorderCutoff,
  isCoverChangedAfterCutoff,
  formatPreorderMoney,
  isPreorderAddon,
  isPreorderEnabled,
  mapPreorderCoverRow,
  mapPreorderSelectionRow,
  summariseCoverAddons,
  summariseOrderAddons,
  toPreorderSeatCourseCount,
} from '@/lib/table-bookings/preorder'
import {
  PREORDER_SELECTION_COURSES,
  PREORDER_SELECTION_COURSE_LABELS,
  type PreorderAddonSummary,
  type PreorderCover,
  type PreorderCoverRow,
  type PreorderSelectionRow,
} from '@/types/preorders'

/** One A4 page per booking — a hard ceiling keeps the Chromium render inside maxDuration. */
const MAX_PRINTABLE_ROWS = 200

type TableRow = {
  id: string
  name: string | null
  table_number: string | null
  is_bookable: boolean | null
}

type AssignmentRow = {
  table: TableRow | TableRow[] | null
}

type CustomerRow = {
  first_name: string | null
  last_name: string | null
}

type BookingRow = {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string | null
  party_size: number | null
  status: string | null
  payment_status: string | null
  no_show_at: string | null
  left_at: string | null
  seated_at: string | null
  deposit_waived: boolean | null
  paypal_deposit_capture_id: string | null
  deposit_amount: number | string | null
  deposit_amount_locked: number | string | null
  is_outside_seating: boolean | null
  high_chair_count: number | null
  requires_accessible_table: boolean | null
  booking_type: string | null
  /** Christmas only: 0 to 3 courses per guest, seat 1 first (0 is not chosen yet). The tier source, not the cover rows. */
  christmas_course_counts: number[] | null
  /** The guest accepted the seasonal offer. With the next column, whether every guest has a seat to choose for. */
  booking_period_answer: boolean | null
  booking_period_requires_preorder: boolean | null
  /** The seasonal period, for when its pre-order form locked. */
  booking_period_id: string | null
  /** Booking-level allergy list. Printed on both pages, marked confidential (D6, BK-052). */
  allergies: string[] | null
  /** Booking-level dietary needs, printed beside the allergies. */
  dietary_requirements: string[] | null
  /** The notes box on every booking form, where most allergies have arrived. */
  special_requirements: string | null
  customer: CustomerRow | CustomerRow[] | null
  table_booking_tables: AssignmentRow[] | null
}

/** Rejects bad shape *and* bad calendar dates (2026-13-45, 2026-02-31). Never coerces. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

async function imageDataUrl(relativePath: string, mimeType: string): Promise<string> {
  const file = await readFile(path.join(process.cwd(), 'public', relativePath))
  return `data:${mimeType};base64,${file.toString('base64')}`
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function customerName(row: BookingRow): string {
  const customer = firstOrSelf(row.customer)
  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
  return name || row.booking_reference || 'Walk-in guest'
}

/** Seating needs staff must prepare for. Step-free first: it decides which table works at all. */
function requirementsField(row: BookingRow): string[] {
  const requirements: string[] = []
  if (row.requires_accessible_table) {
    requirements.push('Step-free table')
  }
  const highChairs = row.high_chair_count ?? 0
  if (highChairs > 0) {
    requirements.push(`High chair ×${highChairs}`)
  }
  return requirements
}

/**
 * The guest's allergies, dietary needs and notes, or undefined when the booking has none (which keeps
 * that sheet exactly as it printed before). The owner agreed these may be printed, marked
 * confidential, because the sheets are shredded after service (decision D6, BK-052).
 */
function guestNotesField(row: BookingRow, guestAllergies: string[] = []): TableBookingSheetGuestNotes | undefined {
  const clean = (values: string[] | null) =>
    (values ?? []).map((value) => (typeof value === 'string' ? value.trim() : '')).filter((value) => value.length > 0)
  const allergies = clean(row.allergies)
  const dietary = clean(row.dietary_requirements)
  const notes = typeof row.special_requirements === 'string' && row.special_requirements.trim()
    ? row.special_requirements.trim()
    : null
  if (allergies.length === 0 && dietary.length === 0 && !notes && guestAllergies.length === 0) return undefined
  // A guest's own allergy (the food link's question) raises the booking page's block too, so the
  // floor never reads "None in the allergy field" for a table where someone is allergic.
  return { allergies, dietary, notes, ...(guestAllergies.length ? { guestAllergies } : {}) }
}

function toSheetData(
  row: BookingRow,
  bookingDate: string,
  generatedAt: string,
  preorder?: TableBookingSheetPreorder
): TableBookingSheetData {
  return {
    bookingRef: row.booking_reference || '',
    customerName: customerName(row),
    bookingDate,
    startTime: formatTime12Hour(row.booking_time),
    partySize: String(row.party_size),
    tableLabel: formatSheetTableLabel(row),
    status: getTableBookingStatusLabel(getTableBookingVisualState(row)),
    requirements: requirementsField(row),
    generatedAt,
    ...(preorder ? { preorder } : {}),
    ...(row.booking_type === 'christmas'
      ? { christmasCourses: describeChristmasTiers(row.christmas_course_counts) || 'Not recorded' }
      : {}),
    ...(guestNotesField(row, preorder?.guestAllergies) ? { guestNotes: guestNotesField(row, preorder?.guestAllergies) } : {}),
  }
}

/** The template wants money as text; the summary carries it as numbers. One place to bridge them. */
function toSheetAddonTotal(summary: PreorderAddonSummary): TableBookingSheetPreorderAddonTotal {
  return {
    count: summary.count,
    totalLabel: formatPreorderMoney(summary.totalGbp),
    hasUnpriced: summary.hasUnpricedAddon,
  }
}

/**
 * One seat, as the kitchen page wants it.
 *
 * Add-ons are pulled OUT of the course list rather than printed as another course line. The whole
 * point of the feature is that the cheeseboard is an extra, not a pudding, and a kitchen sheet that
 * listed it beside the courses would reproduce exactly the mistake this fixes.
 */
function toSheetCover(
  cover: PreorderCover,
  courseCount: ReturnType<typeof toPreorderSeatCourseCount>,
  closesAt: Date | null = null
): TableBookingSheetPreorderCover {
  const addons = summariseCoverAddons(cover)

  return {
    seatLabel: cover.guestName
      ? `Seat ${cover.ordinal} · ${cover.guestName}`
      : `Seat ${cover.ordinal}`,
    // The tier is what the guest pays for, so it is printed per seat (BK-058). Since the food link
    // release every tier, 1 course included, chooses a main ahead (D4), and 0 is not chosen yet.
    ...(courseCount !== null ? { tierLabel: describeSeatTier(courseCount) } : {}),
    allergyLabel:
      cover.hasAllergies === true
        ? `Yes: ${cover.allergyDetail?.trim() || 'details not given, ask the guest'}`
        : cover.hasAllergies === false
          ? 'None'
          : 'Not answered, ask before serving',
    ...(cover.hasAllergies === true ? { hasAllergy: true } : {}),
    // Recorded by a manager after the form locked (D21): the kitchen ordered before it (BK-051).
    ...(isCoverChangedAfterCutoff(cover, closesAt) ? { lateChange: true } : {}),
    courses: cover.selections
      .filter((selection) => !isPreorderAddon(selection))
      .map((selection) => ({
        courseLabel: PREORDER_SELECTION_COURSE_LABELS[selection.course],
        itemName: selection.itemName,
        ...(selection.itemWithdrawn ? { withdrawn: true } : {}),
      })),
    ...(addons.count > 0
      ? {
          addons: addons.items.map((item) => ({
            itemName: item.itemName,
            // Null is the normal case: every Christmas item is unpriced today, and "Price on the
            // day" is honest where "£0.00" would be read as free.
            priceLabel: formatPreorderAddonPrice(item.priceGbp),
          })),
          addonTotal: toSheetAddonTotal(addons),
        }
      : {}),
    dietaryNote: cover.dietaryNote,
  }
}

/**
 * The day's pre-orders, keyed by booking.
 *
 * Read in bulk rather than one booking at a time: a December print run is a couple of hundred pages
 * inside one maxDuration, and a per-booking read would be several hundred round trips. The pre-order
 * tables are service-role only under RLS, so this uses the admin client. Permission was already
 * proven by requireBohTableBookingPermission before we got here.
 *
 * A booking that needs a pre-order (a seat per guest, `hasGuestSeats`) gets a food page even before
 * anyone has chosen, listing every seat as not chosen, so the kitchen sees the gap rather than no
 * page at all (spec section 3.5). A booking with covers but no guest seats keeps its old page.
 */
type SheetBookingFacts = {
  bookingDate: string
  courseCounts: number[] | null
  periodId: string | null
  partySize: number
  /** Every guest has a seat to choose for, chosen or not. */
  hasGuestSeats: boolean
}

/** A seat with no cover row yet: nobody has saved anything for it. */
function blankCover(tableBookingId: string, ordinal: number): PreorderCover {
  return {
    id: `blank-${tableBookingId}-${ordinal}`,
    tableBookingId,
    ordinal,
    guestName: null,
    dietaryNote: null,
    hasAllergies: null,
    allergyDetail: null,
    selections: [],
    createdAt: '',
    updatedAt: '',
  }
}

async function loadPreordersForSheets(
  bookingIds: string[],
  factsByBooking: Map<string, SheetBookingFacts> = new Map()
): Promise<Map<string, TableBookingSheetPreorder>> {
  const byBooking = new Map<string, TableBookingSheetPreorder>()
  if (bookingIds.length === 0) return byBooking

  const admin = createAdminClient()
  if (!(await isPreorderEnabled(admin))) return byBooking

  // When each booking's form locked, so a seat a manager changed after it is marked as late.
  const periodIds = Array.from(
    new Set(Array.from(factsByBooking.values()).map((facts) => facts.periodId).filter((id): id is string => Boolean(id)))
  )
  const cutoffDaysByPeriod = new Map<string, number | null>()
  if (periodIds.length > 0) {
    const { data: periodData, error: periodError } = await admin
      .from('booking_periods')
      .select('id, preorder_cutoff_days')
      .in('id', periodIds)
    if (periodError) throw periodError
    for (const period of (periodData ?? []) as Array<{ id: string; preorder_cutoff_days: number | null }>) {
      cutoffDaysByPeriod.set(period.id, period.preorder_cutoff_days ?? null)
    }
  }
  const closesAtFor = (tableBookingId: string): Date | null => {
    const facts = factsByBooking.get(tableBookingId)
    if (!facts?.periodId) return null
    return getPreorderCutoff({
      bookingDate: facts.bookingDate,
      preorderCutoffDays: cutoffDaysByPeriod.get(facts.periodId) ?? null,
    }).closesAt
  }

  const { data: coverData, error: coverError } = await admin
    .from('booking_preorder_covers')
    .select('id, table_booking_id, ordinal, guest_name, dietary_note, has_allergies, allergy_detail, created_at, updated_at')
    .in('table_booking_id', bookingIds)
    .order('ordinal', { ascending: true })

  if (coverError) throw coverError

  const coverRows = (coverData ?? []) as unknown as PreorderCoverRow[]

  let selectionRows: PreorderSelectionRow[] = []
  if (coverRows.length > 0) {
    const { data: selectionData, error: selectionError } = await admin
      .from('booking_preorder_selections')
      .select('id, cover_id, course, menu_item_id, item_name, price_gbp, created_at, updated_at')
      .in(
        'cover_id',
        coverRows.map((cover) => cover.id)
      )

    if (selectionError) throw selectionError
    selectionRows = (selectionData ?? []) as unknown as PreorderSelectionRow[]
  }

  // Which chosen dishes have since come off the menu, so the sheet flags them instead of printing
  // them as a plate to cook (BK-058).
  const menuItemIds = Array.from(new Set(selectionRows.map((row) => row.menu_item_id)))
  const withdrawnIds = new Set<string>()
  if (menuItemIds.length > 0) {
    const { data: itemData, error: itemError } = await admin
      .from('booking_period_menu_items')
      .select('id, is_active')
      .in('id', menuItemIds)
    if (itemError) throw itemError
    for (const item of (itemData ?? []) as Array<{ id: string; is_active: boolean }>) {
      if (item.is_active === false) withdrawnIds.add(item.id)
    }
  }

  const selectionsByCover = new Map<string, PreorderSelectionRow[]>()
  for (const row of selectionRows) {
    const list = selectionsByCover.get(row.cover_id)
    if (list) list.push(row)
    else selectionsByCover.set(row.cover_id, [row])
  }

  // Group by booking first, then build each page, because the add-on total is a property of the whole
  // booking and cannot be worked out one seat at a time.
  const coversByBooking = new Map<string, PreorderCover[]>()
  for (const coverRow of coverRows) {
    const selections = (selectionsByCover.get(coverRow.id) ?? [])
      .map((row) => mapPreorderSelectionRow(row, { itemWithdrawn: withdrawnIds.has(row.menu_item_id) }))
      // PREORDER_SELECTION_COURSES, not PREORDER_COURSES: indexOf on the three-course list returns
      // -1 for an add-on, which would sort the cheeseboard ABOVE the starter. Name breaks the tie so
      // a seat with several add-ons prints in a stable order.
      .sort(
        (a, b) =>
          PREORDER_SELECTION_COURSES.indexOf(a.course) -
            PREORDER_SELECTION_COURSES.indexOf(b.course) || a.itemName.localeCompare(b.itemName)
      )
    const cover = mapPreorderCoverRow(coverRow, selections)

    const covers = coversByBooking.get(cover.tableBookingId)
    if (covers) covers.push(cover)
    else coversByBooking.set(cover.tableBookingId, [cover])
  }

  // Every seat of a booking that needs a pre-order, chosen or not.
  for (const tableBookingId of bookingIds) {
    const facts = factsByBooking.get(tableBookingId)
    if (!facts?.hasGuestSeats) continue
    const covers = coversByBooking.get(tableBookingId) ?? []
    const present = new Set(covers.map((cover) => cover.ordinal))
    for (let ordinal = 1; ordinal <= facts.partySize; ordinal += 1) {
      if (!present.has(ordinal)) covers.push(blankCover(tableBookingId, ordinal))
    }
    covers.sort((a, b) => a.ordinal - b.ordinal)
    coversByBooking.set(tableBookingId, covers)
  }

  for (const [tableBookingId, covers] of coversByBooking) {
    const addons = summariseOrderAddons({ covers })
    const guestAllergies = covers
      .filter((cover) => cover.hasAllergies === true)
      .map((cover) => describeSeatAllergy({ ordinal: cover.ordinal, guestName: cover.guestName, detail: cover.allergyDetail ?? null }))
    byBooking.set(tableBookingId, {
      allergies: [],
      ...(guestAllergies.length ? { guestAllergies } : {}),
      covers: covers.map((cover) =>
        toSheetCover(
          cover,
          toPreorderSeatCourseCount(factsByBooking.get(tableBookingId)?.courseCounts?.[cover.ordinal - 1] ?? null),
          closesAtFor(tableBookingId)
        )
      ),
      ...(addons.count > 0 ? { addonTotal: toSheetAddonTotal(addons) } : {}),
    })
  }

  return byBooking
}

export async function GET(request: NextRequest) {
  const auth = await requireBohTableBookingPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const { supabase, userId } = auth

  const dateParam = request.nextUrl.searchParams.get('date')
  if (dateParam !== null && !isIsoDate(dateParam)) {
    return new NextResponse('Invalid date — expected YYYY-MM-DD', { status: 400 })
  }
  const date = dateParam ?? getLondonDateIso()

  try {
    const { data: rows, error } = await supabase
      .from('table_bookings')
      .select(`
        id, booking_reference, booking_date, booking_time, party_size,
        status, payment_status, no_show_at, left_at, seated_at,
        deposit_waived, paypal_deposit_capture_id, deposit_amount, deposit_amount_locked,
        booking_type,
        christmas_course_counts,
        booking_period_id,
        booking_period_answer,
        booking_period_requires_preorder,
        is_outside_seating,
        high_chair_count,
        requires_accessible_table,
        allergies,
        dietary_requirements,
        special_requirements,
        customer:customers!table_bookings_customer_id_fkey(first_name, last_name),
        table_booking_tables:booking_table_assignments!booking_table_assignments_table_booking_id_fkey(
          table:tables!booking_table_assignments_table_id_fkey(id, name, table_number, is_bookable)
        )
      `)
      .eq('booking_date', date)
      // Terminal states never print:
      //   - cancelled (table is free again)
      //   - no_show (guest never arrived)
      // Copied verbatim from src/app/api/foh/schedule/route.ts — the QUOTED in-list.
      // A malformed in-list fails open (PostgREST returns everything) with no runtime signal.
      .not('status', 'in', '("cancelled","no_show")')
      .order('booking_time', { ascending: true })

    if (error) throw error

    const bookingRows = (rows ?? []) as unknown as BookingRow[]

    // The day's private hires print too (BK-075, reversing spec decision D-4), so the kitchen sees
    // a catered party on its sheets. A failed read prints a page saying so rather than a quiet gap.
    let hires: DayLoadHire[] = []
    let hiresFailed = false
    try {
      hires = (await loadDayLoads(date, date, { db: createAdminClient(), withHours: false })).get(date)?.privateHires ?? []
    } catch (hireError) {
      console.error('Failed to load private hires for the booking sheets:', hireError)
      hiresFailed = true
    }

    if (bookingRows.length === 0 && hires.length === 0 && !hiresFailed) {
      return new NextResponse('No printable bookings found for the selected day', { status: 404 })
    }

    if (bookingRows.length > MAX_PRINTABLE_ROWS) {
      return new NextResponse(
        `Too many bookings to print in one PDF (${bookingRows.length} — the limit is ${MAX_PRINTABLE_ROWS})`,
        { status: 422 }
      )
    }

    // booking_time asc, then reference, then id — deterministic for equal times.
    const ordered = [...bookingRows].sort((a, b) => {
      const byTime = (a.booking_time || '').localeCompare(b.booking_time || '')
      if (byTime !== 0) return byTime
      const byRef = (a.booking_reference || '').localeCompare(b.booking_reference || '')
      if (byRef !== 0) return byRef
      return a.id.localeCompare(b.id)
    })

    const now = new Date()
    const generatedAt =
      `${formatDateDdMmmmYyyy(now)} at ${formatTime12Hour(toLondonDateTimeLocalValue(now).slice(11))}`
    const bookingDate = formatDateFull(date)

    const preorders = await loadPreordersForSheets(
      ordered.map((row) => row.id),
      new Map(
        ordered.map((row) => [
          row.id,
          {
            bookingDate: row.booking_date,
            courseCounts: row.christmas_course_counts ?? null,
            periodId: row.booking_period_id ?? null,
            partySize: Math.max(0, Math.trunc(Number(row.party_size) || 0)),
            hasGuestSeats: bookingHasGuestSeats(row),
          },
        ])
      )
    )

    const bookingSheets = ordered.map((row) => {
      const preorder = preorders.get(row.id)
      // The booking-level allergy list is attached here, not in the loader, because it lives on the
      // booking rather than on a cover. Both sources must reach the food page: showing only the
      // per-seat notes would drop an allergy the pub already records.
      return toSheetData(
        row,
        bookingDate,
        generatedAt,
        preorder ? { ...preorder, allergies: row.allergies ?? [] } : undefined
      )
    })

    // Hires slot in by start time; the table bookings keep their own order among themselves.
    const timed = [
      ...ordered.map((row, index) => ({ time: (row.booking_time || '').slice(0, 5), order: index, sheet: bookingSheets[index] })),
      ...hires.map((hire, index) => ({ time: privateHireSortTime(hire), order: ordered.length + index, sheet: privateHireSheet(hire, bookingDate, generatedAt) })),
    ].sort((a, b) => a.time.localeCompare(b.time) || a.order - b.order)
    const sheets = [
      ...(hiresFailed ? [privateHiresNotLoadedSheet(bookingDate, generatedAt)] : []),
      ...timed.map((entry) => entry.sheet),
    ]

    const logoDataUrl = await imageDataUrl('booking-confirmation/anchor-logo-black.png', 'image/png')
    const html = generateTableBookingSheetsHTML(sheets, { logoDataUrl })
    const pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      displayHeaderFooter: false,
    })
    const pdfContent = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    ) as ArrayBuffer

    // Never log customer names — date and count only.
    await logAuditEvent({
      user_id: userId,
      operation_type: 'export',
      resource_type: 'table_booking_sheets',
      operation_status: 'success',
      additional_info: { date, count: sheets.length, private_hires: hires.length },
    })

    return new NextResponse(pdfContent, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="table-bookings-${date}.pdf"`,
        'Cache-Control': 'no-store, private, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Failed to generate table booking sheets:', error)
    return new NextResponse('Failed to generate booking sheets', { status: 500 })
  }
}
