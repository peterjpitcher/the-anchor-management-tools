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
  type TableBookingSheetPreorder,
} from '@/lib/table-booking-sheet-template'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPreorderEnabled, mapPreorderCoverRow, mapPreorderSelectionRow } from '@/lib/table-bookings/preorder'
import {
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  type PreorderCourse,
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
  /** Booking-level allergy list the pub already records. Printed on the food page, never elsewhere. */
  allergies: string[] | null
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

const tableCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * Outside-ness is a property of the BOOKING, not the table — an outside booking with a
 * stray indoor assignment must still read "Outside", so that check comes first.
 */
function tableField(row: BookingRow): string {
  if (row.is_outside_seating) return 'Outside'

  // De-dup by table id. Keep name and table_number separately: the label staff read is the
  // name, but the ORDER must be by table_number to match the BOH screen (see below).
  const seen = new Map<string, { label: string; tableNumber: string; name: string }>()
  for (const assignment of row.table_booking_tables ?? []) {
    const table = firstOrSelf(assignment?.table ?? null)
    if (!table || table.is_bookable === false) continue
    const label = table.name || table.table_number
    if (!label) continue
    seen.set(table.id, {
      label,
      tableNumber: table.table_number || '',
      name: table.name || '',
    })
  }

  // Sort to match the BOH screen exactly (src/app/api/boh/table-bookings/route.ts:444-453):
  // table_number numerically first, then name. Sorting by the *label* instead would order the
  // sheet alphabetically by name ("Dining Room 6a, High 4") while the screen shows the numeric
  // order ("High 4, Dining Room 6a") — every real table has a name, so the label is never a digit.
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
    tableLabel: tableField(row),
    status: getTableBookingStatusLabel(getTableBookingVisualState(row)),
    requirements: requirementsField(row),
    generatedAt,
    ...(preorder ? { preorder } : {}),
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
 * Bookings with no covers get no entry, and so no food page: an order nobody has started is the
 * reminder cron's business (spec section 7), not the kitchen's.
 */
async function loadPreordersForSheets(
  bookingIds: string[]
): Promise<Map<string, TableBookingSheetPreorder>> {
  const byBooking = new Map<string, TableBookingSheetPreorder>()
  if (bookingIds.length === 0) return byBooking

  const admin = createAdminClient()
  if (!(await isPreorderEnabled(admin))) return byBooking

  const { data: coverData, error: coverError } = await admin
    .from('booking_preorder_covers')
    .select('id, table_booking_id, ordinal, guest_name, dietary_note, created_at, updated_at')
    .in('table_booking_id', bookingIds)
    .order('ordinal', { ascending: true })

  if (coverError) throw coverError

  const coverRows = (coverData ?? []) as unknown as PreorderCoverRow[]
  if (coverRows.length === 0) return byBooking

  const { data: selectionData, error: selectionError } = await admin
    .from('booking_preorder_selections')
    .select('id, cover_id, course, menu_item_id, item_name, price_gbp, created_at, updated_at')
    .in(
      'cover_id',
      coverRows.map((cover) => cover.id)
    )

  if (selectionError) throw selectionError

  const selectionsByCover = new Map<string, PreorderSelectionRow[]>()
  for (const row of (selectionData ?? []) as unknown as PreorderSelectionRow[]) {
    const list = selectionsByCover.get(row.cover_id)
    if (list) list.push(row)
    else selectionsByCover.set(row.cover_id, [row])
  }

  for (const coverRow of coverRows) {
    const selections = (selectionsByCover.get(coverRow.id) ?? [])
      .map((row) => mapPreorderSelectionRow(row))
      .sort((a, b) => PREORDER_COURSES.indexOf(a.course) - PREORDER_COURSES.indexOf(b.course))
    const cover = mapPreorderCoverRow(coverRow, selections)

    const block = byBooking.get(cover.tableBookingId) ?? { allergies: [], covers: [] }
    block.covers.push({
      seatLabel: cover.guestName
        ? `Seat ${cover.ordinal} · ${cover.guestName}`
        : `Seat ${cover.ordinal}`,
      courses: cover.selections.map((selection) => ({
        courseLabel: PREORDER_COURSE_LABELS[selection.course as PreorderCourse],
        itemName: selection.itemName,
      })),
      dietaryNote: cover.dietaryNote,
    })
    byBooking.set(cover.tableBookingId, block)
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
        is_outside_seating,
        high_chair_count,
        requires_accessible_table,
        allergies,
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

    if (bookingRows.length === 0) {
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

    const preorders = await loadPreordersForSheets(ordered.map((row) => row.id))

    const sheets = ordered.map((row) => {
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
      additional_info: { date, count: sheets.length },
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
