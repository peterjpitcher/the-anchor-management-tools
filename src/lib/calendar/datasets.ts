import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { displayName } from '@/lib/employees/display-name'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { loadDayLoads } from '@/services/day-load'
import { toLocalIsoDate as toLondonIsoDate } from '@/lib/dateUtils'
import { PROMOTIONAL_SMS_TEMPLATE_KEYS } from '@/lib/sms/promo-template-keys'
import type { TextMessageDay } from '@/components/schedule-calendar/adapters'
import {
  buildPrivateBookingBalanceDueSummaries,
  type DashboardPrivateBookingBalanceDueSummary,
} from '@/app/(authenticated)/dashboard/private-booking-balances'

/**
 * Pure, server-only readers for the shared venue calendar.
 *
 * These take an explicit Supabase client, an explicit date range and an
 * already-resolved capability, and never touch cookies. That is deliberate: the
 * dashboard runs its snapshot inside `unstable_cache`, which cannot read cookies
 * in Next 15, so it cannot call a session-gated server action. The one gated entry
 * point is getVenueCalendarMonth (src/app/actions/venue-calendar.ts), which both
 * calendars load through, a month at a time, so the two pages cannot drift apart.
 */

/**
 * Every reader reports a state rather than a bare array.
 *
 * A bare `[]` cannot tell "you may not see this" from "there is nothing" from
 * "the query broke", which is exactly the silent-empty failure that let a
 * permission problem look like an empty calendar for months.
 */
export type CalendarDataset<T> =
  | { status: 'ok'; data: T[] }
  | { status: 'denied'; data: [] }
  | { status: 'failed'; data: []; message: string }

export function denied(): { status: 'denied'; data: [] } {
  return { status: 'denied', data: [] }
}

export function failed(message: string): { status: 'failed'; data: []; message: string } {
  return { status: 'failed', data: [], message }
}

export function ok<T>(data: T[]): { status: 'ok'; data: T[] } {
  return { status: 'ok', data }
}

// --- Special hours -------------------------------------------------------

export interface CalendarSpecialHours {
  id: string
  date: string
  opens: string | null
  closes: string | null
  is_closed: boolean
  is_kitchen_closed: boolean
  note: string | null
}

export async function readSpecialHours(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<CalendarDataset<CalendarSpecialHours>> {
  const { data, error } = await client
    .from('special_hours')
    .select('id, date, opens, closes, is_closed, is_kitchen_closed, note')
    .gte('date', startIso)
    .lte('date', endIso)
    .order('date', { ascending: true })
    .range(0, 999)

  if (error) {
    console.error('Failed to load special hours for the calendar:', error)
    return failed('Opening-hours changes could not be loaded.')
  }

  return ok(
    (data ?? []).map((row) => ({
      id: String(row.id),
      date: String(row.date),
      opens: typeof row.opens === 'string' ? row.opens : null,
      closes: typeof row.closes === 'string' ? row.closes : null,
      is_closed: Boolean(row.is_closed),
      is_kitchen_closed: Boolean(row.is_kitchen_closed),
      note: typeof row.note === 'string' ? row.note : null,
    })),
  )
}

// --- Employee birthdays --------------------------------------------------

export interface CalendarBirthday {
  employee_id: string
  employee_name: string
  occurrence_date: string
  turning_age: number | null
  job_title: string | null
}

function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Every occurrence of an employee's birthday inside the range.
 *
 * A 29 February birthday is observed on 28 February in a non-leap year, which is
 * what the month check below does: constructing 29 February in a common year
 * rolls into March, so it is pulled back rather than silently moved.
 */
export function birthdayOccurrencesInRange(
  input: {
    employee_id: string
    first_name: string | null
    last_name: string | null
    preferred_name: string | null
    job_title: string | null
    date_of_birth: string | null
  },
  startIso: string,
  endIso: string,
): CalendarBirthday[] {
  if (!input.date_of_birth) return []

  const dob = new Date(`${input.date_of_birth}T12:00:00`)
  if (Number.isNaN(dob.getTime())) return []

  const start = new Date(`${startIso}T12:00:00`)
  const end = new Date(`${endIso}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []

  const name = displayName(input, 'Employee')
  const out: CalendarBirthday[] = []

  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    let occurrence = new Date(year, dob.getMonth(), dob.getDate(), 12, 0, 0, 0)
    if (occurrence.getMonth() !== dob.getMonth()) {
      occurrence = new Date(year, 1, 28, 12, 0, 0, 0)
    }
    const iso = localIso(occurrence)
    if (iso < startIso || iso > endIso) continue

    out.push({
      employee_id: input.employee_id,
      employee_name: name,
      occurrence_date: iso,
      turning_age: year - dob.getFullYear(),
      job_title: input.job_title,
    })
  }

  return out
}

export async function readBirthdays(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<CalendarDataset<CalendarBirthday>> {
  const { data, error } = await client
    .from('employees')
    .select('employee_id, first_name, last_name, preferred_name, job_title, date_of_birth')
    .in('status', ['Active', 'Started Separation'])
    .not('date_of_birth', 'is', null)
    .order('first_name', { ascending: true })
    .range(0, 999)

  if (error) {
    console.error('Failed to load employee birthdays for the calendar:', error)
    return failed('Birthdays could not be loaded.')
  }

  const out = (data ?? [])
    .flatMap((employee) =>
      birthdayOccurrencesInRange(
        {
          employee_id: String(employee.employee_id),
          first_name: typeof employee.first_name === 'string' ? employee.first_name : null,
          last_name: typeof employee.last_name === 'string' ? employee.last_name : null,
          preferred_name:
            typeof employee.preferred_name === 'string' ? employee.preferred_name : null,
          job_title: typeof employee.job_title === 'string' ? employee.job_title : null,
          date_of_birth:
            typeof employee.date_of_birth === 'string' ? employee.date_of_birth : null,
        },
        startIso,
        endIso,
      ),
    )
    .sort(
      (a, b) =>
        a.occurrence_date.localeCompare(b.occurrence_date) ||
        a.employee_name.localeCompare(b.employee_name),
    )

  return ok(out)
}

// --- Private booking balances --------------------------------------------

export type CalendarBalanceDue = DashboardPrivateBookingBalanceDueSummary

export async function readBalanceDues(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<CalendarDataset<CalendarBalanceDue>> {
  // Same view and money maths as the dashboard, so the two surfaces cannot disagree about a
  // figure. Completed and cancelled hires are read too, and a paid balance is kept (flagged
  // settled): the calendar is a record of what happened, and a balance marker used to vanish
  // the moment it was paid or its hire was closed. Drafts are left out: a hire nobody has
  // confirmed owes no balance.
  const { data, error } = await client
    .from('private_bookings_with_details')
    .select(
      'id, customer_name, customer_first_name, customer_last_name, balance_due_date, event_date, status, total_amount, calculated_total, gross_total, final_payment_date',
    )
    .in('status', ['confirmed', 'completed', 'cancelled'])
    .not('balance_due_date', 'is', null)
    .gte('balance_due_date', startIso)
    .lte('balance_due_date', endIso)
    .order('balance_due_date', { ascending: true })
    .range(0, 999)

  if (error) {
    console.error('Failed to load private booking balances for the calendar:', error)
    return failed('Private-hire balance dates could not be loaded.')
  }

  const bookingIds = (data ?? []).map((row) => String(row.id))
  let payments: Array<{ booking_id?: unknown; amount?: unknown }> = []

  if (bookingIds.length > 0) {
    const { data: paymentRows, error: paymentsError } = await client
      .from('private_booking_payments')
      .select('booking_id, amount')
      .in('booking_id', bookingIds)

    if (paymentsError) {
      console.error('Failed to load private booking payments for the calendar:', paymentsError)
      return failed('Private-hire balance dates could not be loaded.')
    }
    payments = paymentRows ?? []
  }

  // Reuse the dashboard's existing balance maths rather than inventing new
  // accounting rules. This is money, and there is already one authority for it.
  return ok(buildPrivateBookingBalanceDueSummaries(data ?? [], payments, { includeSettled: true }))
}

// --- Marketing email sends ------------------------------------------------

export interface CalendarMarketingSend {
  id: string
  name: string
  subject: string
  audience_type: string
  status: string
  /** The instant the send sits at. Resolved here so both calendars agree. */
  send_at: string | null
  recipient_count: number | null
}

/**
 * Campaign statuses worth a place on the calendar.
 *
 * Drafts are excluded on purpose: a draft has no send date, so it cannot be
 * placed on a day, and a half-written campaign is not a diary entry. Cancelled
 * ones ARE included, struck through, because "that mailing is not going out" is
 * exactly what someone looking at next Tuesday needs to know.
 */
const CALENDAR_CAMPAIGN_STATUSES = ['scheduled', 'sending', 'paused', 'completed', 'cancelled']

/**
 * When a campaign belongs on the calendar.
 *
 * `started_at` first: once a send has begun, the day it actually went is the
 * truth, and a rescheduled-then-started campaign would otherwise sit on the day
 * it was originally due. `scheduled_for` covers everything still to come.
 */
function resolveSendAt(row: {
  started_at?: unknown
  scheduled_for?: unknown
  completed_at?: unknown
}): string | null {
  for (const value of [row.started_at, row.scheduled_for, row.completed_at]) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

/**
 * Marketing sends in the window.
 *
 * `marketing_campaigns` is service-role only (RLS plus a REVOKE from
 * `authenticated`), so unlike the other readers this one must be handed an ADMIN
 * client. Both call sites resolve the caller's `marketing:view` permission
 * first; this reader never decides who may see a campaign.
 */
export async function readMarketingSends(
  adminClient: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<CalendarDataset<CalendarMarketingSend>> {
  // Widened to whole days at the boundaries, because both columns are instants
  // and a bare date compares as midnight UTC.
  const startInstant = `${startIso}T00:00:00Z`
  const endInstant = `${endIso}T23:59:59Z`

  const { data, error } = await adminClient
    .from('marketing_campaigns')
    .select(
      'id, name, subject, audience_type, status, scheduled_for, started_at, completed_at, approved_recipient_count',
    )
    .in('status', CALENDAR_CAMPAIGN_STATUSES)
    // Either date can be the one that places the row, so filter on both and let
    // resolveSendAt pick. Filtering on scheduled_for alone would drop a send that
    // was started manually and never carried a schedule.
    .or(
      `and(started_at.gte.${startInstant},started_at.lte.${endInstant}),` +
        `and(scheduled_for.gte.${startInstant},scheduled_for.lte.${endInstant})`,
    )
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .range(0, 999)

  if (error) {
    console.error('Failed to load marketing sends for the calendar:', error)
    return failed('Marketing email sends could not be loaded.')
  }

  return ok(
    (data ?? [])
      .map((row) => ({
        id: String(row.id),
        name: typeof row.name === 'string' ? row.name : 'Marketing email',
        subject: typeof row.subject === 'string' ? row.subject : '',
        audience_type: typeof row.audience_type === 'string' ? row.audience_type : '',
        status: typeof row.status === 'string' ? row.status : '',
        send_at: resolveSendAt(row),
        recipient_count:
          typeof row.approved_recipient_count === 'number' ? row.approved_recipient_count : null,
      }))
      .filter((send) => send.send_at !== null),
  )
}

// --- Daily operations ----------------------------------------------------

export interface CalendarDailyOps {
  /** Diners plus event tickets, counted as every screen counts them (BK-075). */
  coversByDate: Record<string, number>
  staffByDate: Record<string, string[]>
  /** Guests at private hires holding their rooms, shown as their own figure. */
  hireGuestsByDate?: Record<string, number>
}

/**
 * Covers and private-hire guests per day, from the shared day load (review BK-075): the calendar
 * used to count every table booking, so an event's tables counted, its shared-seating and general
 * admission tickets did not, and a night full of a private party read as empty. The client must be
 * the admin client, after the caller's own permission check: the day load reads hires, event
 * tickets and the kitchen list, which staff sessions cannot all see.
 */
export async function readCoversByDate(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<CalendarDataset<{ date: string; covers: number; hireGuests: number }>> {
  try {
    const loads = await loadDayLoads(startIso, endIso, { db: client, withHours: false, includeCompletedHires: true })
    return ok(
      [...loads.values()]
        .filter((load) => load.covers > 0 || load.privateHireGuests > 0)
        .map((load) => ({ date: load.date, covers: load.covers, hireGuests: load.privateHireGuests })),
    )
  } catch (error) {
    console.error('Failed to load covers for the calendar:', error)
    return failed('Covers could not be loaded.')
  }
}

/** One rota shift as the calendar reads it. */
type CalendarShiftRow = {
  employee_id: string | null
  shift_date: string | null
  start_time: string | null
}

export async function readStaffByDate(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<CalendarDataset<{ date: string; staff: string[] }>> {
  // Paged. Asking for 5,000 rows was misleading: Supabase returns at most 1,000 per
  // request and says nothing when it cuts a result short, so the window (90 days back,
  // 180 ahead) would have started losing shifts the moment it passed 1,000 rows, with
  // December staffing the obvious trigger. 437 rows today out of 1,705 in the table.
  // `id` is the primary key, so ordering by it keeps the page boundaries stable.
  let shiftRows: CalendarShiftRow[]
  try {
    shiftRows = await fetchAllRows<CalendarShiftRow>(
      (from, to) =>
        client
          .from('rota_shifts')
          .select('employee_id, shift_date, start_time')
          // A sick shift is someone who did not work, so they are not on the day's list.
          .neq('status', 'sick')
          .gte('shift_date', startIso)
          .lte('shift_date', endIso)
          .order('id')
          .range(from, to),
      { label: 'calendar rota shifts' },
    )
  } catch (error) {
    console.error('Failed to load rota shifts for the calendar:', error)
    return failed('Who is working could not be loaded.')
  }

  // Open shifts have no employee. String(null) put the text "null" in the list, Postgres
  // refused the whole read as an invalid uuid, and the calendar lost every name.
  const employeeIds = [
    ...new Set(
      shiftRows
        .map((s) => s.employee_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]
  if (employeeIds.length === 0) return ok([])

  const { data: employees, error: employeeError } = await client
    .from('employees')
    .select('employee_id, first_name, last_name, preferred_name')
    .in('employee_id', employeeIds)

  if (employeeError) {
    console.error('Failed to load employees for the calendar rota:', employeeError)
    return failed('Who is working could not be loaded.')
  }

  // Keyed by employee id, not display name: two people called Sam are two
  // people, and de-duplicating by name would silently merge them.
  const nameById = new Map<string, string>()
  for (const employee of employees ?? []) {
    nameById.set(
      String(employee.employee_id),
      displayName(
        {
          first_name: typeof employee.first_name === 'string' ? employee.first_name : null,
          last_name: typeof employee.last_name === 'string' ? employee.last_name : null,
          preferred_name:
            typeof employee.preferred_name === 'string' ? employee.preferred_name : null,
        },
        'Staff',
      ),
    )
  }

  const earliestByDate = new Map<string, Map<string, string | null>>()
  for (const shift of shiftRows) {
    const employeeId = String(shift.employee_id)
    const date = shift.shift_date ? String(shift.shift_date) : null
    if (!date || !nameById.has(employeeId)) continue
    if (!earliestByDate.has(date)) earliestByDate.set(date, new Map())
    const perEmployee = earliestByDate.get(date)!
    const startTime = typeof shift.start_time === 'string' ? shift.start_time : null
    const existing = perEmployee.get(employeeId)
    if (!perEmployee.has(employeeId)) perEmployee.set(employeeId, startTime)
    else if (startTime && (!existing || startTime < existing)) perEmployee.set(employeeId, startTime)
  }

  const out: Array<{ date: string; staff: string[] }> = []
  for (const [date, perEmployee] of earliestByDate) {
    const staff = [...perEmployee.entries()]
      .sort(([idA, startA], [idB, startB]) => {
        const nameA = nameById.get(idA) ?? ''
        const nameB = nameById.get(idB) ?? ''
        if (startA && startB) return startA < startB ? -1 : startA > startB ? 1 : nameA.localeCompare(nameB)
        if (startA) return -1
        if (startB) return 1
        return nameA.localeCompare(nameB)
      })
      .map(([id]) => nameById.get(id)!)
    out.push({ date, staff })
  }

  return ok(out)
}

// --- Month readers ---------------------------------------------------------
//
// The calendar loads one month at a time (src/app/actions/venue-calendar.ts), so these read a
// bounded window with no status filter: what happened stays on the calendar whatever became of
// it. The filter bar, not the query, decides what is hidden. Every read is paged, because
// Supabase returns at most 1,000 rows a request and says nothing when it stops short.

export interface CalendarPrivateBooking {
  id: string
  customer_name: string | null
  event_date: string | null
  start_time: string | null
  end_time: string | null
  end_time_next_day: boolean | null
  guest_count: number | null
  status: string | null
  event_type: string | null
}

type PrivateBookingCalendarRow = {
  id: string
  customer_name: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  event_date: string | null
  start_time: string | null
  end_time: string | null
  end_time_next_day: boolean | null
  guest_count: number | null
  status: string | null
  event_type: string | null
}

/** Every private hire dated in the window, whatever its status. */
export async function readPrivateBookingsInRange(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<CalendarDataset<CalendarPrivateBooking>> {
  try {
    const rows = await fetchAllRows<PrivateBookingCalendarRow>(
      (from, to) =>
        client
          .from('private_bookings')
          .select(
            'id, customer_name, customer_first_name, customer_last_name, event_date, start_time, end_time, end_time_next_day, guest_count, status, event_type',
          )
          .gte('event_date', startIso)
          .lte('event_date', endIso)
          .order('id')
          .range(from, to),
      { label: 'calendar private bookings' },
    )
    return ok(
      rows.map((row) => ({
        id: String(row.id),
        customer_name:
          row.customer_name?.trim() ||
          [row.customer_first_name, row.customer_last_name].filter(Boolean).join(' ').trim() ||
          null,
        event_date: row.event_date,
        start_time: row.start_time,
        end_time: row.end_time,
        end_time_next_day: row.end_time_next_day,
        guest_count: row.guest_count,
        status: row.status,
        event_type: row.event_type,
      })),
    )
  } catch (error) {
    console.error('Failed to load private bookings for the calendar:', error)
    return failed('Private bookings could not be loaded.')
  }
}

export interface CalendarParkingBooking {
  id: string
  reference: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  vehicle_registration: string | null
  start_at: string | null
  end_at: string | null
  status: string | null
  payment_status: string | null
}

/**
 * Every parking booking on the car park at any point in the window, whatever its status.
 * Overlap, not starts-in: a fortnight's stay that began last month is on this month's grid.
 */
export async function readParkingInRange(
  client: SupabaseClient,
  startInstant: string,
  endInstant: string,
): Promise<CalendarDataset<CalendarParkingBooking>> {
  try {
    const rows = await fetchAllRows<CalendarParkingBooking>(
      (from, to) =>
        client
          .from('parking_bookings')
          .select(
            'id, reference, customer_first_name, customer_last_name, vehicle_registration, start_at, end_at, status, payment_status',
          )
          .lt('start_at', endInstant)
          .gte('end_at', startInstant)
          .order('id')
          .range(from, to),
      { label: 'calendar parking bookings' },
    )
    return ok(rows.map((row) => ({ ...row, id: String(row.id) })))
  } catch (error) {
    console.error('Failed to load parking bookings for the calendar:', error)
    return failed('Parking bookings could not be loaded.')
  }
}

export interface CalendarNoteRow {
  id: string
  note_date: string
  end_date: string
  title: string
  notes: string | null
  source: string
  start_time: string | null
  end_time: string | null
  color: string
  show_to_staff: boolean
}

type RawCalendarNoteRow = {
  id: string
  note_date: string
  end_date: string | null
  title: string | null
  notes: string | null
  source: string | null
  start_time: string | null
  end_time: string | null
  color: string | null
  show_to_staff: boolean | null
}

/**
 * Calendar notes that touch the window: started on or before its last day and ended on or after
 * its first. `calendar_notes` is read with the admin client after the caller's own permission
 * check, as listCalendarNotes does.
 */
export async function readCalendarNotesInRange(
  adminClient: SupabaseClient,
  startIso: string,
  endIso: string,
  defaultColour: string,
): Promise<CalendarDataset<CalendarNoteRow>> {
  try {
    const rows = await fetchAllRows<RawCalendarNoteRow>(
      (from, to) =>
        adminClient
          .from('calendar_notes')
          .select('id, note_date, end_date, title, notes, source, start_time, end_time, color, show_to_staff')
          .lte('note_date', endIso)
          .gte('end_date', startIso)
          .order('id')
          .range(from, to),
      { label: 'calendar notes' },
    )
    return ok(
      rows.map((row) => ({
        id: String(row.id),
        note_date: String(row.note_date),
        end_date: typeof row.end_date === 'string' ? row.end_date : String(row.note_date),
        title: typeof row.title === 'string' ? row.title : 'Calendar note',
        notes: typeof row.notes === 'string' ? row.notes : null,
        source: typeof row.source === 'string' ? row.source : 'manual',
        start_time: typeof row.start_time === 'string' ? row.start_time : null,
        end_time: typeof row.end_time === 'string' ? row.end_time : null,
        color: typeof row.color === 'string' && row.color ? row.color : defaultColour,
        // The column is NOT NULL DEFAULT true, so only an explicit false hides a note.
        show_to_staff: row.show_to_staff !== false,
      })),
    )
  } catch (error) {
    console.error('Failed to load calendar notes for the calendar:', error)
    return failed('Calendar notes could not be loaded.')
  }
}

// --- Texts sent ------------------------------------------------------------

type OutboundMessageRow = {
  created_at: string | null
  template_key: string | null
  status: string | null
  /** Set when a text was held through quiet hours and handed to Twilio to send the next morning. */
  scheduled_for: string | null
}

const PROMOTIONAL_KEYS = new Set<string>(PROMOTIONAL_SMS_TEMPLATE_KEYS)
const FAILED_MESSAGE_STATUSES = new Set(['failed', 'undelivered'])
/** Rows for texts that have not gone (yet, or ever): not "sent". */
const UNSENT_MESSAGE_STATUSES = new Set(['scheduled', 'queued', 'accepted', 'cancelled', 'canceled'])
/** Quiet hours hold a text overnight at most, so a day's lead covers one recorded the evening before. */
const DEFERRAL_LEAD_MS = 24 * 60 * 60 * 1000

/**
 * Outbound texts in the window, counted per London day: how many, how many promotional (the keys
 * that count towards a guest's monthly limit), and how many failed. Only counts leave the server;
 * no message body, number or name is read. `messages` is read with the admin client after the
 * caller's messages:view check, as the Messages page does.
 */
export async function readTextMessagesByDate(
  adminClient: SupabaseClient,
  startInstant: string,
  endInstant: string,
): Promise<CalendarDataset<TextMessageDay>> {
  let rows: OutboundMessageRow[]
  try {
    rows = await fetchAllRows<OutboundMessageRow>(
      (from, to) =>
        adminClient
          .from('messages')
          .select('created_at, template_key, status, scheduled_for:metadata->>scheduled_for')
          .eq('direction', 'outbound')
          .gte('created_at', new Date(new Date(startInstant).getTime() - DEFERRAL_LEAD_MS).toISOString())
          .lt('created_at', endInstant)
          .order('id')
          .range(from, to),
      { label: 'calendar texts sent' },
    )
  } catch (error) {
    console.error('Failed to load texts for the calendar:', error)
    return failed('Texts sent could not be loaded.')
  }

  const windowStart = new Date(startInstant).getTime()
  const windowEnd = new Date(endInstant).getTime()
  const byDate = new Map<string, TextMessageDay>()
  for (const row of rows) {
    // A text still scheduled, queued or cancelled has not been sent.
    if (row.status && UNSENT_MESSAGE_STATUSES.has(row.status)) continue
    // A text held through quiet hours went out when it was scheduled for, not when it was recorded.
    const sentAt = row.scheduled_for || row.created_at
    if (!sentAt) continue
    const instant = new Date(sentAt)
    if (Number.isNaN(instant.getTime())) continue
    if (instant.getTime() < windowStart || instant.getTime() >= windowEnd) continue
    const date = toLondonIsoDate(instant)
    const day = byDate.get(date) ?? { date, total: 0, promotional: 0, service: 0, failed: 0 }
    day.total += 1
    if (row.template_key && PROMOTIONAL_KEYS.has(row.template_key)) day.promotional += 1
    else day.service += 1
    if (row.status && FAILED_MESSAGE_STATUSES.has(row.status)) day.failed += 1
    byDate.set(date, day)
  }
  return ok([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)))
}
