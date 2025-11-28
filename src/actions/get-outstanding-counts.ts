'use server'

import { createClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export type OutstandingCounts = {
  menu_management: number
  private_bookings: number
  parking: number
  cashing_up: number
  invoices: number
  receipts: number
}

export async function getOutstandingCounts(): Promise<OutstandingCounts> {
  const supabase = await createClient()

  const queries = [
    // Menu Management: Use RPC
    supabase.rpc('get_menu_outstanding_count'),

    // Private Bookings: Drafts
    supabase
      .from('private_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'draft'),

    // Parking: Unpaid
    supabase
      .from('parking_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending_payment'),

    // Invoices: Outstanding (draft, sent, overdue, partially_paid)
    supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .in('status', ['draft', 'sent', 'overdue', 'partially_paid'])
      .is('deleted_at', null),

    // Receipts: Pending
    supabase
      .from('receipt_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Cashing Up: Draft sessions
    supabase
      .from('cashup_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'draft'),
      
    // Cashing Up: Check last 7 days for missing sessions
    supabase
      .from('cashup_sessions')
      .select('session_date')
      .gte('session_date', format(subDays(new Date(), 7), 'yyyy-MM-dd'))
      .lte('session_date', format(subDays(new Date(), 1), 'yyyy-MM-dd'))
  ]

  const results = await Promise.all(queries)

  // RPC result
  const menuCount = typeof results[0].data === 'number' ? results[0].data : 0
  
  const privateBookingsCount = results[1].count ?? 0
  const parkingCount = results[2].count ?? 0
  const invoicesCount = results[3].count ?? 0
  const receiptsCount = results[4].count ?? 0
  const cashingUpDrafts = results[5].count ?? 0
  
  // Calculate missing cashing up days
  const existingSessions = (results[6].data as { session_date: string }[] | null) ?? []
  const existingDates = new Set(existingSessions.map((s: any) => s.session_date))
  
  let missingDaysCount = 0
  for (let i = 1; i <= 7; i++) {
    const dateStr = format(subDays(new Date(), i), 'yyyy-MM-dd')
    if (!existingDates.has(dateStr)) {
      missingDaysCount++
    }
  }

  return {
    menu_management: menuCount,
    private_bookings: privateBookingsCount,
    parking: parkingCount,
    cashing_up: cashingUpDrafts + missingDaysCount,
    invoices: invoicesCount,
    receipts: receiptsCount
  }
}