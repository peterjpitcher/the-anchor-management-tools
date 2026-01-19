'use server'

import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PrivateBookingService } from '@/services/private-bookings'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { startOfWeek, subWeeks, format, addDays, differenceInCalendarDays } from 'date-fns'

type EventSummary = {
  id: string
  name: string
  date: string | null
  time: string | null
}

type EventsSnapshot = {
  permitted: boolean
  today: EventSummary[]
  upcoming: EventSummary[]
  totalUpcoming: number
  nextUpcoming?: EventSummary
  error?: string
}

type CustomersSnapshot = {
  permitted: boolean
  total: number
  newThisWeek: number
  newThisMonth: number
  newLastMonth: number
  error?: string
}

type MessagesSnapshot = {
  permitted: boolean
  unread: number
  error?: string
}

type PrivateBookingSummary = {
  id: string
  customer_name: string | null
  event_date: string | null
  start_time: string | null
  status: string | null
  customer_id: string | null
  hold_expiry: string | null
  deposit_status: 'Paid' | 'Required' | 'Not Required' | null
  balance_due_date: string | null
  days_until_event: number | null
}

type PrivateBookingsSnapshot = {
  permitted: boolean
  upcoming: PrivateBookingSummary[]
  totalUpcoming: number
  error?: string
}

type ParkingBookingSummary = {
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

type ParkingSnapshot = {
  permitted: boolean
  upcoming: ParkingBookingSummary[]
  totalUpcoming: number
  arrivalsToday: number
  pendingPayments: number
  nextBooking?: ParkingBookingSummary
  error?: string
}

type InvoiceVendor = {
  name: string | null
}

type InvoiceSummary = {
  id: string
  invoice_number: string | null
  total_amount: number | null
  status: string | null
  due_date: string | null
  vendor: InvoiceVendor[] | InvoiceVendor | null
}

type InvoicesSnapshot = {
  permitted: boolean
  unpaid: InvoiceSummary[]
  unpaidCount: number
  overdueCount: number
  totalUnpaidValue: number
  overdue: InvoiceSummary[]
  dueToday: InvoiceSummary[]
  error?: string
}

type EmployeesSnapshot = {
  permitted: boolean
  activeCount: number
  error?: string
}

type ReceiptsSnapshot = {
  permitted: boolean
  pendingCount: number
  cantFindCount: number
  needsAttention: number
  lastImportAt: string | null
  openAiCost: number | null
  error?: string
}

type QuotesSnapshot = {
  permitted: boolean
  totalPendingValue: number
  totalExpiredValue: number
  totalAcceptedValue: number
  draftCount: number
  error?: string
}

type RolesSnapshot = {
  permitted: boolean
  totalRoles: number
  error?: string
}

type ShortLinksSnapshot = {
  permitted: boolean
  activeCount: number
  error?: string
}

type UsersSnapshot = {
  permitted: boolean
  totalUsers: number
  error?: string
}

type LoyaltySnapshot = {
  permitted: boolean
}

type CashingUpSnapshot = {
  permitted: boolean
  thisWeekTotal: number
  thisWeekTarget: number
  lastWeekTotal: number
  lastYearTotal: number
  sessionsSubmittedCount: number
  completedThrough: string | null
  error?: string
}

type SystemHealthSnapshot = {
  permitted: boolean
  smsFailures24h: number
  failedCronJobs24h: number
  error?: string
}

type ProfileSnapshot = {
  permitted: boolean
  email: string | null
  lastSignInAt: string | null
}

export type DashboardSnapshot = {
  generatedAt: string
  user: ProfileSnapshot
  events: EventsSnapshot
  customers: CustomersSnapshot
  messages: MessagesSnapshot
  privateBookings: PrivateBookingsSnapshot
  parking: ParkingSnapshot
  invoices: InvoicesSnapshot
  employees: EmployeesSnapshot
  receipts: ReceiptsSnapshot
  quotes: QuotesSnapshot
  roles: RolesSnapshot
  shortLinks: ShortLinksSnapshot
  users: UsersSnapshot
  loyalty: LoyaltySnapshot
  cashingUp: CashingUpSnapshot
  systemHealth: SystemHealthSnapshot
}

type PermissionRecord = {
  module_name: string
  action: string
}

const VIEW_ACTIONS = new Set([
  'view',
  'manage',
  'edit',
  'create',
  'delete',
  'export',
  'send',
  'convert',
])

function hasModuleAccess(permissions: Map<string, Set<string>>, module: string) {
  const actions = permissions.get(module)
  if (!actions || actions.size === 0) {
    return false
  }

  for (const action of actions) {
    if (
      VIEW_ACTIONS.has(action) ||
      action.startsWith('view_') ||
      action.startsWith('manage')
    ) {
      return true
    }
  }

  return false
}

const fetchDashboardSnapshot = unstable_cache(
  async (userId: string): Promise<DashboardSnapshot> => {
    const supabase = await createAdminClient()
    const { data: userResult, error: userLookupError } = await supabase.auth.admin.getUserById(userId)

    const user = userResult?.user ?? null

    if (userLookupError || !user) {
      throw new Error('Not authenticated')
    }

    const todayIso = getTodayIsoDate()
    const nowIso = new Date().toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    
    // Calculate month ranges
    const now = new Date()
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).toISOString() // Last day of previous month

    const permissionsMap = new Map<string, Set<string>>()
    const { data: permissionsData, error: permissionsError } = await supabase
      .rpc('get_user_permissions', { p_user_id: user.id })

    if (!permissionsError && Array.isArray(permissionsData)) {
      for (const record of permissionsData as PermissionRecord[]) {
        const actions = permissionsMap.get(record.module_name) ?? new Set<string>()
        actions.add(record.action)
        permissionsMap.set(record.module_name, actions)
      }
    } else if (permissionsError) {
      console.error('Failed to load user permissions for dashboard snapshot:', permissionsError)
    }

    const events: EventsSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'events'),
      today: [],
      upcoming: [],
      totalUpcoming: 0,
    }

    const customers: CustomersSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'customers'),
      total: 0,
      newThisWeek: 0,
      newThisMonth: 0,
      newLastMonth: 0,
    }

    const messages: MessagesSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'messages'),
      unread: 0,
    }

    const privateBookings: PrivateBookingsSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'private_bookings'),
      upcoming: [],
      totalUpcoming: 0,
    }

    const parking: ParkingSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'parking'),
      upcoming: [],
      totalUpcoming: 0,
      arrivalsToday: 0,
      pendingPayments: 0,
    }

    const invoices: InvoicesSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'invoices'),
      unpaid: [],
      unpaidCount: 0,
      overdueCount: 0,
      totalUnpaidValue: 0,
      overdue: [],
      dueToday: [],
    }

    const employees: EmployeesSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'employees'),
      activeCount: 0,
    }

    const receipts: ReceiptsSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'receipts'),
      pendingCount: 0,
      cantFindCount: 0,
      needsAttention: 0,
      lastImportAt: null,
      openAiCost: null,
    }

    const quotes: QuotesSnapshot = {
      permitted:
        hasModuleAccess(permissionsMap, 'quotes') ||
        hasModuleAccess(permissionsMap, 'invoices'),
      totalPendingValue: 0,
      totalExpiredValue: 0,
      totalAcceptedValue: 0,
      draftCount: 0,
    }

    const roles: RolesSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'roles'),
      totalRoles: 0,
    }

    const shortLinks: ShortLinksSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'short_links'),
      activeCount: 0,
    }

    const usersSnapshot: UsersSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'users'),
      totalUsers: 0,
    }

    const loyalty: LoyaltySnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'loyalty'),
    }

  const cashingUp: CashingUpSnapshot = {
    permitted: hasModuleAccess(permissionsMap, 'cashing_up'),
    thisWeekTotal: 0,
    thisWeekTarget: 0,
    lastWeekTotal: 0,
    lastYearTotal: 0,
    sessionsSubmittedCount: 0,
    completedThrough: null,
  }

    const systemHealth: SystemHealthSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'settings') || hasModuleAccess(permissionsMap, 'users'),
      smsFailures24h: 0,
      failedCronJobs24h: 0,
    }

    // Execute all permitted fetches in parallel
    const results = await Promise.allSettled([
      cashingUp.permitted ? (async () => {
        try {
           // Get Site
           const { data: site } = await supabase.from('sites').select('id').limit(1).single()
           if (!site) return

          const today = new Date()
          const todayStr = format(today, 'yyyy-MM-dd')
          const weekStart = startOfWeek(today, { weekStartsOn: 1 }) // Monday
          
          // Pull this week's sessions up to today to find the latest completed cash-up
          const { data: thisWeekData } = await supabase.from('cashup_sessions')
            .select('total_counted_amount, session_date, status')
            .eq('site_id', site.id)
            .gte('session_date', format(weekStart, 'yyyy-MM-dd'))
            .lte('session_date', todayStr)

          const completedSessions = (thisWeekData ?? []).filter(s => s.status && s.status !== 'draft')
          const lastCompletedIso = completedSessions.length
            ? completedSessions.reduce((latest, s) => (s.session_date > latest ? s.session_date : latest), completedSessions[0].session_date)
            : null

          const lastCompletedDay = lastCompletedIso ? new Date(lastCompletedIso) : null
          const completedDaysThisWeek = lastCompletedDay && lastCompletedDay >= weekStart
            ? differenceInCalendarDays(lastCompletedDay, weekStart) + 1
            : 0
          cashingUp.completedThrough = completedDaysThisWeek > 0 ? format(lastCompletedDay!, 'EEEE') : null
          
          // Ranges (Strings YYYY-MM-DD)
          const thisWeekStartStr = format(weekStart, 'yyyy-MM-dd')
          const thisWeekEnd = completedDaysThisWeek > 0 ? lastCompletedDay! : addDays(weekStart, -1)
          const thisWeekEndStr = format(thisWeekEnd, 'yyyy-MM-dd')
          
          const lastWeekStart = subWeeks(weekStart, 1)
          const lastWeekEnd = addDays(lastWeekStart, completedDaysThisWeek - 1)
          const lastWeekStartStr = format(lastWeekStart, 'yyyy-MM-dd')
          const lastWeekEndStr = format(lastWeekEnd, 'yyyy-MM-dd')

          const lastYearStart = subWeeks(weekStart, 52)
          const lastYearEnd = addDays(lastYearStart, completedDaysThisWeek - 1)
          const lastYearStartStr = format(lastYearStart, 'yyyy-MM-dd')
          const lastYearEndStr = format(lastYearEnd, 'yyyy-MM-dd')

          // Slice this week's data to the completed cutoff
          const thisWeekCompleted = (thisWeekData ?? []).filter(s => s.session_date <= thisWeekEndStr)

          // Fetch comparisons for the same number of completed days
          const [lastWeekRes, lastYearRes] = await Promise.all([
            supabase.from('cashup_sessions')
              .select('total_counted_amount')
              .eq('site_id', site.id)
              .gte('session_date', lastWeekStartStr)
              .lte('session_date', lastWeekEndStr),
            supabase.from('cashup_sessions')
              .select('total_counted_amount')
              .eq('site_id', site.id)
              .gte('session_date', lastYearStartStr)
              .lte('session_date', lastYearEndStr)
          ])
          
          // Sums
          cashingUp.thisWeekTotal = thisWeekCompleted.reduce((sum, s) => sum + (s.total_counted_amount || 0), 0)
          cashingUp.lastWeekTotal = lastWeekRes.data?.reduce((sum, s) => sum + (s.total_counted_amount || 0), 0) || 0
          cashingUp.lastYearTotal = lastYearRes.data?.reduce((sum, s) => sum + (s.total_counted_amount || 0), 0) || 0
          
          // Count submitted (only completed range)
          cashingUp.sessionsSubmittedCount = thisWeekCompleted.filter(s => s.status !== 'draft').length

          // Targets
          const { data: targets } = await supabase.from('cashup_targets')
            .select('*')
            .eq('site_id', site.id)
            .order('effective_from', { ascending: false })

          let targetSum = 0
          if (completedDaysThisWeek > 0) {
            let d = new Date(weekStart)
            while (d <= thisWeekEnd) {
              const dayIso = format(d, 'yyyy-MM-dd')
              const dayOfWeek = d.getDay()
              
              const target = targets?.find(t => t.day_of_week === dayOfWeek && t.effective_from <= dayIso)
              if (target) {
                targetSum += target.target_amount
              }
              d = addDays(d, 1)
            }
          }
          cashingUp.thisWeekTarget = targetSum

        } catch (error) {
          console.error('Failed to load cashing up metrics', error)
          cashingUp.error = 'Failed'
        }
      })() : Promise.resolve(),

      events.permitted ? (async () => {
        try {
          const { data, error, count } = await supabase
            .from('events')
            .select(`
              id,
              name,
              date,
              time
            `, { count: 'exact' })
            .gte('date', todayIso)
            .order('date', { ascending: true })
            .order('time', { ascending: true })
            .range(0, 24)

          if (error) throw error

          const processed = (data ?? []).map((event) => {
            return {
              id: event.id as string,
              name: (event.name as string) ?? 'Untitled event',
              date: (event.date as string) ?? null,
              time: (event.time as string) ?? null,
            }
          })

          events.today = processed.filter((event) => event.date === todayIso)
          events.upcoming = processed.filter((event) => event.date !== todayIso)
          events.totalUpcoming = typeof count === 'number' ? count : events.upcoming.length
          events.nextUpcoming = events.upcoming[0]
        } catch (error) {
          console.error('Failed to load dashboard events:', error)
          events.error = 'Failed to load events'
        }
      })() : Promise.resolve(),

      customers.permitted ? (async () => {
        try {
          const [totalResult, newWeekResult, newMonthResult, lastMonthResult] = await Promise.all([
            supabase.from('customers').select('id', { count: 'exact', head: true }),
            supabase
              .from('customers')
              .select('id', { count: 'exact', head: true })
              .gte('created_at', sevenDaysAgo),
            supabase
              .from('customers')
              .select('id', { count: 'exact', head: true })
              .gte('created_at', startOfThisMonth),
            supabase
              .from('customers')
              .select('id', { count: 'exact', head: true })
              .gte('created_at', startOfLastMonth)
              .lt('created_at', startOfThisMonth),
          ])

          if (totalResult.error) throw totalResult.error
          if (newWeekResult.error) throw newWeekResult.error
          if (newMonthResult.error) throw newMonthResult.error
          if (lastMonthResult.error) throw lastMonthResult.error

          customers.total = totalResult.count ?? 0
          customers.newThisWeek = newWeekResult.count ?? 0
          customers.newThisMonth = newMonthResult.count ?? 0
          customers.newLastMonth = lastMonthResult.count ?? 0
        } catch (error) {
          console.error('Failed to load dashboard customer metrics:', error)
          customers.error = 'Failed to load customer metrics'
        }
      })() : Promise.resolve(),

      messages.permitted ? (async () => {
        try {
          const { count, error } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('direction', 'inbound')
            .is('read_at', null)

          if (error) throw error

          messages.unread = count ?? 0
        } catch (error) {
          console.error('Failed to load dashboard message metrics:', error)
          messages.error = 'Failed to load message metrics'
        }
      })() : Promise.resolve(),

      privateBookings.permitted ? (async () => {
        try {
          const { data } = await PrivateBookingService.getBookings({
            fromDate: todayIso,
            limit: 20,
            useAdmin: true
          });

          const filtered = (data ?? []).filter((booking) => {
            const status = (booking.status as string) ?? null
            return status === 'draft' || status === 'confirmed'
          })

          privateBookings.upcoming = filtered.map((booking) => ({
            id: booking.id as string,
            customer_name: (booking.customer_name as string) ?? null,
            event_date: (booking.event_date as string) ?? null,
            start_time: (booking.start_time as string) ?? null,
            status: (booking.status as string) ?? null,
            customer_id: (booking.customer_id as string) ?? null,
            hold_expiry: (booking.hold_expiry as string) ?? null,
            deposit_status: (booking.deposit_status as PrivateBookingSummary['deposit_status']) ?? null,
            balance_due_date: (booking.balance_due_date as string) ?? null,
            days_until_event:
              typeof booking.days_until_event === 'number'
                ? booking.days_until_event
                : booking.days_until_event != null
                  ? Number(booking.days_until_event)
                  : null,
          }))
          privateBookings.totalUpcoming = privateBookings.upcoming.length
        } catch (error) {
          console.error('Failed to load dashboard private bookings:', error)
          privateBookings.error = 'Failed to load private bookings'
        }
      })() : Promise.resolve(),

      parking.permitted ? (async () => {
        try {
          const { data, error, count } = await supabase
            .from('parking_bookings')
            .select(
              `
                id,
                reference,
                customer_first_name,
                customer_last_name,
                vehicle_registration,
                start_at,
                end_at,
                status,
                payment_status
              `,
              { count: 'exact' }
            )
            .gte('start_at', todayIso) // Changed from nowIso to todayIso
            .in('status', ['pending_payment', 'confirmed'])
            .order('start_at', { ascending: true })
            .range(0, 19)

          if (error) throw error

          parking.upcoming = (data ?? []).map((booking) => ({
            id: booking.id as string,
            reference: (booking.reference as string) ?? null,
            customer_first_name: (booking.customer_first_name as string) ?? null,
            customer_last_name: (booking.customer_last_name as string) ?? null,
            vehicle_registration: (booking.vehicle_registration as string) ?? null,
            start_at: (booking.start_at as string) ?? null,
            end_at: (booking.end_at as string) ?? null,
            status: (booking.status as string) ?? null,
            payment_status: (booking.payment_status as string) ?? null,
          }))

          parking.totalUpcoming = typeof count === 'number' ? count : parking.upcoming.length
          parking.arrivalsToday = parking.upcoming.filter(
            (booking) => booking.start_at && booking.start_at.slice(0, 10) === todayIso
          ).length
          parking.pendingPayments = parking.upcoming.filter((booking) => booking.payment_status === 'pending').length
          parking.nextBooking = parking.upcoming[0]
        } catch (error) {
          console.error('Failed to load dashboard parking bookings:', error)
          parking.error = 'Failed to load parking bookings'
        }
      })() : Promise.resolve(),

      invoices.permitted ? (async () => {
        try {
          const unpaidStatuses: Array<InvoiceSummary['status']> = [
            'draft',
            'sent',
            'partially_paid',
            'overdue',
          ]
          const scheduleStatuses: Array<InvoiceSummary['status']> = [
            'sent',
            'partially_paid',
            'overdue',
          ]
          const [unpaidResult, overdueCountResult, allUnpaidResult, overdueListResult, dueTodayListResult] = await Promise.all([
            // Limited unpaid for display in lists
            supabase
              .from('invoices')
              .select(
                `
                  id,
                  invoice_number,
                  total_amount,
                  status,
                  due_date,
                  vendor:invoice_vendors(name)
                `,
                { count: 'exact' }
              )
              .in('status', unpaidStatuses)
              .order('due_date', { ascending: true })
              .range(0, 4),
            // Overdue count (already there)
            supabase
              .from('invoices')
              .select('id', { count: 'exact', head: true })
              .in('status', scheduleStatuses)
              .lt('due_date', todayIso),
            // Total unpaid value (already there)
            supabase
              .from('invoices')
              .select('total_amount')
              .in('status', unpaidStatuses),
            // NEW: Overdue invoices list (up to 5 for display in today's schedule)
            supabase
              .from('invoices')
              .select(
                `
                  id,
                  invoice_number,
                  total_amount,
                  status,
                  due_date,
                  vendor:invoice_vendors(name)
                `
              )
              .in('status', scheduleStatuses)
              .lt('due_date', todayIso)
              .order('due_date', { ascending: true })
              .range(0, 4),
            // NEW: Invoices due today list (up to 5 for display in today's schedule)
            supabase
              .from('invoices')
              .select(
                `
                  id,
                  invoice_number,
                  total_amount,
                  status,
                  due_date,
                  vendor:invoice_vendors(name)
                `
              )
              .in('status', scheduleStatuses)
              .eq('due_date', todayIso)
              .order('due_date', { ascending: true })
              .range(0, 4),
          ])

          if (unpaidResult.error) throw unpaidResult.error
          if (overdueCountResult.error) throw overdueCountResult.error
          if (allUnpaidResult.error) throw allUnpaidResult.error
          if (overdueListResult.error) throw overdueListResult.error
          if (dueTodayListResult.error) throw dueTodayListResult.error

          invoices.unpaid = (unpaidResult.data ?? []).map((invoice) => ({
            id: invoice.id as string,
            invoice_number: (invoice.invoice_number as string) ?? null,
            total_amount: invoice.total_amount != null ? Number(invoice.total_amount) : null,
            status: (invoice.status as string) ?? null,
            due_date: (invoice.due_date as string) ?? null,
            vendor: invoice.vendor ?? null,
          }))
          invoices.unpaidCount = unpaidResult.count ?? invoices.unpaid.length
          invoices.overdueCount = overdueCountResult.count ?? 0
          
          invoices.totalUnpaidValue = (allUnpaidResult.data ?? []).reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0)

          invoices.overdue = (overdueListResult.data ?? []).map((invoice) => ({
            id: invoice.id as string,
            invoice_number: (invoice.invoice_number as string) ?? null,
            total_amount: invoice.total_amount != null ? Number(invoice.total_amount) : null,
            status: (invoice.status as string) ?? null,
            due_date: (invoice.due_date as string) ?? null,
            vendor: invoice.vendor ?? null,
          }))

          invoices.dueToday = (dueTodayListResult.data ?? []).map((invoice) => ({
            id: invoice.id as string,
            invoice_number: (invoice.invoice_number as string) ?? null,
            total_amount: invoice.total_amount != null ? Number(invoice.total_amount) : null,
            status: (invoice.status as string) ?? null,
            due_date: (invoice.due_date as string) ?? null,
            vendor: invoice.vendor ?? null,
          }))
        } catch (error) {
          console.error('Failed to load dashboard invoices:', error)
          invoices.error = 'Failed to load invoices'
        }
      })() : Promise.resolve(),

      employees.permitted ? (async () => {
        try {
          const { count, error } = await supabase
            .from('employees')
            .select('employee_id', { count: 'exact', head: true })
            .eq('status', 'Active')

          if (error) throw error

          employees.activeCount = count ?? 0
        } catch (error) {
          console.error('Failed to load dashboard employee metrics:', error)
          employees.error = 'Failed to load employee metrics'
        }
      })() : Promise.resolve(),

      receipts.permitted ? (async () => {
        try {
          const admin = createAdminClient()
          const [{ data: statusCounts, error: statusError }, lastBatchResult, openAiResult] = await Promise.all([
            admin.rpc('count_receipt_statuses'),
            admin
              .from('receipt_batches')
              .select('*')
              .order('uploaded_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            admin.rpc('get_openai_usage_total'),
          ])

          if (statusError) throw statusError

          const countsRecord = Array.isArray(statusCounts) ? statusCounts[0] : statusCounts
          const pending = Number(countsRecord?.pending ?? 0)
          const cantFind = Number(countsRecord?.cant_find ?? 0)

          receipts.pendingCount = pending
          receipts.cantFindCount = cantFind
          receipts.needsAttention = pending
          receipts.lastImportAt = lastBatchResult.data?.uploaded_at ?? null

          if (openAiResult.error) {
            console.error('Failed to load OpenAI usage total for receipts:', openAiResult.error)
            receipts.openAiCost = null
          } else {
            receipts.openAiCost = openAiResult.data != null ? Number(openAiResult.data) : null
          }
        } catch (error) {
          console.error('Failed to load dashboard receipt metrics:', error)
          receipts.error = 'Failed to load receipt metrics'
        }
      })() : Promise.resolve(),

      quotes.permitted ? (async () => {
        try {
          const { data, error } = await supabase
            .from('quotes')
            .select('status, total_amount, valid_until')

          if (error) throw error

          const today = new Date()
          today.setHours(0, 0, 0, 0)

          for (const quote of data ?? []) {
            const status = (quote.status as string) ?? 'draft'
            const totalAmount = Number(quote.total_amount ?? 0)

            if (status === 'draft') {
              quotes.draftCount += 1
              continue
            }

            if (status === 'sent') {
              const validUntil = quote.valid_until ? new Date(quote.valid_until as string) : null
              if (validUntil && validUntil < today) {
                quotes.totalExpiredValue += totalAmount
              } else {
                quotes.totalPendingValue += totalAmount
              }
            } else if (status === 'accepted') {
              quotes.totalAcceptedValue += totalAmount
            }
          }
        } catch (error) {
          console.error('Failed to load dashboard quote metrics:', error)
          quotes.error = 'Failed to load quote metrics'
        }
      })() : Promise.resolve(),

      roles.permitted ? (async () => {
        try {
          const admin = createAdminClient()
          const { count, error } = await admin
            .from('roles')
            .select('id', { count: 'exact', head: true })

          if (error) throw error

          roles.totalRoles = count ?? 0
        } catch (error) {
          console.error('Failed to load dashboard role metrics:', error)
          roles.error = 'Failed to load role metrics'
        }
      })() : Promise.resolve(),

      shortLinks.permitted ? (async () => {
        try {
          const { count, error } = await supabase
            .from('short_links')
            .select('id', { count: 'exact', head: true })

          if (error) throw error

          shortLinks.activeCount = count ?? 0
        } catch (error) {
          console.error('Failed to load dashboard short link metrics:', error)
          shortLinks.error = 'Failed to load short link metrics'
        }
      })() : Promise.resolve(),

      usersSnapshot.permitted ? (async () => {
        try {
          const { data, error } = await supabase.auth.admin.listUsers({
            perPage: 1,
            page: 1,
          })

          if (error) throw error

          const total = data?.total ?? data?.users?.length ?? 0
          usersSnapshot.totalUsers = total
        } catch (error) {
          console.error('Failed to load dashboard user metrics:', error)
          usersSnapshot.error = 'Failed to load user metrics'
        }
      })() : Promise.resolve(),

      systemHealth.permitted ? (async () => {
        try {
          const admin = createAdminClient()
          const [smsResult, cronResult] = await Promise.all([
            admin
              .from('messages')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'failed')
              .gte('created_at', oneDayAgo),
            admin
              .from('cron_job_runs')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'failed')
              .gte('created_at', oneDayAgo),
          ])

          if (smsResult.error) throw smsResult.error
          
          systemHealth.smsFailures24h = smsResult.count ?? 0
          
          if (cronResult.error) {
             console.warn('Failed to fetch cron job runs, possibly table missing:', cronResult.error)
             systemHealth.failedCronJobs24h = 0
          } else {
             systemHealth.failedCronJobs24h = cronResult.count ?? 0
          }

        } catch (error) {
          console.error('Failed to load dashboard system health:', error)
          systemHealth.error = 'Failed to load system health'
        }
      })() : Promise.resolve(),
      // Ensure all items in Promise.allSettled are followed by a comma,
      // and the final closing parenthesis and bracket match the opening ones.
    ])

    const profile: ProfileSnapshot = {
      permitted: true,
      email: user.email ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
    }

    return {
      generatedAt: new Date().toISOString(),
      user: profile,
      events,
      customers,
      messages,
      privateBookings,
      parking,
      invoices,
      employees,
      receipts,
      quotes,
      roles,
      shortLinks,
      users: usersSnapshot,
      loyalty,
      cashingUp,
      systemHealth,
    }
  },
  ['dashboard-snapshot'],
  {
    revalidate: 60,
    tags: ['dashboard'],
  }
)

export async function loadDashboardSnapshot() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Error('Not authenticated')
  }

  return fetchDashboardSnapshot(user.id)
}
