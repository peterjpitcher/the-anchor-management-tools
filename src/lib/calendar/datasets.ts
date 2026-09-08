import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { displayName } from '@/lib/employees/display-name'
import { getLocalIsoDateDaysAgo, getLocalIsoDateDaysAhead } from '@/lib/dateUtils'
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
 * in Next 15, so it cannot call a session-gated server action. The gated action
 * wrappers live in src/app/actions/calendar-datasets.ts and call into here, and
 * the dashboard calls into here directly. One implementation, two entry points,
 * so the two pages cannot drift apart again.
 */

/** The window both calendars load. Notes are deliberately not date-bounded. */
export const CALENDAR_LOOKBACK_DAYS = 90
export const CALENDAR_HORIZON_DAYS = 180

export function calendarRange(): { startIso: string; endIso: string } {
  return {
    startIso: getLocalIsoDateDaysAgo(CALENDAR_LOOKBACK_DAYS),
    endIso: getLocalIsoDateDaysAhead(CALENDAR_HORIZON_DAYS),
  }
}

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
  // Same view, same filters and same ordering the dashboard already uses, so the
  // two surfaces cannot disagree about a money figure.
  const { data, error } = await client
    .from('private_bookings_with_details')
    .select(
      'id, customer_name, customer_first_name, customer_last_name, balance_due_date, event_date, status, total_amount, calculated_total, gross_total, final_payment_date',
    )
    .in('status', ['confirmed'])
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
  return ok(buildPrivateBookingBalanceDueSummaries(data ?? [], payments))
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
  coversByDate: Record<string, number>
  staffByDate: Record<string, string[]>
}

export async function readCoversByDate(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<CalendarDataset<{ date: string; covers: number }>> {
  const { data, error } = await client
    .from('table_bookings')
    .select('booking_date, party_size')
    .not('status', 'in', '(cancelled,no_show)')
    .gte('booking_date', startIso)
    .lte('booking_date', endIso)

  if (error) {
    console.error('Failed to load covers for the calendar:', error)
    return failed('Covers could not be loaded.')
  }

  const byDate = new Map<string, number>()
  for (const row of data ?? []) {
    const date = (row as { booking_date?: string | null }).booking_date
    if (!date) continue
    const partySize = Number((row as { party_size?: unknown }).party_size ?? 0)
    if (!Number.isFinite(partySize)) continue
    byDate.set(date, (byDate.get(date) ?? 0) + partySize)
  }

  return ok([...byDate.entries()].map(([date, covers]) => ({ date, covers })))
}

export async function readStaffByDate(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<CalendarDataset<{ date: string; staff: string[] }>> {
  const { data: shiftRows, error } = await client
    .from('rota_shifts')
    .select('employee_id, shift_date, start_time')
    .gte('shift_date', startIso)
    .lte('shift_date', endIso)
    .range(0, 4999)

  if (error) {
    console.error('Failed to load rota shifts for the calendar:', error)
    return failed('Who is working could not be loaded.')
  }

  const employeeIds = [...new Set((shiftRows ?? []).map((s) => String(s.employee_id)))]
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
  for (const shift of shiftRows ?? []) {
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
