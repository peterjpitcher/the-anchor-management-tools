import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { resolveEventStartIso } from '@/lib/events/event-when'

/**
 * What an edit, cancellation or postponement of an event would touch, and the rules that decide
 * whether it may go ahead (release 16 of the customer bookings review: BK-026, BK-027, BK-036,
 * BK-073, BK-139, BK-140; owner decisions D8 and D9).
 *
 * Staff used to change a sold night's date, price, payment method, capacity or status with one
 * Save and no count of who was affected. Every such change now either goes through, needs a
 * manager to confirm a summary of who it affects, or is refused. The rules are pure so they can be
 * tested; the counts come from `loadEventBookingImpact`.
 */

/** Shown when the database refuses a payment method change on a booked event (D9). */
export const EVENT_PAYMENT_MODE_LOCKED_MESSAGE =
  'The payment method is locked because this event already has bookings. Guests keep the terms they booked under. You can still change the price for new sales.'

/** How long a cancellation waits before it refunds and messages anyone, so it can be undone (BK-026). */
export const EVENT_CANCELLATION_DELAY_MS = 10 * 60 * 1000

/** The booking statuses that hold a place at the event. */
export const ACTIVE_EVENT_BOOKING_STATUSES = ['confirmed', 'pending_payment'] as const

/** The event fields whose before and after values the audit log records (BK-139). */
export const AUDITED_EVENT_FIELDS = [
  'name',
  'date',
  'time',
  'end_time',
  'event_status',
  'price',
  'payment_mode',
  'is_free',
  'online_discount_type',
  'online_discount_value',
  'capacity',
  'seated_capacity',
  'standing_capacity',
  'booking_mode',
  'bookings_enabled',
  'booking_cutoff_at',
  'slug',
] as const

export type AuditedEventField = (typeof AUDITED_EVENT_FIELDS)[number]
export type EventChangeSnapshot = Partial<Record<AuditedEventField, unknown>>

export interface EventBookingImpact {
  /** Confirmed or awaiting-payment bookings that are not reminders. */
  activeBookings: number
  activeSeats: number
  pendingPaymentBookings: number
  /** Bookings holding money taken online (expired ones included: they are owed it back). */
  paidBookings: number
  /** Money taken online on those bookings, less what has already been refunded. */
  amountPaid: number
  /** Active bookings whose guest has an email address. */
  reachableByEmail: number
  /** Active bookings whose guest has no email but can be texted. */
  reachableByTextOnly: number
  /** Active bookings whose guest has neither, so staff must ring them. */
  unreachable: number
  /** Active bookings holding a table or communal seats on the night. */
  seatedBookings: number
}

export const EMPTY_EVENT_BOOKING_IMPACT: EventBookingImpact = {
  activeBookings: 0,
  activeSeats: 0,
  pendingPaymentBookings: 0,
  paidBookings: 0,
  amountPaid: 0,
  reachableByEmail: 0,
  reachableByTextOnly: 0,
  unreachable: 0,
  seatedBookings: 0,
}

type ImpactCustomer = { email?: string | null; mobile_number?: string | null; sms_status?: string | null }

function hasUsableEmail(customer: ImpactCustomer | null | undefined): boolean {
  return typeof customer?.email === 'string' && customer.email.includes('@')
}

function canBeTexted(customer: ImpactCustomer | null | undefined): boolean {
  return customer?.sms_status === 'active' && typeof customer?.mobile_number === 'string' && customer.mobile_number.trim().length > 0
}

function toMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Counts the bookings, money and contact routes an event change would touch. Reads with the
 * service-role client: payments are service-role only (20261026182434). Throws when a read fails,
 * so a caller never mistakes "could not check" for "nobody is affected".
 */
export async function loadEventBookingImpact(
  db: SupabaseClient<any, 'public', any>,
  eventId: string
): Promise<EventBookingImpact> {
  const { data: bookingRows, error: bookingsError } = await db
    .from('bookings')
    .select('id, seats, status, is_reminder_only, customer:customers(email, mobile_number, sms_status)')
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'pending_payment', 'expired'])

  if (bookingsError) {
    throw new Error(`Could not count the bookings for this event: ${bookingsError.message}`)
  }

  const rows = (bookingRows ?? []).filter((row) => row.is_reminder_only !== true)
  const ids = rows.map((row) => row.id as string)
  const impact: EventBookingImpact = { ...EMPTY_EVENT_BOOKING_IMPACT }
  if (ids.length === 0) return impact

  const [paidResult, refundResult, tableResult, communalResult] = await Promise.all([
    db.from('payments').select('event_booking_id, amount')
      .in('event_booking_id', ids)
      .in('charge_type', ['prepaid_event', 'seat_increase'])
      .in('status', ['succeeded', 'partially_refunded']),
    db.from('payments').select('event_booking_id, amount')
      .in('event_booking_id', ids)
      .eq('charge_type', 'refund')
      .in('status', ['refunded', 'pending', 'succeeded']),
    db.from('table_bookings').select('event_booking_id')
      .in('event_booking_id', ids)
      .in('status', ['confirmed', 'pending_payment']),
    db.from('event_communal_seat_allocations').select('event_booking_id')
      .in('event_booking_id', ids),
  ])
  for (const result of [paidResult, refundResult, tableResult, communalResult]) {
    if (result.error) {
      throw new Error(`Could not check this event's payments and seats: ${result.error.message}`)
    }
  }

  const paidByBooking = new Map<string, number>()
  for (const row of paidResult.data ?? []) {
    const id = row.event_booking_id as string
    paidByBooking.set(id, (paidByBooking.get(id) ?? 0) + Math.max(0, Number(row.amount ?? 0)))
  }
  for (const row of refundResult.data ?? []) {
    const id = row.event_booking_id as string
    if (paidByBooking.has(id)) {
      paidByBooking.set(id, (paidByBooking.get(id) ?? 0) - Math.max(0, Number(row.amount ?? 0)))
    }
  }
  const seated = new Set<string>([
    ...(tableResult.data ?? []).map((row) => row.event_booking_id as string),
    ...(communalResult.data ?? []).map((row) => row.event_booking_id as string),
  ])

  for (const row of rows) {
    const owed = Math.max(0, paidByBooking.get(row.id as string) ?? 0)
    if (owed > 0) {
      impact.paidBookings += 1
      impact.amountPaid += owed
    }
    if (!(ACTIVE_EVENT_BOOKING_STATUSES as readonly string[]).includes(row.status as string)) continue
    impact.activeBookings += 1
    impact.activeSeats += Math.max(0, Number(row.seats ?? 0))
    if (row.status === 'pending_payment') impact.pendingPaymentBookings += 1
    if (seated.has(row.id as string)) impact.seatedBookings += 1
    const customer = (Array.isArray(row.customer) ? row.customer[0] : row.customer) as ImpactCustomer | null
    if (hasUsableEmail(customer)) impact.reachableByEmail += 1
    else if (canBeTexted(customer)) impact.reachableByTextOnly += 1
    else impact.unreachable += 1
  }
  impact.amountPaid = toMoney(impact.amountPaid)
  return impact
}

/** The before and after values of every audited field that changed (BK-139). */
export function diffEventSnapshots(
  before: EventChangeSnapshot,
  after: EventChangeSnapshot
): { old_values: EventChangeSnapshot; new_values: EventChangeSnapshot } | null {
  const oldValues: EventChangeSnapshot = {}
  const newValues: EventChangeSnapshot = {}
  for (const field of AUDITED_EVENT_FIELDS) {
    if (!(field in after)) continue
    const previous = normaliseForCompare(before[field])
    const next = normaliseForCompare(after[field])
    if (previous === next) continue
    oldValues[field] = before[field] ?? null
    newValues[field] = after[field] ?? null
  }
  return Object.keys(newValues).length > 0 ? { old_values: oldValues, new_values: newValues } : null
}

function normaliseForCompare(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return String(Number(value))
  }
  if (typeof value === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5)
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/** Who a guest message reaches, and who staff must ring (BK-089). */
export function describeReach(impact: EventBookingImpact): string {
  const parts = [
    impact.reachableByEmail > 0 ? `${impact.reachableByEmail} by email` : null,
    impact.reachableByTextOnly > 0 ? `${impact.reachableByTextOnly} by text` : null,
  ].filter(Boolean)
  const reached = parts.length > 0 ? `Guests are told ${parts.join(' and ')}.` : 'No guest can be reached by email or text.'
  const ring = impact.unreachable > 0
    ? ` ${plural(impact.unreachable, 'booking has', 'bookings have')} no email or textable mobile, so ring ${impact.unreachable === 1 ? 'that guest' : 'those guests'}.`
    : ''
  return reached + ring
}

export type EventPaymentModeValue = 'free' | 'cash_only' | 'prepaid'

export interface EventChangeInput {
  current: {
    date: string | null
    time: string | null
    end_time?: string | null
    event_status: string | null
    payment_mode: EventPaymentModeValue
    price: number
    capacity: number | null
    booking_mode: string
    booking_cutoff_at?: string | null
    online_discount_ends_at?: string | null
  }
  next: {
    date: string | null
    time: string | null
    end_time?: string | null
    event_status: string | null
    payment_mode: EventPaymentModeValue
    price: number
    capacity: number | null
  }
  impact: EventBookingImpact
  /**
   * True when moving the night carries its tables and communal seats with it (BK-073). Before
   * that move existed, a seated night with bookings could not change date.
   */
  seatedBookingsMoveWithEvent: boolean
  /** True for the Cancel event and Postpone event actions, which have their own confirm step. */
  lifecycleAction?: boolean
}

export interface EventChangeAssessment {
  /** Reasons the change cannot be saved at all. */
  blockers: string[]
  /** What a manager must read and confirm before the change is saved. */
  confirmations: string[]
  /** Points shown after saving that need no confirmation (BK-140). */
  warnings: string[]
}

const LIFECYCLE_STATUSES = new Set(['cancelled', 'postponed'])

export function isSeatedBookingMode(bookingMode: string | null | undefined): boolean {
  return bookingMode === 'table' || bookingMode === 'mixed' || bookingMode === 'communal' || !bookingMode
}

/**
 * Whether an edit may be saved straight away, needs a manager to confirm, or is refused.
 *
 * - Cancelling and postponing go through their own confirm step (D8), never through Save.
 * - Once anyone has booked, the payment method is locked (D9); a price change applies to new
 *   sales only and is confirmed.
 * - A date or time change with bookings is confirmed, because every guest is told.
 * - A capacity below the seats already sold is confirmed, because it closes the night.
 * - Reinstating a cancelled night is confirmed, because earlier refunds are not reversed.
 */
export function assessEventChange(input: EventChangeInput): EventChangeAssessment {
  const { current, next, impact } = input
  const blockers: string[] = []
  const confirmations: string[] = []
  const warnings: string[] = []
  const booked = impact.activeBookings > 0
  const bookedLine = `${plural(impact.activeBookings, 'booking', 'bookings')} (${plural(impact.activeSeats, 'seat', 'seats')})`

  const currentStatus = current.event_status ?? 'scheduled'
  const nextStatus = next.event_status ?? currentStatus
  if (!input.lifecycleAction && nextStatus !== currentStatus && LIFECYCLE_STATUSES.has(nextStatus)) {
    blockers.push(
      nextStatus === 'cancelled'
        ? 'Use Cancel event to cancel this event, so a manager sees who is affected before anyone is refunded or told.'
        : 'Use Postpone event to postpone this event, so a manager sees who is affected before anyone is told.'
    )
  }

  if (next.payment_mode !== current.payment_mode && booked) {
    blockers.push(
      `The payment method is locked because ${bookedLine} ${impact.activeBookings === 1 ? 'was' : 'were'} made under it. Guests keep the terms they booked under. You can still change the price for new sales.`
    )
  }

  if (blockers.length > 0) return { blockers, confirmations, warnings }

  const dateMoved = (next.date ?? '') !== (current.date ?? '') || (next.time ?? '').slice(0, 5) !== (current.time ?? '').slice(0, 5)
  const endMoved = next.end_time !== undefined && (next.end_time ?? '').slice(0, 5) !== (current.end_time ?? '').slice(0, 5)
  if ((dateMoved || endMoved) && booked) {
    if (impact.seatedBookings > 0 && isSeatedBookingMode(current.booking_mode) && !input.seatedBookingsMoveWithEvent) {
      blockers.push('This event has seated bookings. Cancel and rebook them, or ask for a move.')
      return { blockers, confirmations, warnings }
    }
    if (dateMoved) {
      confirmations.push(`${bookedLine} will be told the new date and time. ${describeReach(impact)}`)
    }
    if (impact.seatedBookings > 0 && isSeatedBookingMode(current.booking_mode)) {
      confirmations.push(`Their ${plural(impact.seatedBookings, 'table or seat booking', 'table and seat bookings')} move to the new time with the event. If any no longer fit, nothing is saved and you are told which.`)
    }
  }

  if (Number(next.price) !== Number(current.price) && booked) {
    confirmations.push(`${bookedLine} ${impact.activeBookings === 1 ? 'keeps' : 'keep'} the price they booked at. The new price applies to new sales only.`)
  }

  if (next.capacity !== null && next.capacity !== undefined && next.capacity < impact.activeSeats) {
    confirmations.push(`${plural(impact.activeSeats, 'seat is', 'seats are')} already sold, so a limit of ${next.capacity} closes sales. Nobody already booked loses their place.`)
  }

  if (currentStatus === 'cancelled' && nextStatus !== 'cancelled') {
    confirmations.push('Reinstating this event reopens bookings. Bookings already cancelled stay cancelled and refunds already made are not reversed.')
  }

  if (dateMoved && nextStatus === 'postponed') {
    warnings.push('This event is still marked Postponed, so nobody can book it. Change its status to Rescheduled or Scheduled to reopen bookings.')
  }

  if (dateMoved && next.date && next.time) {
    const newStart = resolveEventStartIso({ date: next.date, time: next.time })
    if (newStart) {
      const startMs = Date.parse(newStart)
      if (current.booking_cutoff_at && Date.parse(current.booking_cutoff_at) > startMs) {
        warnings.push(`Online ticket sales are set to close at ${formatDateTime12Hour(current.booking_cutoff_at)}, after the new start. Move the sales close time in Pricing and Booking.`)
      }
      if (current.online_discount_ends_at && Date.parse(current.online_discount_ends_at) > startMs) {
        warnings.push(`The online discount ends at ${formatDateTime12Hour(current.online_discount_ends_at)}, after the new start. Move the discount deadline in Tickets.`)
      }
    }
  }

  return { blockers, confirmations, warnings }
}

/** The summary a manager confirms before cancelling or postponing a whole event (D8). */
export function describeEventLifecycleImpact(
  action: 'cancel' | 'postpone',
  impact: EventBookingImpact
): string[] {
  if (impact.activeBookings === 0 && impact.paidBookings === 0) {
    return [action === 'cancel'
      ? 'Nobody has booked, so nobody is refunded or told.'
      : 'Nobody has booked, so nobody is told.']
  }
  const lines: string[] = []
  const bookedLine = `${plural(impact.activeBookings, 'booking', 'bookings')} (${plural(impact.activeSeats, 'seat', 'seats')})`
  if (action === 'cancel') {
    lines.push(`${bookedLine} will be cancelled.`)
    lines.push(impact.paidBookings > 0
      ? `${plural(impact.paidBookings, 'booking was', 'bookings were')} paid online, and ${formatMoney(impact.amountPaid)} will be refunded in full.`
      : 'No money was taken online, so there is nothing to refund.')
    lines.push(`Each guest is told the event is cancelled${impact.paidBookings > 0 ? ' and, if they paid, that their refund is on its way' : ''}. ${describeReach(impact)}`)
    lines.push('Refunds and messages start in 10 minutes. Until then you can undo the cancellation from this drawer.')
  } else {
    lines.push(`${bookedLine} ${impact.activeBookings === 1 ? 'stays' : 'stay'} booked and ${impact.activeBookings === 1 ? 'carries' : 'carry'} over to the new date.`)
    lines.push(`Each guest is told the event is postponed, that their booking carries over, and that they can ask for a refund if the new date does not suit. ${describeReach(impact)}`)
    lines.push('Nobody is refunded now. Set the new date when it is known, and guests are told it then.')
  }
  return lines
}

/** How many bookings hold a place at the event, reminders left out. Throws when the count fails. */
export async function countActiveEventBookings(
  db: SupabaseClient<any, 'public', any>,
  eventId: string
): Promise<{ bookings: number; seats: number }> {
  const { data, error } = await db
    .from('bookings')
    .select('seats, is_reminder_only')
    .eq('event_id', eventId)
    .in('status', [...ACTIVE_EVENT_BOOKING_STATUSES])
  if (error) throw new Error(`Could not count the bookings for this event: ${error.message}`)
  const rows = (data ?? []).filter((row) => row.is_reminder_only !== true)
  return { bookings: rows.length, seats: rows.reduce((sum, row) => sum + Math.max(0, Number(row.seats ?? 0)), 0) }
}

/** The line a manager confirms before a ticket price changes on a night with bookings (BK-036). */
export function describeTicketPriceChange(bookings: number): string {
  return `${plural(bookings, 'booking', 'bookings')} already made ${bookings === 1 ? 'keeps' : 'keep'} the price they booked at. The new price applies to new sales only.`
}

type MoveFailure = { booking_id?: unknown; reason?: unknown }

function describeMoveReason(reason: string): string {
  if (reason.includes('private_blocked')) return 'a private hire has its table'
  if (reason.includes('communal_overlap') || reason.includes('communal_table_capacity')) return 'not enough shared seats are free'
  if (reason.includes('overlap')) return 'its table is taken'
  if (reason.includes('not_bookable')) return 'its table cannot be booked'
  return 'it does not fit'
}

/**
 * Staff wording for a move that move_event_seated_bookings_v01 refused (BK-073). Nothing was
 * changed, and each booking that did not fit is named with why.
 */
export function describeSeatedMoveRefusal(result: { reason?: unknown; bookings?: unknown }): string {
  if (result.reason === 'new_start_in_past') return 'The new start is in the past. Nothing has changed.'
  if (result.reason === 'event_not_found') return 'This event could not be found. Nothing has changed.'
  const failures = (Array.isArray(result.bookings) ? result.bookings : []) as MoveFailure[]
  if (failures.length === 0) return 'The seated bookings could not be moved to the new time, so nothing has changed.'
  const listed = failures
    .slice(0, 10)
    .map((failure) => `booking ${String(failure.booking_id ?? '').slice(0, 8)} (${describeMoveReason(String(failure.reason ?? ''))})`)
    .join(', ')
  const more = failures.length > 10 ? ` and ${failures.length - 10} more` : ''
  return `${plural(failures.length, 'booking does', 'bookings do')} not fit on the new night, so nothing has changed: ${listed}${more}. Move or cancel ${failures.length === 1 ? 'it' : 'them'} first, or choose another time.`
}
