import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bookingHasGuestSeats,
  buildBookingSheetModel,
  formatSheetTableLabel,
  type BookingSheetDeposit,
  type BookingSheetModel,
  type SheetTableAssignment,
} from '@/lib/table-bookings/booking-sheet'
import { loadPreorderOrder } from '@/lib/table-bookings/preorder'
import { depositHeldGbp } from '@/lib/table-bookings/staff-cancellation'
import {
  getTableBookingDepositState,
  getTableBookingStatusLabel,
  getTableBookingVisualState,
} from '@/lib/table-bookings/ui'

// Untyped like the other pre-order loaders (preorder.ts): the generated types are not threaded through the admin client.
type Db = SupabaseClient<any, any, any>

type CustomerRow = {
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
}

export type BookingSheetRow = {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string | null
  party_size: number | null
  status: string | null
  booking_type: string | null
  payment_status: string | null
  payment_method: string | null
  deposit_waived: boolean | null
  deposit_amount: number | string | null
  deposit_amount_locked: number | string | null
  deposit_refund_status: string | null
  paypal_deposit_capture_id: string | null
  hold_expires_at: string | null
  seated_at: string | null
  left_at: string | null
  no_show_at: string | null
  is_outside_seating: boolean | null
  allergies: string[] | null
  dietary_requirements: string[] | null
  special_requirements: string | null
  booking_period_answer: boolean | null
  booking_period_requires_preorder: boolean | null
  christmas_course_counts: number[] | null
  customer: CustomerRow | CustomerRow[] | null
  table_booking_tables: SheetTableAssignment[] | null
}

/** Exactly the columns the sheet prints, and nothing else. */
export const BOOKING_SHEET_SELECT = `
  id, booking_reference, booking_date, booking_time, party_size, status, booking_type,
  payment_status, payment_method, deposit_waived, deposit_amount, deposit_amount_locked,
  deposit_refund_status, paypal_deposit_capture_id, hold_expires_at,
  seated_at, left_at, no_show_at, is_outside_seating,
  allergies, dietary_requirements, special_requirements,
  booking_period_answer, booking_period_requires_preorder, christmas_course_counts,
  customer:customers!table_bookings_customer_id_fkey(first_name, last_name, mobile_number),
  table_booking_tables:booking_table_assignments!booking_table_assignments_table_booking_id_fkey(
    table:tables!booking_table_assignments_table_id_fkey(id, name, table_number, is_bookable)
  )
`

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

/**
 * What to take off the bill, from the booking's payment columns and its recorded refunds. A refund
 * read that failed (`refundedGbp` null) still shows the paid amount, labelled as unchecked, rather
 * than inventing that nothing came back.
 */
export function resolveSheetDeposit(row: BookingSheetRow, refundedGbp: number | null): BookingSheetDeposit {
  const paid = row.payment_status === 'completed' || row.payment_status === 'partial_refund'
  if (paid) {
    const held = depositHeldGbp(row, refundedGbp ?? 0)
    return held > 0 ? { kind: 'paid', heldGbp: held, refundsChecked: refundedGbp !== null } : { kind: 'refunded' }
  }
  if (row.payment_status === 'refunded') return { kind: 'refunded' }
  const state = getTableBookingDepositState(row)
  if (state.kind === 'waived') return { kind: 'waived' }
  if (state.kind === 'pending' || state.kind === 'required') return { kind: 'unpaid' }
  return { kind: 'none' }
}

async function loadRefundedGbp(admin: Db, bookingId: string): Promise<number | null> {
  const { data, error } = await admin
    .from('payment_refunds')
    .select('amount, status')
    .eq('source_type', 'table_booking')
    .eq('source_id', bookingId)
  if (error) {
    console.error('Booking sheet could not read the refunds for a booking')
    return null
  }
  // Completed and pending refunds both count as gone, the same as the staff detail page.
  return ((data ?? []) as Array<{ amount: number | string | null; status: string | null }>)
    .filter((refund) => refund.status === 'completed' || refund.status === 'pending')
    .reduce((sum, refund) => sum + (Number(refund.amount) || 0), 0)
}

/**
 * The one-pager for one booking, or null when there is no such booking.
 *
 * Read with the admin client: the pre-order and refund tables are service-role only, and the shared
 * FOH login must see the organiser's mobile. Callers MUST have checked the user's table_bookings
 * view permission first. Throws when the booking or its pre-order cannot be read, so the page shows
 * an error rather than a sheet with seats silently missing.
 */
export async function loadBookingSheetModel(admin: Db, bookingId: string): Promise<BookingSheetModel | null> {
  const { data, error } = await admin.from('table_bookings').select(BOOKING_SHEET_SELECT).eq('id', bookingId).maybeSingle()
  if (error) throw new Error(error.message || 'Booking read failed')
  if (!data) return null

  const row = data as unknown as BookingSheetRow
  const [order, refundedGbp] = await Promise.all([
    bookingHasGuestSeats(row) ? loadPreorderOrder(admin, row.id) : Promise.resolve(null),
    loadRefundedGbp(admin, row.id),
  ])

  const customer = firstOrSelf(row.customer)
  const organiserName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()

  return buildBookingSheetModel({
    booking: {
      id: row.id,
      reference: row.booking_reference || '',
      bookingDate: row.booking_date,
      bookingTime: row.booking_time,
      partySize: Number(row.party_size) || 0,
      statusLabel: getTableBookingStatusLabel(getTableBookingVisualState(row)),
      organiserName,
      organiserMobile: customer?.mobile_number ?? null,
      tableLabel: formatSheetTableLabel(row),
      allergies: row.allergies ?? [],
      dietary: row.dietary_requirements ?? [],
      notes: row.special_requirements,
      deposit: resolveSheetDeposit(row, refundedGbp),
    },
    order: order && order.hasGuestSeats ? order : null,
  })
}
