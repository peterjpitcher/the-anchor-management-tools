'use server'

import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PrivateBookingService } from '@/services/private-bookings'
import { getLocalIsoDateDaysAgo, getLocalIsoDateDaysAhead, getTodayIsoDate } from '@/lib/dateUtils'
import { startOfWeek, subWeeks, format, addDays, differenceInCalendarDays } from 'date-fns'

type EventSummary = {
  id: string
  name: string
  date: string | null
  time: string | null
  capacity: number | null
  price: number | null
}

type CalendarNoteSummary = {
  id: string
  note_date: string
  end_date: string
  title: string
  notes: string | null
  source: string
  start_time: string | null
  end_time: string | null
  color: string
}

type EventsSnapshot = {
  permitted: boolean
  today: EventSummary[]
  upcoming: EventSummary[]
  past: EventSummary[]
  calendarNotes: CalendarNoteSummary[]
  totalUpcoming: number
  nextUpcoming?: EventSummary
  error?: string
}

type BookingPipelineValue = {
  confirmed: number
  draft: number
  total: number
  confirmedCount: number
  draftCount: number
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

type TableBookingsSnapshot = {
  permitted: boolean
  thisWeekTotal: number
  lastWeekTotal: number
  thisMonthTotal: number
  lastMonthTotal: number
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
  tableBookings: TableBookingsSnapshot
  systemHealth: SystemHealthSnapshot
  /** B4: Total revenue from private bookings today (confirmed/completed) */
  revenueToday: number
  /** B3: Pipeline value of upcoming confirmed + draft private bookings */
  bookingPipelineValue: BookingPipelineValue
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

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const pgError = error as { code?: string | null; message?: string | null }
  if (pgError.code !== '42703') {
    return false
  }

  return new RegExp(`\\b${columnName}\\b`, 'i').test(pgError.message ?? '')
}

async function fetchDashboardSnapshotImpl(userId: string): Promise<DashboardSnapshot> {
    const supabase = await createAdminClient()
    const { data: userResult, error: userLookupError } = await supabase.auth.admin.getUserById(userId)

    const user = userResult?.user ?? null

    if (userLookupError || !user) {
      throw new Error('Not authenticated')
    }

    const todayIso = getTodayIsoDate()
    const eventsLookbackIso = getLocalIsoDateDaysAgo(90)
    const calendarNotesHorizonIso = getLocalIsoDateDaysAhead(180)
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
      past: [],
      calendarNotes: [],
      totalUpcoming: 0,
    }
    const canViewCalendarNotes = events.permitted || hasModuleAccess(permissionsMap, 'settings')

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

    const tableBookings: TableBookingsSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'table_bookings'),
      thisWeekTotal: 0,
      lastWeekTotal: 0,
      thisMonthTotal: 0,
      lastMonthTotal: 0,
    }

    const systemHealth: SystemHealthSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'settings') || hasModuleAccess(permissionsMap, 'users'),
      smsFailures24h: 0,
      failedCronJobs24h: 0,
    }

    // B4 / B3 analytics — only computed when user has private_bookings access
    let revenueToday = 0
    const bookingPipelineValue: BookingPipelineValue = {
      confirmed: 0,
      draft: 0,
      total: 0,
      confirmedCount: 0,
      draftCount: 0,
    }

    // Execute all permitted fetches in parallel
    const results = await Promise.allSettled([
      cashingUp.permitted ? (async () => {
        try {
           // Get Site
           const { data: site } = await supabase.from('sites').select('id').limit(1).single()
           if (!site) return

          const today = new Date(todayIso)
          const todayStr = todayIso
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

          // LOW-002: Parallelise comparison and targets queries — they are
          // independent of each other (both only depend on site.id).
          // The thisWeekData query above must run first because its results
          // determine the date ranges for comparisons.
          const [lastWeekRes, lastYearRes, targetsRes] = await Promise.all([
            supabase.from('cashup_sessions')
              .select('total_counted_amount')
              .eq('site_id', site.id)
              .gte('session_date', lastWeekStartStr)
              .lte('session_date', lastWeekEndStr),
            supabase.from('cashup_sessions')
              .select('total_counted_amount')
              .eq('site_id', site.id)
              .gte('session_date', lastYearStartStr)
              .lte('session_date', lastYearEndStr),
            supabase.from('cashup_targets')
              .select('*')
              .eq('site_id', site.id)
              .order('effective_from', { ascending: false })
          ])
          const targets = targetsRes.data

          // Sums
          cashingUp.thisWeekTotal = thisWeekCompleted.reduce((sum, s) => sum + (s.total_counted_amount || 0), 0)
          cashingUp.lastWeekTotal = lastWeekRes.data?.reduce((sum, s) => sum + (s.total_counted_amount || 0), 0) || 0
          cashingUp.lastYearTotal = lastYearRes.data?.reduce((sum, s) => sum + (s.total_counted_amount || 0), 0) || 0

          // Count submitted (only completed range)
          cashingUp.sessionsSubmittedCount = thisWeekCompleted.filter(s => s.status !== 'draft').length

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

      tableBookings.permitted ? (async () => {
        try {
          const today = new Date(todayIso)
          const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 })
          const dayOffsetInWeek = Math.max(0, differenceInCalendarDays(today, thisWeekStart))

          const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
          const dayOffsetInMonth = Math.max(0, differenceInCalendarDays(today, thisMonthStart))

          const lastWeekStart = subWeeks(thisWeekStart, 1)
          const lastWeekEnd = addDays(lastWeekStart, dayOffsetInWeek)

          const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
          const lastMonthNaturalEnd = addDays(thisMonthStart, -1)
          const comparableLastMonthEndCandidate = addDays(lastMonthStart, dayOffsetInMonth)
          const lastMonthEnd =
            comparableLastMonthEndCandidate.getTime() > lastMonthNaturalEnd.getTime()
              ? lastMonthNaturalEnd
              : comparableLastMonthEndCandidate

          const [thisWeekResult, lastWeekResult, thisMonthResult, lastMonthResult] = await Promise.all([
            supabase
              .from('table_bookings')
              .select('id', { count: 'exact', head: true })
              .not('status', 'in', '(cancelled,no_show)')
              .gte('booking_date', format(thisWeekStart, 'yyyy-MM-dd'))
              .lte('booking_date', format(today, 'yyyy-MM-dd')),
            supabase
              .from('table_bookings')
              .select('id', { count: 'exact', head: true })
              .not('status', 'in', '(cancelled,no_show)')
              .gte('booking_date', format(lastWeekStart, 'yyyy-MM-dd'))
              .lte('booking_date', format(lastWeekEnd, 'yyyy-MM-dd')),
            supabase
              .from('table_bookings')
              .select('id', { count: 'exact', head: true })
              .not('status', 'in', '(cancelled,no_show)')
              .gte('booking_date', format(thisMonthStart, 'yyyy-MM-dd'))
              .lte('booking_date', format(today, 'yyyy-MM-dd')),
            supabase
              .from('table_bookings')
              .select('id', { count: 'exact', head: true })
              .not('status', 'in', '(cancelled,no_show)')
              .gte('booking_date', format(lastMonthStart, 'yyyy-MM-dd'))
              .lte('booking_date', format(lastMonthEnd, 'yyyy-MM-dd')),
          ])

          if (thisWeekResult.error) throw thisWeekResult.error
          if (lastWeekResult.error) throw lastWeekResult.error
          if (thisMonthResult.error) throw thisMonthResult.error
          if (lastMonthResult.error) throw lastMonthResult.error

          tableBookings.thisWeekTotal = thisWeekResult.count ?? 0
          tableBookings.lastWeekTotal = lastWeekResult.count ?? 0
          tableBookings.thisMonthTotal = thisMonthResult.count ?? 0
          tableBookings.lastMonthTotal = lastMonthResult.count ?? 0
        } catch (error) {
          console.error('Failed to load dashboard table booking metrics:', error)
          tableBookings.error = 'Failed to load table booking metrics'
        }
      })() : Promise.resolve(),

      events.permitted ? (async () => {
        try {
          const [upcomingResult, pastResult] = await Promise.all([
            supabase
              .from('events')
              .select(
                `
                  id,
                  name,
                  date,
                  time,
                  capacity,
                  price
                `,
                { count: 'exact' }
              )
              .gte('date', todayIso)
              .order('date', { ascending: true })
              .order('time', { ascending: true })
              .range(0, 24),
            supabase
              .from('events')
              .select(
                `
                  id,
                  name,
                  date,
                  time,
                  capacity,
                  price
                `
              )
              .gte('date', eventsLookbackIso)
              .lt('date', todayIso)
              .order('date', { ascending: false })
              .order('time', { ascending: false })
              .range(0, 24),
          ])

          if (upcomingResult.error) throw upcomingResult.error
          if (pastResult.error) throw pastResult.error

          const toSummary = (event: {
            id: string
            name: string | null
            date: string | null
            time: string | null
            capacity: number | null
            price: number | null
          }): EventSummary => {
            return {
              id: event.id as string,
              name: (event.name as string) ?? 'Untitled event',
              date: (event.date as string) ?? null,
              time: (event.time as string) ?? null,
              capacity: event.capacity ?? null,
              price: event.price ?? null,
            }
          }

          const upcoming = (upcomingResult.data ?? []).map(toSummary)
          const pastDescending = (pastResult.data ?? []).map(toSummary)

          events.today = upcoming.filter((event) => event.date === todayIso)
          events.upcoming = upcoming.filter((event) => event.date !== todayIso)
          events.past = [...pastDescending].reverse()
          events.totalUpcoming = typeof upcomingResult.count === 'number' ? upcomingResult.count : events.upcoming.length
          events.nextUpcoming = events.upcoming[0]
        } catch (error) {
          console.error('Failed to load dashboard events:', error)
          events.error = 'Failed to load events'
        }
      })() : Promise.resolve(),

      canViewCalendarNotes ? (async () => {
        try {
          const { data: notes, error } = await supabase
            .from('calendar_notes')
            .select('id, note_date, end_date, title, notes, source, start_time, end_time, color')
            .gte('note_date', eventsLookbackIso)
            .lte('note_date', calendarNotesHorizonIso)
            .order('note_date', { ascending: true })
            .order('end_date', { ascending: true })
            .order('start_time', { ascending: true, nullsFirst: true })
            .order('title', { ascending: true })
            .range(0, 999)

          if (error) throw error

          events.calendarNotes = (notes ?? []).map((note) => ({
            id: String(note.id),
            note_date: String(note.note_date),
            end_date: typeof note.end_date === 'string' ? note.end_date : String(note.note_date),
            title: typeof note.title === 'string' ? note.title : 'Calendar note',
            notes: typeof note.notes === 'string' ? note.notes : null,
            source: typeof note.source === 'string' ? note.source : 'manual',
            start_time: typeof note.start_time === 'string' ? note.start_time : null,
            end_time: typeof note.end_time === 'string' ? note.end_time : null,
            color: typeof note.color === 'string' ? note.color : '#0EA5E9',
          }))
        } catch (error) {
          console.error('Failed to load dashboard calendar notes:', error)
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
              .is('deleted_at', null)
              .in('status', unpaidStatuses)
              .order('due_date', { ascending: true })
              .range(0, 4),
            // Overdue count (already there)
            supabase
              .from('invoices')
              .select('id', { count: 'exact', head: true })
              .is('deleted_at', null)
              .in('status', scheduleStatuses)
              .lt('due_date', todayIso),
            // Total unpaid value — fetches all rows for JS-side summation.
            // No limit applied since we need the full sum. This should become
            // an RPC aggregate (e.g. get_unpaid_invoice_totals) for efficiency.
            supabase
              .from('invoices')
              .select('total_amount, paid_amount')
              .is('deleted_at', null)
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
              .is('deleted_at', null)
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
              .is('deleted_at', null)
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
          
          invoices.totalUnpaidValue = (allUnpaidResult.data ?? []).reduce((sum, inv) => {
            const total = Number(inv.total_amount ?? 0)
            const paid = Number(inv.paid_amount ?? 0)
            const outstanding = Math.max(0, total - paid)
            return sum + (Number.isFinite(outstanding) ? outstanding : 0)
          }, 0)

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
          // Replace full-table fetch + JS-side aggregation with four targeted queries.
          // todayIso is already computed in the outer scope.
          const sumAmounts = (rows: Array<{ total_amount?: number | null }> | null) =>
            (rows ?? []).reduce((acc, r) => acc + Number(r.total_amount ?? 0), 0)

          // Helper: run a query and fall back to the same query without the deleted_at filter
          // when the column doesn't exist yet.
          // Using PromiseLike so Supabase's PostgrestFilterBuilder (which is thenable but not
          // a native Promise) is accepted without wrapping.
          const withDeletedAtFallback = async <T>(
            primary: PromiseLike<{ data: T | null; error: unknown; count?: number | null }>,
            fallback: () => PromiseLike<{ data: T | null; error: unknown; count?: number | null }>
          ) => {
            const res = await primary
            if (res.error && isMissingColumnError(res.error, 'deleted_at')) {
              return fallback()
            }
            return res
          }

          // MED-010: Removed .limit(1000) caps that silently truncated sums.
          // These queries only select total_amount for aggregation so row size
          // is minimal. Ideally these should become a single RPC aggregate, but
          // for now fetching all rows without a cap ensures correct sums.
          const [draftRes, pendingRes, expiredRes, acceptedRes] = await Promise.all([
            withDeletedAtFallback(
              supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'draft').is('deleted_at', null),
              () => supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'draft')
            ),
            withDeletedAtFallback(
              supabase.from('quotes').select('total_amount').eq('status', 'sent').or(`valid_until.is.null,valid_until.gte.${todayIso}`).is('deleted_at', null),
              () => supabase.from('quotes').select('total_amount').eq('status', 'sent').or(`valid_until.is.null,valid_until.gte.${todayIso}`)
            ),
            withDeletedAtFallback(
              supabase.from('quotes').select('total_amount').eq('status', 'sent').lt('valid_until', todayIso).is('deleted_at', null),
              () => supabase.from('quotes').select('total_amount').eq('status', 'sent').lt('valid_until', todayIso)
            ),
            withDeletedAtFallback(
              supabase.from('quotes').select('total_amount').eq('status', 'accepted').is('deleted_at', null),
              () => supabase.from('quotes').select('total_amount').eq('status', 'accepted')
            ),
          ])

          if (draftRes.error) throw draftRes.error
          if (pendingRes.error) throw pendingRes.error
          if (expiredRes.error) throw expiredRes.error
          if (acceptedRes.error) throw acceptedRes.error

          quotes.draftCount = draftRes.count ?? 0
          quotes.totalPendingValue = sumAmounts(pendingRes.data as Array<{ total_amount?: number | null }> | null)
          quotes.totalExpiredValue = sumAmounts(expiredRes.data as Array<{ total_amount?: number | null }> | null)
          quotes.totalAcceptedValue = sumAmounts(acceptedRes.data as Array<{ total_amount?: number | null }> | null)
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
      // B3 + B4: private booking pipeline value and revenue today
      privateBookings.permitted ? (async () => {
        try {
          // Fetch all upcoming confirmed + draft bookings for pipeline value (no limit)
          const { data: pipelineData, error: pipelineError } = await supabase
            .from('private_bookings')
            .select('status, total_amount, event_date')
            .gte('event_date', todayIso)
            .in('status', ['confirmed', 'draft'])

          if (pipelineError) throw pipelineError

          for (const row of pipelineData ?? []) {
            const amount = Number(row.total_amount ?? 0)
            if (row.status === 'confirmed') {
              bookingPipelineValue.confirmed += amount
              bookingPipelineValue.confirmedCount += 1
            } else if (row.status === 'draft') {
              bookingPipelineValue.draft += amount
              bookingPipelineValue.draftCount += 1
            }
          }
          bookingPipelineValue.total = bookingPipelineValue.confirmed + bookingPipelineValue.draft

          // B4: Revenue today — sum total_amount of confirmed/completed bookings with event_date = today
          const { data: todayPbData, error: todayPbError } = await supabase
            .from('private_bookings')
            .select('total_amount')
            .eq('event_date', todayIso)
            .in('status', ['confirmed', 'completed'])

          if (todayPbError) throw todayPbError

          revenueToday = (todayPbData ?? []).reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0)
        } catch (error) {
          console.error('Failed to load dashboard booking pipeline / revenue today:', error)
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
      tableBookings,
      systemHealth,
      revenueToday,
      bookingPipelineValue,
    }
}

export async function loadDashboardSnapshot(userId?: string): Promise<DashboardSnapshot> {
  let resolvedUserId = userId

  if (!resolvedUserId) {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      throw new Error('Not authenticated')
    }

    resolvedUserId = user.id
  }

  // Wrap unstable_cache with the userId baked into the key array so each user
  // gets their own isolated cache entry. Without this, Next.js may serve one
  // user's dashboard data to another user sharing the same cache tag.
  const fetchForUser = unstable_cache(
    async () => fetchDashboardSnapshotImpl(resolvedUserId!),
    ['dashboard-snapshot', resolvedUserId],
    // LOW-007: The 60s TTL is intentional. It acts as a short-lived fallback;
    // most invalidation happens via revalidateTag('dashboard') calls from
    // mutation server actions (bookings, invoices, rota, etc.), so stale data
    // is rare in practice. Splitting into hot/cold cache segments was
    // considered but adds complexity without measurable user-facing benefit
    // given the tag-based invalidation already in place.
    { revalidate: 60, tags: ['dashboard', `dashboard-user-${resolvedUserId}`] }
  )

  return fetchForUser()
}
