'use server'

import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { format, subDays } from 'date-fns'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { currentBusinessDate } from '@/lib/checklists/settings'
import { buildEventChecklist, type EventChecklistStatusRecord } from '@/lib/event-checklist'
import { maintenanceDueSoonCutoff } from '@/lib/maintenance/counts'
import { MAINTENANCE_OPEN_STATUSES } from '@/types/maintenance'

/**
 * Every field here is a count of work a staff member can clear themselves. A
 * nav pill is a to-do list, so anything that only clears when a customer pays,
 * replies, or lets a hold expire must stay out: those pills can never reach
 * zero however much work gets done, and a pill that never clears teaches people
 * to ignore all of them.
 *
 * Deliberately absent:
 * - parking. Every parking queue is "waiting on the guest to pay", which
 *   resolves itself to paid or expired. There is no staff action.
 * - table bookings. The only queue there was charge requests awaiting a manager
 *   decision, and charge requests were withdrawn entirely (nothing raises them
 *   and none could ever be charged).
 */
export type OutstandingCounts = {
  events: number
  menu_management: number
  private_bookings: number
  cashing_up: number
  invoices: number
  receipts: number
  rota: number
  checklists: number
  feedback: number
  /**
   * Maintenance is the one count that is not for everyone, so it is the one
   * count with three states rather than two:
   *
   * - key absent: the caller is not a super-admin. The number is stripped before
   *   the response is built, so it is not merely hidden in the UI, it never
   *   leaves the server. Every other field here is safe to send to any signed-in
   *   member of staff; this one is not.
   * - null: the read failed. Render that as unavailable. Zero would be a lie,
   *   because zero means "nothing outstanding".
   * - a number: open items overdue or due within seven days.
   */
  maintenance?: number | null
}

/**
 * `maintenance` is deliberately absent, not zero. Nobody signed out may see it,
 * and an absent key is the only truthful way to say that.
 */
const EMPTY_COUNTS: OutstandingCounts = {
  events: 0,
  menu_management: 0,
  private_bookings: 0,
  cashing_up: 0,
  invoices: 0,
  receipts: 0,
  rota: 0,
  checklists: 0,
  feedback: 0,
}

/**
 * What the shared cache holds. The maintenance number itself is the same for
 * everybody, so it is computed once inside the cache; only permission to see it
 * varies per user, and that is applied outside.
 */
type CachedOutstandingCounts = OutstandingCounts & { maintenance: number | null }

/**
 * Every count here is read with the admin client, not the cookie client.
 *
 * Three of these tables are unreadable by the `authenticated` role:
 * `checklist_task_instances` has a service_role-only policy, `review_feedback`
 * has RLS on with no policies at all, and `receipt_transactions` has only a
 * `auth.role() = 'service_role'` policy. Counting any of them through the cookie
 * client returns 0 rather than an error, so the badge just sits at zero and looks
 * like there is no work to do. That is exactly what had happened to Receipts: the
 * pill read 0 while 76 receipts sat pending.
 *
 * Reading them all as the service role is safe because a badge is only ever
 * rendered on a nav item the user can already see. `filterNavGroupsForPermissions`
 * in src/ds/shell/SidebarNav.tsx drops any item whose `permission` the user lacks,
 * and the badge goes with it, so a global count is never shown to someone without
 * access to the page behind it.
 *
 * That reasoning does NOT extend to maintenance. Maintenance has no RBAC module
 * on purpose (user_has_permission returns true for a super-admin on any module
 * name, so it can only express a floor), so nav filtering cannot gate it and the
 * argument above does not apply. Its number is computed here because it is the
 * same for everybody, and then stripped per user in getOutstandingCounts, well
 * outside this cache. Nothing user-specific may be computed in here: this entry
 * is global and is served to every member of staff.
 *
 * Kept free of cookies and headers on purpose so the whole thing can be cached.
 */
async function computeOutstandingCounts(): Promise<CachedOutstandingCounts> {
  const db = createAdminClient()
  // Two different "todays" on purpose. Events and event todos use the plain
  // London calendar date. Pub checklists use the business date, which does not
  // roll over until 05:00, so the badge keeps counting last night's open closing
  // tasks while they are still completable.
  const todayIso = getTodayIsoDate()
  const checklistBusinessDate = await currentBusinessDate()

  const [
    eventsResult,
    menuResult,
    privateBookingDraftsResult,
    privateBookingPendingSmsResult,
    invoicesOutstandingResult,
    receiptsPendingResult,
    cashingUpDraftsResult,
    cashingUpRecentSessionsResult,
    leaveRequestsPendingResult,
    checklistTasksOpenResult,
    feedbackOpenResult,
    maintenanceDueResult
  ] = await Promise.all([
    // Events: upcoming events used for checklist todo count
    db.from('events')
      .select('id, name, date')
      .gte('date', todayIso),

    // Menu Management
    db.rpc('get_menu_outstanding_count'),

    // Private Bookings: draft bookings
    db.from('private_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft'),

    // Private Bookings: pending SMS approvals
    db.from('private_booking_sms_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Invoices: only the ones needing staff work. `sent` and `partially_paid`
    // are waiting on the customer to pay, so counting them meant the pill could
    // never reach zero. Drafts need finishing and sending; overdue need chasing.
    db.from('invoices')
      .select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'overdue'])
      .is('deleted_at', null),

    // Receipts: pending
    db.from('receipt_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Cashing Up: draft sessions
    db.from('cashup_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft'),

    // Cashing Up: last 7 days coverage
    db.from('cashup_sessions')
      .select('session_date')
      .gte('session_date', format(subDays(new Date(), 7), 'yyyy-MM-dd'))
      .lte('session_date', format(subDays(new Date(), 1), 'yyyy-MM-dd')),

    // Rota: leave requests waiting on a manager decision
    db.from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Checklists: tasks still open and already due. Anything already recorded
    // as `missed` is excluded: that outcome is settled and cannot be worked off.
    db.from('checklist_task_instances')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'pending')
      .is('completed_at', null)
      .lte('business_date', checklistBusinessDate),

    // Feedback: the inbox's own open states, matching OPEN_STATUSES in
    // src/app/actions/feedback.ts
    db.from('review_feedback')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'in_progress']),

    // Maintenance: open items already overdue or falling due within seven days.
    // One comparison covers both, because overdue is simply a target date on the
    // wrong side of today. An item with no target date is excluded, and a null
    // target_date never satisfies lte, so nothing extra is needed to exclude it.
    // Kept equivalent to countsTowardsMaintenanceBadge in @/lib/maintenance/counts.
    db.from('maintenance_items')
      .select('id', { count: 'exact', head: true })
      .in('status', [...MAINTENANCE_OPEN_STATUSES])
      .lte('target_date', maintenanceDueSoonCutoff(todayIso))
  ])

  let eventsCount = 0
  const events = eventsResult.data ?? []
  if (events.length > 0) {
    const eventIds = events.map((event) => event.id)
    const checklistStatusesResult = await db.from('event_checklist_statuses')
      .select('event_id, task_key, completed_at')
      .in('event_id', eventIds)

    const statusesByEvent = new Map<string, EventChecklistStatusRecord[]>()
    ;(checklistStatusesResult.data ?? []).forEach((status) => {
      const existing = statusesByEvent.get(status.event_id) ?? []
      existing.push({
        event_id: status.event_id,
        task_key: status.task_key,
        completed_at: status.completed_at
      })
      statusesByEvent.set(status.event_id, existing)
    })

    eventsCount = events.reduce((total, event) => {
      const checklist = buildEventChecklist(
        { id: event.id, name: event.name, date: event.date },
        statusesByEvent.get(event.id) ?? [],
        todayIso
      )
      const attentionTodos = checklist.filter(
        (item) => !item.completed && (item.status === 'overdue' || item.status === 'due_today')
      )
      return total + attentionTodos.length
    }, 0)
  }

  // RPC result
  const menuCount = typeof menuResult.data === 'number' ? menuResult.data : 0

  const privateBookingsCount =
    (privateBookingDraftsResult.count ?? 0) + (privateBookingPendingSmsResult.count ?? 0)
  const invoicesCount = invoicesOutstandingResult.count ?? 0
  const receiptsCount = receiptsPendingResult.count ?? 0
  const cashingUpDrafts = cashingUpDraftsResult.count ?? 0
  const rotaCount = leaveRequestsPendingResult.count ?? 0
  const checklistsCount = checklistTasksOpenResult.count ?? 0
  const feedbackCount = feedbackOpenResult.count ?? 0

  // The only count that may come back null. `?? 0` here would report "nothing
  // outstanding" whenever the table could not be read, which is the exact failure
  // that left the Receipts pill sitting on zero with 76 receipts pending.
  const maintenanceCount = maintenanceDueResult.error ? null : maintenanceDueResult.count ?? 0

  // Calculate missing cashing up days
  const existingSessions = (cashingUpRecentSessionsResult.data as { session_date: string }[] | null) ?? []
  const existingDates = new Set(existingSessions.map((s: any) => s.session_date))
  
  let missingDaysCount = 0
  for (let i = 1; i <= 7; i++) {
    const dateStr = format(subDays(new Date(), i), 'yyyy-MM-dd')
    if (!existingDates.has(dateStr)) {
      missingDaysCount++
    }
  }

  return {
    events: eventsCount,
    menu_management: menuCount,
    private_bookings: privateBookingsCount,
    cashing_up: cashingUpDrafts + missingDaysCount,
    invoices: invoicesCount,
    receipts: receiptsCount,
    rota: rotaCount,
    checklists: checklistsCount,
    feedback: feedbackCount,
    maintenance: maintenanceCount
  }
}

/**
 * Every open tab polls /api/outstanding-counts once a minute, and each poll used to
 * run twelve uncached queries. On production that had reached roughly 740,000 calls
 * per counter, around nine million queries in total, which was the single largest
 * consumer of database time. The queries themselves are cheap; the volume is what
 * saturated the server and inflated everything else running alongside it.
 *
 * The counts are identical for every member of staff, so one cache entry serves all of
 * them and concurrent tabs collapse onto a single computation.
 *
 * The TTL must be LONGER than the client's poll interval, not shorter. useOutstandingCounts
 * polls every 60 seconds, so a 30 second TTL expired between every poll and a lone tab
 * missed the cache every single time, buying nothing. Measured on production: 0.94
 * computations per minute from one tab, exactly the uncached rate. At 90 seconds a tab's
 * consecutive polls land inside one window often enough to matter, and several tabs
 * almost always share.
 *
 * Staleness is bounded well below that in practice: every mutation path already fans out
 * revalidateTag('dashboard') from 25 action files, which clears this entry too, so a badge
 * updates immediately when someone clears the work. The TTL only governs how quickly a
 * badge notices work created by a cron or by another person's session, where 90 seconds
 * on a to-do count is unnoticeable.
 */
const getCachedOutstandingCounts = unstable_cache(
  computeOutstandingCounts,
  ['outstanding-counts'],
  { revalidate: 90, tags: ['dashboard', 'outstanding-counts'] }
)

/**
 * Whether this user may be told the maintenance number.
 *
 * The predicate is public.is_super_admin, the same one the maintenance RLS
 * policies and server actions use, so the badge and the pages can never disagree
 * about who has access. It is called with the user id already in hand rather than
 * through currentUserCanUseMaintenance(), which would re-resolve the session and
 * add a second auth round trip to an endpoint every open tab polls once a minute.
 *
 * Fails closed. An unverifiable role is not a permitted one, so the count is
 * stripped rather than sent on the hope that it was fine.
 */
async function callerMaySeeMaintenance(userId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc('is_super_admin', {
      check_user_id: userId,
    })
    if (error) return false
    return data === true
  } catch {
    return false
  }
}

export async function getOutstandingCounts(): Promise<OutstandingCounts> {
  // The auth gate stays outside the cache: it reads cookies, which unstable_cache
  // forbids, and it must run per request rather than once per cache window.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return EMPTY_COUNTS

  const counts = await getCachedOutstandingCounts()

  // Per-user filtering happens here, never inside the cache. One cache entry is
  // shared by every member of staff, so anything filtered in there would be
  // served to whoever happened to warm it next.
  if (await callerMaySeeMaintenance(user.id)) {
    return counts
  }

  const withoutMaintenance: OutstandingCounts = { ...counts }
  // Deleted rather than zeroed or hidden: a user without access must not receive
  // the number in the payload at all.
  delete withoutMaintenance.maintenance
  return withoutMaintenance
}
