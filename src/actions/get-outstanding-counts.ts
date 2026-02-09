'use server'

import { createClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { buildEventChecklist, type EventChecklistStatusRecord } from '@/lib/event-checklist'

export type OutstandingCounts = {
  events: number
  menu_management: number
  table_bookings: number
  private_bookings: number
  parking: number
  cashing_up: number
  invoices: number
  receipts: number
}

export async function getOutstandingCounts(): Promise<OutstandingCounts> {
  const supabase = await createClient()
  const todayIso = getTodayIsoDate()

  const [
    eventsResult,
    menuResult,
    privateBookingDraftsResult,
    privateBookingPendingSmsResult,
    parkingPendingPaymentsResult,
    invoicesOutstandingResult,
    receiptsPendingResult,
    cashingUpDraftsResult,
    cashingUpRecentSessionsResult,
    tableBookingsPendingResult,
    tableBookingPendingChargeRequestsResult
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

    // Parking: pending payment actions (aligned with Parking dashboard)
    supabase
      .from('parking_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('payment_status', 'pending'),

    // Invoices: outstanding items (same unpaid model as invoices workspace)
    supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .in('status', ['draft', 'sent', 'overdue', 'partially_paid'])
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

    // Table Bookings: unresolved booking states
    (supabase.from('table_bookings') as any)
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending_payment', 'pending_card_capture']),

    // Table Bookings: manager approvals still pending for charge requests
    (supabase.from('charge_requests') as any)
      .select('*', { count: 'exact', head: true })
      .eq('charge_status', 'pending')
      .is('manager_decision', null)
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
  const parkingCount = parkingPendingPaymentsResult.count ?? 0
  const invoicesCount = invoicesOutstandingResult.count ?? 0
  const receiptsCount = receiptsPendingResult.count ?? 0
  const cashingUpDrafts = cashingUpDraftsResult.count ?? 0
  const tableBookingsCount =
    (tableBookingsPendingResult.count ?? 0) + (tableBookingPendingChargeRequestsResult.count ?? 0)

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
    table_bookings: tableBookingsCount,
    private_bookings: privateBookingsCount,
    parking: parkingCount,
    cashing_up: cashingUpDrafts + missingDaysCount,
    invoices: invoicesCount,
    receipts: receiptsCount
  }
}
