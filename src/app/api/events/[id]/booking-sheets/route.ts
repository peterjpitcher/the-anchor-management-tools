import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'
export const maxDuration = 300

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import {
  generateEventBookingSheetsHTML,
  type EventBookingSheetData,
  type EventBookingSheetMenuItem,
} from '@/lib/event-booking-sheet-template'
import { resolveEventPaymentMode, resolveEventPriceAmount } from '@/lib/events/pricing'

type RouteContext = {
  params: Promise<{ id: string }>
}

type EventRow = {
  id: string
  name: string
  date: string
  time: string
  performer_name: string | null
  performer_type: string | null
  payment_mode: string | null
  is_free: boolean | null
  price: number | null
  price_per_seat: number | null
  booking_mode: string | null
}

type BookingRow = {
  id: string
  seats: number | null
  event_seating_type: string | null
  notes: string | null
  status: string | null
  is_reminder_only: boolean | null
  customer: {
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
  } | null
}

type TableBookingRow = {
  id: string
  event_booking_id: string | null
  booking_reference: string | null
  special_requirements: string | null
}

type TableAssignmentRow = {
  table_booking_id: string
  table: { name: string | null; table_number: string | null } | { name: string | null; table_number: string | null }[] | null
}

type CommunalAllocationRow = {
  event_booking_id: string
  table: { name: string | null; table_number: string | null } | { name: string | null; table_number: string | null }[] | null
}

type SundayRoastDishRow = {
  dish_id: string
  name: string
  selling_price: number | string | null
  dietary_flags: string[] | null
  category_code: string | null
  sort_order: number | null
}

const LONDON_TIME_ZONE = 'Europe/London'

function formatEventDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: LONDON_TIME_ZONE,
  }).format(new Date(`${value}T12:00:00.000Z`))
}

function formatEventTime(value: string): string {
  const [hours = '0', minutes = '0'] = value.split(':')
  const date = new Date(Date.UTC(2000, 0, 1, Number(hours), Number(minutes)))
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(date).replace(/\s/g, '').toLowerCase()
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount)
}

function formatMenuPrice(amount: number): string {
  return amount % 1 === 0 ? String(amount) : amount.toFixed(2)
}

function customerName(booking: BookingRow): string {
  const name = [
    booking.customer?.first_name,
    booking.customer?.last_name,
  ].filter(Boolean).join(' ').trim()

  return name || booking.customer?.mobile_number || 'Guest'
}

function bookingRef(booking: BookingRow, tableBooking?: TableBookingRow): string {
  if (tableBooking?.booking_reference) return tableBooking.booking_reference
  return `ANC-${booking.id.slice(0, 8).toUpperCase()}`
}

function tableLabelFromRecord(record: TableAssignmentRow | CommunalAllocationRow): string | null {
  const table = Array.isArray(record.table) ? record.table[0] : record.table
  return table?.name || table?.table_number || null
}

function addTableLabel(tableNamesByEventBooking: Map<string, string>, bookingId: string, tableLabel: string): void {
  const current = tableNamesByEventBooking.get(bookingId)
  const labels = current ? current.split(' + ') : []
  if (labels.includes(tableLabel)) return
  tableNamesByEventBooking.set(bookingId, [...labels, tableLabel].join(' + '))
}

function safeFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'booking'
}

async function imageDataUrl(relativePath: string, mimeType: string): Promise<string> {
  const file = await readFile(path.join(process.cwd(), 'public', relativePath))
  return `data:${mimeType};base64,${file.toString('base64')}`
}

async function getSundayRoastMenuItems(admin: ReturnType<typeof createAdminClient>): Promise<EventBookingSheetMenuItem[]> {
  const { data, error } = await admin
    .from('menu_dishes_with_costs')
    .select('dish_id, name, selling_price, dietary_flags, category_code, sort_order')
    .eq('menu_code', 'sunday_lunch')
    .eq('category_code', 'sunday_lunch_mains')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error

  const seen = new Set<string>()
  return ((data ?? []) as unknown as SundayRoastDishRow[])
    .filter((row) => {
      if (!row.dish_id || seen.has(row.dish_id)) return false
      seen.add(row.dish_id)
      return true
    })
    .map((row) => {
      const price = Number(row.selling_price ?? 0)
      const flags = row.dietary_flags ?? []
      return {
        name: row.name,
        price: Number.isFinite(price) && price > 0 ? formatMenuPrice(price) : '',
        badge: flags.includes('vegan') ? 'VG' : flags.includes('vegetarian') ? 'V' : null,
      }
    })
}

function toSheetData(input: {
  event: EventRow
  booking: BookingRow
  tableBooking?: TableBookingRow
  tableName?: string | null
}): EventBookingSheetData {
  const { event, booking, tableBooking, tableName } = input
  const seats = Math.max(1, Number(booking.seats || 1))
  const pricePerSeat = resolveEventPriceAmount(event)
  const paymentMode = resolveEventPaymentMode(event)
  const isFree = pricePerSeat === 0 && paymentMode === 'free'
  const seatingType = booking.event_seating_type === 'standing' ? 'Standing' : 'Seated'
  const specialRequirements = tableBooking?.special_requirements?.trim()
  const bookingNotes = [booking.notes?.trim(), specialRequirements]
    .filter((note): note is string => Boolean(note))
    .filter((note) => !/^Event: .+ · Event booking [0-9a-f-]{36}$/i.test(note))
    .join(' ')
    .trim()

  let paymentMethod = 'Pay on arrival'
  if (isFree) paymentMethod = 'Free'
  else if (paymentMode === 'prepaid') {
    paymentMethod = booking.status === 'pending_payment' ? 'Payment pending' : 'Paid online'
  } else if (paymentMode === 'cash_only') {
    paymentMethod = 'Cash on arrival'
  }

  return {
    bookingRef: bookingRef(booking, tableBooking),
    eventName: event.name,
    eventDate: formatEventDate(event.date),
    startTime: formatEventTime(event.time),
    host: event.performer_name || event.performer_type || 'The Anchor team',
    customerName: customerName(booking),
    seats: String(seats),
    seatingType,
    tableNumber: seatingType === 'Standing' ? null : tableName || null,
    price: isFree ? 'Free' : formatCurrency(pricePerSeat * seats),
    priceNote: isFree ? 'Event price: Free' : `Event price: ${formatCurrency(pricePerSeat)} per person · ${seats} guests`,
    paymentMethod,
    bookingNotes: bookingNotes || null,
  }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id: eventId } = await context.params
  if (!eventId) return new NextResponse('Event ID required', { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const canView = await checkUserPermission('events', 'view')
  if (!canView) return new NextResponse('Permission denied', { status: 403 })

  try {
    const admin = createAdminClient()

    const { data: event, error: eventError } = await admin
      .from('events')
      .select('id, name, date, time, performer_name, performer_type, payment_mode, is_free, price, price_per_seat, booking_mode')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) throw eventError
    if (!event) return new NextResponse('Event not found', { status: 404 })

    const { data: bookings, error: bookingsError } = await admin
      .from('bookings')
      .select('id, seats, event_seating_type, notes, status, is_reminder_only, customer:customers(first_name, last_name, mobile_number)')
      .eq('event_id', eventId)
      .neq('status', 'cancelled')
      .eq('is_reminder_only', false)
      .order('created_at', { ascending: true })

    if (bookingsError) throw bookingsError

    const bookingRows = (bookings ?? []) as unknown as BookingRow[]
    if (bookingRows.length === 0) {
      return new NextResponse('No active bookings found for this event', { status: 404 })
    }

    const bookingIds = bookingRows.map((booking) => booking.id)
    const { data: tableBookings, error: tableBookingsError } = await admin
      .from('table_bookings')
      .select('id, event_booking_id, booking_reference, special_requirements')
      .in('event_booking_id', bookingIds)

    if (tableBookingsError) throw tableBookingsError

    const tableBookingRows = (tableBookings ?? []) as TableBookingRow[]
    const tableBookingByEventBooking = new Map(
      tableBookingRows
        .filter((row) => row.event_booking_id)
        .map((row) => [row.event_booking_id as string, row])
    )

    const tableBookingIds = tableBookingRows.map((row) => row.id)
    const tableNamesByEventBooking = new Map<string, string>()

    if (tableBookingIds.length > 0) {
      const { data: assignments, error: assignmentsError } = await admin
        .from('booking_table_assignments')
        .select('table_booking_id, table:tables!booking_table_assignments_table_id_fkey(name, table_number)')
        .in('table_booking_id', tableBookingIds)

      if (assignmentsError) throw assignmentsError

      for (const assignment of (assignments ?? []) as unknown as TableAssignmentRow[]) {
        const tableBooking = tableBookingRows.find((row) => row.id === assignment.table_booking_id)
        if (!tableBooking?.event_booking_id) continue
        const tableLabel = tableLabelFromRecord(assignment)
        if (!tableLabel) continue
        addTableLabel(tableNamesByEventBooking, tableBooking.event_booking_id, tableLabel)
      }
    }

    const { data: communalAllocations, error: communalAllocationsError } = await admin
      .from('event_communal_seat_allocations')
      .select('event_booking_id, table:tables!event_communal_seat_allocations_table_id_fkey(name, table_number)')
      .in('event_booking_id', bookingIds)

    if (communalAllocationsError) throw communalAllocationsError

    for (const allocation of (communalAllocations ?? []) as unknown as CommunalAllocationRow[]) {
      const tableLabel = tableLabelFromRecord(allocation)
      if (!tableLabel) continue
      addTableLabel(tableNamesByEventBooking, allocation.event_booking_id, tableLabel)
    }

    const [logoDataUrl, sundayRoastQrDataUrl, sundayRoastItems] = await Promise.all([
      imageDataUrl('booking-confirmation/anchor-logo-black.png', 'image/png'),
      imageDataUrl('booking-confirmation/qr-sunday-roast.png', 'image/png'),
      getSundayRoastMenuItems(admin),
    ])

    const sheets = bookingRows.map((booking) => {
      const tableBooking = tableBookingByEventBooking.get(booking.id)
      return toSheetData({
        event: event as EventRow,
        booking,
        tableBooking,
        tableName: tableNamesByEventBooking.get(booking.id),
      })
    })

    const html = generateEventBookingSheetsHTML(sheets, {
      logoDataUrl,
      sundayRoastQrDataUrl,
      sundayRoastItems,
    })
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
    const filename = `booking-sheets-${safeFilename((event as EventRow).name)}.pdf`

    return new NextResponse(pdfContent, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('Failed to generate event booking sheets:', error)
    return new NextResponse('Failed to generate booking sheets', { status: 500 })
  }
}
