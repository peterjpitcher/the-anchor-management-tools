'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  calendarRange,
  readBalanceDues,
  readBirthdays,
  readCoversByDate,
  readMarketingSends,
  readSpecialHours,
  readStaffByDate,
  denied,
  ok,
  type CalendarBalanceDue,
  type CalendarBirthday,
  type CalendarDailyOps,
  type CalendarDataset,
  type CalendarMarketingSend,
  type CalendarSpecialHours,
} from '@/lib/calendar/datasets'

/**
 * Gated entry points for the shared calendar datasets.
 *
 * Each one resolves the user's capability and then calls the pure reader in
 * src/lib/calendar/datasets.ts. The dashboard calls those readers directly,
 * because its snapshot runs inside `unstable_cache` and cannot read cookies.
 *
 * A refusal returns `status: 'denied'` rather than an error, so the calendar
 * quietly renders without that layer instead of breaking. A query failure
 * returns `status: 'failed'` with a message, so an outage never looks like an
 * empty diary.
 */

export async function fetchCalendarSpecialHours(): Promise<CalendarDataset<CalendarSpecialHours>> {
  // Same bar as viewing the calendar itself. Deliberately NOT getSpecialHours(),
  // which is gated on settings:manage and would show opening-hours changes to
  // super_admin only.
  const [canViewEvents, canManageSettings] = await Promise.all([
    checkUserPermission('events', 'view'),
    checkUserPermission('settings', 'manage'),
  ])
  if (!canViewEvents && !canManageSettings) return denied()

  const supabase = await createClient()
  const { startIso, endIso } = calendarRange()
  return readSpecialHours(supabase, startIso, endIso)
}

export async function fetchCalendarBirthdays(): Promise<CalendarDataset<CalendarBirthday>> {
  if (!(await checkUserPermission('employees', 'view'))) return denied()

  const supabase = await createClient()
  const { startIso, endIso } = calendarRange()
  return readBirthdays(supabase, startIso, endIso)
}

export async function fetchCalendarBalanceDues(): Promise<CalendarDataset<CalendarBalanceDue>> {
  // Two permissions, not one. The balance marker's subtitle IS the amount, and
  // the staff role holds private_bookings:view without view_pricing, so gating
  // on view alone put private-hire totals in front of staff.
  const [canView, canViewPricing] = await Promise.all([
    checkUserPermission('private_bookings', 'view'),
    checkUserPermission('private_bookings', 'view_pricing'),
  ])
  if (!canView || !canViewPricing) return denied()

  const supabase = await createClient()
  const { startIso, endIso } = calendarRange()
  return readBalanceDues(supabase, startIso, endIso)
}

/**
 * Marketing email sends.
 *
 * The admin client is deliberate, not a shortcut: `marketing_campaigns` is
 * service-role only, so a session client reads nothing at all. The permission
 * check above it is therefore the only gate, which is why it is the first thing
 * that happens here.
 */
export async function fetchCalendarMarketingSends(): Promise<
  CalendarDataset<CalendarMarketingSend>
> {
  if (!(await checkUserPermission('marketing', 'view'))) return denied()

  const { startIso, endIso } = calendarRange()
  return readMarketingSends(createAdminClient(), startIso, endIso)
}

/**
 * Covers and who is working.
 *
 * The two halves are gated independently, because they come from different
 * modules and the staff role holds no rota permission at all. A user with covers
 * access and no rota access gets covers and no names, rather than nothing.
 */
export async function fetchCalendarDailyOps(): Promise<CalendarDataset<CalendarDailyOps>> {
  const [canViewCovers, canViewRota] = await Promise.all([
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('rota', 'view'),
  ])
  if (!canViewCovers && !canViewRota) return denied()

  const supabase = await createClient()
  const { startIso, endIso } = calendarRange()

  const [covers, staff] = await Promise.all([
    canViewCovers ? readCoversByDate(supabase, startIso, endIso) : Promise.resolve(denied()),
    canViewRota ? readStaffByDate(supabase, startIso, endIso) : Promise.resolve(denied()),
  ])

  const coversByDate: Record<string, number> = {}
  if (covers.status === 'ok') {
    for (const row of covers.data) coversByDate[row.date] = row.covers
  }

  const staffByDate: Record<string, string[]> = {}
  if (staff.status === 'ok') {
    for (const row of staff.data) staffByDate[row.date] = row.staff
  }

  return ok([{ coversByDate, staffByDate }])
}
