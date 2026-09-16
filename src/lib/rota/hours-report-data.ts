/**
 * The five reads behind the rota hours report.
 *
 * The screen at /rota/hours and the PDF at /api/rota/hours/pdf each ran their own
 * copy of the same five queries, so a fix to one could miss the other and leave the
 * printed sheet disagreeing with the screen about hours the pub pays against.
 *
 * Two of those reads have outgrown a single request. Supabase returns at most 1,000
 * rows and says nothing when it cuts a result short, and the screen lets anyone type
 * any From and To date, so a long range silently lost the newest weeks: the rows come
 * back oldest first, so the hours that vanished were the recent ones. Both big reads
 * now page through the whole set and fail loudly rather than return a partial answer.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paged-read'

export type EmployeeRow = {
  employee_id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  job_title: string | null
  status: string | null
}

export type SessionRow = {
  id: string
  employee_id: string
  work_date: string
  clock_in_at: string
  clock_out_at: string | null
}

export type LeaveDayRow = {
  employee_id: string
  leave_date: string
  request_id: string
}

export type SickShiftRow = {
  id: string
  employee_id: string
  shift_date: string
  sick_reason: string | null
}

export type PlannedShiftRow = {
  id: string
  employee_id: string
  shift_date: string
  start_time: string
  end_time: string
  unpaid_break_minutes: number
  is_overnight: boolean
}

export type HoursReportRange = {
  /** First date in the report, inclusive, as yyyy-MM-dd in London. */
  fromDate: string
  /** Last date in the report, inclusive, as yyyy-MM-dd in London. */
  toDate: string
  /** Today in London. Shifts after it count as planned rather than worked. */
  today: string
}

export type HoursReportData = {
  employees: EmployeeRow[]
  sessions: SessionRow[]
  leaveDays: LeaveDayRow[]
  sickShifts: SickShiftRow[]
  plannedShifts: PlannedShiftRow[]
}

// The admin client is built without database generics, so its schema type is `any`
// upstream; mirroring that here keeps both call sites free of casts.
type HoursReportClient = SupabaseClient<any, 'public', any>

type ReadResult<T> = { data: T[] | null; error: { message: string } | null }

/** Reads that comfortably fit one request still fail loudly rather than count zero. */
async function readAll<T>(query: PromiseLike<ReadResult<T>>, label: string): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(`${label} failed: ${error.message}`)
  return data ?? []
}

export async function loadHoursReportData(
  supabase: HoursReportClient,
  { fromDate, toDate, today }: HoursReportRange,
): Promise<HoursReportData> {
  const [employees, sessions, leaveDays, sickShifts, plannedShifts] = await Promise.all([
    readAll<EmployeeRow>(
      supabase
        .from('employees')
        .select('employee_id, first_name, last_name, preferred_name, job_title, status')
        .order('first_name')
        .order('last_name'),
      'hours report employees',
    ),
    // Paged: 1,398 rows today and growing by about 75 a month, so a range of a year
    // or more runs past the 1,000 row ceiling. `id` is the unique tiebreak that keeps
    // the page boundaries stable when several sessions share a clock-in time.
    fetchAllRows<SessionRow>(
      (from, to) =>
        supabase
          .from('timeclock_sessions')
          .select('id, employee_id, work_date, clock_in_at, clock_out_at')
          .gte('work_date', fromDate)
          .lte('work_date', toDate)
          .order('work_date')
          .order('clock_in_at')
          .order('id')
          .range(from, to),
      { label: 'hours report timeclock sessions' },
    ),
    // Paged for the same reason: 693 approved days today, about 138 more a quarter.
    fetchAllRows<LeaveDayRow>(
      (from, to) =>
        supabase
          .from('leave_days')
          .select('employee_id, leave_date, request_id, leave_requests!inner(status)')
          .gte('leave_date', fromDate)
          .lte('leave_date', toDate)
          .eq('leave_requests.status', 'approved')
          .order('leave_date')
          .order('id')
          .range(from, to),
      { label: 'hours report leave days' },
    ),
    readAll<SickShiftRow>(
      supabase
        .from('rota_shifts')
        .select('id, employee_id, shift_date, sick_reason')
        .gte('shift_date', fromDate)
        .lte('shift_date', toDate)
        .eq('status', 'sick')
        .not('employee_id', 'is', null)
        .order('shift_date'),
      'hours report sick shifts',
    ),
    readAll<PlannedShiftRow>(
      supabase
        .from('rota_shifts')
        .select('id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, is_overnight')
        .gte('shift_date', fromDate)
        .lte('shift_date', toDate)
        .gt('shift_date', today)
        .eq('status', 'scheduled')
        .eq('is_open_shift', false)
        .not('employee_id', 'is', null)
        .order('shift_date')
        .order('start_time'),
      'hours report planned shifts',
    ),
  ])

  return { employees, sessions, leaveDays, sickShifts, plannedShifts }
}
