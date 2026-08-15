'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { format, subDays } from 'date-fns'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { currentBusinessDate } from '@/lib/checklists/settings'
import { buildEventChecklist, type EventChecklistStatusRecord } from '@/lib/event-checklist'

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
}

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

export async function getOutstandingCounts(): Promise<OutstandingCounts> {
  const supabase = await createClient()

  // Two of the tables below are readable only by the service role, so they need
  // the admin client. That bypasses RLS, so establish there is a signed-in user
  // first and return zeros otherwise. Every caller is authenticated staff chrome.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return EMPTY_COUNTS

  // `checklist_task_instances` has a service_role-only policy and
  // `review_feedback` has RLS on with no policies at all, so both return zero
  // rows through the cookie client. Counting them with `supabase` would have
  // shown a permanently empty badge rather than an error.
  const admin = createAdminClient()
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
    feedbackOpenResult
  ] = await Promise.all([
    // Events: upcoming events used for checklist todo count
    supabase
      .from('events')
      .select('id, name, date')
      .gte('date', todayIso),

    // Menu Management
    supabase.rpc('get_menu_outstanding_count'),

    // Private Bookings: draft bookings
    supabase
      .from('private_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'draft'),

    // Private Bookings: pending SMS approvals
    supabase
      .from('private_booking_sms_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Invoices: only the ones needing staff work. `sent` and `partially_paid`
    // are waiting on the customer to pay, so counting them meant the pill could
    // never reach zero. Drafts need finishing and sending; overdue need chasing.
    supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .in('status', ['draft', 'overdue'])
      .is('deleted_at', null),

    // Receipts: pending
    supabase
      .from('receipt_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Cashing Up: draft sessions
    supabase
      .from('cashup_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'draft'),

    // Cashing Up: last 7 days coverage
    supabase
      .from('cashup_sessions')
      .select('session_date')
      .gte('session_date', format(subDays(new Date(), 7), 'yyyy-MM-dd'))
      .lte('session_date', format(subDays(new Date(), 1), 'yyyy-MM-dd')),

    // Rota: leave requests waiting on a manager decision
    supabase.from('leave_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Checklists: tasks still open and already due. Anything already recorded
    // as `missed` is excluded: that outcome is settled and cannot be worked off.
    admin.from('checklist_task_instances')
      .select('*', { count: 'exact', head: true })
      .eq('state', 'pending')
      .is('completed_at', null)
      .lte('business_date', checklistBusinessDate),

    // Feedback: the inbox's own open states, matching OPEN_STATUSES in
    // src/app/actions/feedback.ts
    admin.from('review_feedback')
      .select('*', { count: 'exact', head: true })
      .in('status', ['new', 'in_progress'])
  ])

  let eventsCount = 0
  const events = eventsResult.data ?? []
  if (events.length > 0) {
    const eventIds = events.map((event) => event.id)
    const checklistStatusesResult = await supabase
      .from('event_checklist_statuses')
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
    feedback: feedbackCount
  }
}
