'use server'

import { unstable_cache } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getTodayIsoDate } from '@/lib/dateUtils'

type EventSummary = {
  id: string
  name: string
  date: string | null
  time: string | null
  capacity: number | null
  bookingCount: number
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
}

type PrivateBookingsSnapshot = {
  permitted: boolean
  upcoming: PrivateBookingSummary[]
  totalUpcoming: number
  error?: string
}

type TableBookingCustomer = {
  first_name: string | null
  last_name: string | null
}

type TableBookingSummary = {
  id: string
  customer_id: string | null
  booking_date: string | null
  booking_time: string | null
  party_size: number | null
  status: string | null
  customers: TableBookingCustomer[] | TableBookingCustomer | null
}

type TableBookingsSnapshot = {
  permitted: boolean
  upcoming: TableBookingSummary[]
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
  tableBookings: TableBookingsSnapshot
  parking: ParkingSnapshot
  invoices: InvoicesSnapshot
  employees: EmployeesSnapshot
  receipts: ReceiptsSnapshot
  quotes: QuotesSnapshot
  roles: RolesSnapshot
  shortLinks: ShortLinksSnapshot
  users: UsersSnapshot
  loyalty: LoyaltySnapshot
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

    if (events.permitted) {
      try {
        const { data, error, count } = await supabase
          .from('events')
          .select(`
            id,
            name,
            date,
            time,
            capacity,
            bookings (id, seats)
          `, { count: 'exact' })
          .gte('date', todayIso)
          .order('date', { ascending: true })
          .order('time', { ascending: true })
          .range(0, 24)

        if (error) {
          throw error
        }

        const processed = (data ?? []).map((event) => {
          const bookingCount = Array.isArray(event.bookings)
            ? event.bookings.reduce((total: number, booking: { seats: number | null }) => total + (booking.seats || 0), 0)
            : 0

          return {
            id: event.id as string,
            name: (event.name as string) ?? 'Untitled event',
            date: (event.date as string) ?? null,
            time: (event.time as string) ?? null,
            capacity: event.capacity != null ? Number(event.capacity) : null,
            bookingCount,
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
    }

    const customers: CustomersSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'customers'),
      total: 0,
      newThisWeek: 0,
    }

    if (customers.permitted) {
      try {
        const [totalResult, newResult] = await Promise.all([
          supabase.from('customers').select('id', { count: 'exact', head: true }),
          supabase
            .from('customers')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', sevenDaysAgo),
        ])

        if (totalResult.error) {
          throw totalResult.error
        }
        if (newResult.error) {
          throw newResult.error
        }

        customers.total = totalResult.count ?? 0
        customers.newThisWeek = newResult.count ?? 0
      } catch (error) {
        console.error('Failed to load dashboard customer metrics:', error)
        customers.error = 'Failed to load customer metrics'
      }
    }

    const messages: MessagesSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'messages'),
      unread: 0,
    }

    if (messages.permitted) {
      try {
        const { count, error } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('direction', 'inbound')
          .is('read_at', null)

        if (error) {
          throw error
        }

        messages.unread = count ?? 0
      } catch (error) {
        console.error('Failed to load dashboard message metrics:', error)
        messages.error = 'Failed to load message metrics'
      }
    }

    const privateBookings: PrivateBookingsSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'private_bookings'),
      upcoming: [],
      totalUpcoming: 0,
    }

    if (privateBookings.permitted) {
      try {
        const { data, error, count } = await supabase
          .from('private_bookings')
          .select(
            `
              id,
              customer_name,
              event_date,
              start_time,
              status,
              customer_id
            `,
            { count: 'exact' }
          )
          .gte('event_date', todayIso)
          .order('event_date', { ascending: true })
          .order('start_time', { ascending: true })
          .range(0, 4)

        if (error) {
          throw error
        }

        privateBookings.upcoming = (data ?? []).map((booking) => ({
          id: booking.id as string,
          customer_name: (booking.customer_name as string) ?? null,
          event_date: (booking.event_date as string) ?? null,
          start_time: (booking.start_time as string) ?? null,
          status: (booking.status as string) ?? null,
          customer_id: (booking.customer_id as string) ?? null,
        }))
        privateBookings.totalUpcoming = typeof count === 'number' ? count : privateBookings.upcoming.length
      } catch (error) {
        console.error('Failed to load dashboard private bookings:', error)
        privateBookings.error = 'Failed to load private bookings'
      }
    }

    const tableBookings: TableBookingsSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'table_bookings'),
      upcoming: [],
      totalUpcoming: 0,
    }

    if (tableBookings.permitted) {
      try {
        const { data, error, count } = await supabase
          .from('table_bookings')
          .select(
            `
              id,
              customer_id,
              booking_date,
              booking_time,
              party_size,
              status,
              customers (
                first_name,
                last_name
              )
            `,
            { count: 'exact' }
          )
          .gte('booking_date', todayIso)
          .neq('status', 'cancelled')
          .order('booking_date', { ascending: true })
          .order('booking_time', { ascending: true })
          .range(0, 4)

        if (error) {
          throw error
        }

        tableBookings.upcoming = (data ?? []).map((booking) => ({
          id: booking.id as string,
          customer_id: (booking.customer_id as string) ?? null,
          booking_date: (booking.booking_date as string) ?? null,
          booking_time: (booking.booking_time as string) ?? null,
          party_size: booking.party_size != null ? Number(booking.party_size) : null,
          status: (booking.status as string) ?? null,
          customers: booking.customers ?? null,
        }))
        tableBookings.totalUpcoming = typeof count === 'number' ? count : tableBookings.upcoming.length
      } catch (error) {
        console.error('Failed to load dashboard table bookings:', error)
        tableBookings.error = 'Failed to load table bookings'
      }
    }

    const parking: ParkingSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'parking'),
      upcoming: [],
      totalUpcoming: 0,
      arrivalsToday: 0,
      pendingPayments: 0,
    }

    if (parking.permitted) {
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
          .gte('start_at', nowIso)
          .in('status', ['pending_payment', 'confirmed'])
          .order('start_at', { ascending: true })
          .range(0, 4)

        if (error) {
          throw error
        }

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
    }

    const invoices: InvoicesSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'invoices'),
      unpaid: [],
      unpaidCount: 0,
      overdueCount: 0,
    }

    if (invoices.permitted) {
      try {
        const [unpaidResult, overdueResult] = await Promise.all([
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
            .neq('status', 'paid')
            .order('due_date', { ascending: true })
            .range(0, 4),
          supabase
            .from('invoices')
            .select('id', { count: 'exact', head: true })
            .neq('status', 'paid')
            .lt('due_date', todayIso),
        ])

        if (unpaidResult.error) {
          throw unpaidResult.error
        }
        if (overdueResult.error) {
          throw overdueResult.error
        }

        invoices.unpaid = (unpaidResult.data ?? []).map((invoice) => ({
          id: invoice.id as string,
          invoice_number: (invoice.invoice_number as string) ?? null,
          total_amount: invoice.total_amount != null ? Number(invoice.total_amount) : null,
          status: (invoice.status as string) ?? null,
          due_date: (invoice.due_date as string) ?? null,
          vendor: invoice.vendor ?? null,
        }))
        invoices.unpaidCount = unpaidResult.count ?? invoices.unpaid.length
        invoices.overdueCount = overdueResult.count ?? 0
      } catch (error) {
        console.error('Failed to load dashboard invoices:', error)
        invoices.error = 'Failed to load invoices'
      }
    }

    const employees: EmployeesSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'employees'),
      activeCount: 0,
    }

    if (employees.permitted) {
      try {
        const { count, error } = await supabase
          .from('employees')
          .select('employee_id', { count: 'exact', head: true })
          .eq('status', 'Active')

        if (error) {
          throw error
        }

        employees.activeCount = count ?? 0
      } catch (error) {
        console.error('Failed to load dashboard employee metrics:', error)
        employees.error = 'Failed to load employee metrics'
      }
    }

    const receipts: ReceiptsSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'receipts'),
      pendingCount: 0,
      cantFindCount: 0,
      needsAttention: 0,
      lastImportAt: null,
      openAiCost: null,
    }

    if (receipts.permitted) {
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

        if (statusError) {
          throw statusError
        }

        const countsRecord = Array.isArray(statusCounts) ? statusCounts[0] : statusCounts
        const pending = Number(countsRecord?.pending ?? 0)
        const cantFind = Number(countsRecord?.cant_find ?? 0)

        receipts.pendingCount = pending
        receipts.cantFindCount = cantFind
        receipts.needsAttention = pending + cantFind
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

    if (quotes.permitted) {
      try {
        const { data, error } = await supabase
          .from('quotes')
          .select('status, total_amount, valid_until')
          // Legacy datasets previously excluded soft-deleted rows. That column no longer exists,
          // so we trust the current row set returned by Supabase.

        if (error) {
          throw error
        }

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
    }

    const roles: RolesSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'roles'),
      totalRoles: 0,
    }

    if (roles.permitted) {
      try {
        const admin = createAdminClient()
        const { count, error } = await admin
          .from('roles')
          .select('id', { count: 'exact', head: true })

        if (error) {
          throw error
        }

        roles.totalRoles = count ?? 0
      } catch (error) {
        console.error('Failed to load dashboard role metrics:', error)
        roles.error = 'Failed to load role metrics'
      }
    }

    const shortLinks: ShortLinksSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'short_links'),
      activeCount: 0,
    }

    if (shortLinks.permitted) {
      try {
        const { count, error } = await supabase
          .from('short_links')
          .select('id', { count: 'exact', head: true })

        if (error) {
          throw error
        }

        shortLinks.activeCount = count ?? 0
      } catch (error) {
        console.error('Failed to load dashboard short link metrics:', error)
        shortLinks.error = 'Failed to load short link metrics'
      }
    }

    const usersSnapshot: UsersSnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'users'),
      totalUsers: 0,
    }

    if (usersSnapshot.permitted) {
      try {
        const { data, error } = await supabase.auth.admin.listUsers({
          perPage: 1,
          page: 1,
        })

        if (error) {
          throw error
        }

        const total = data?.total ?? data?.users?.length ?? 0
        usersSnapshot.totalUsers = total
      } catch (error) {
        console.error('Failed to load dashboard user metrics:', error)
        usersSnapshot.error = 'Failed to load user metrics'
      }
    }

    const loyalty: LoyaltySnapshot = {
      permitted: hasModuleAccess(permissionsMap, 'loyalty'),
    }

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
      tableBookings,
      parking,
      invoices,
      employees,
      receipts,
      quotes,
      roles,
      shortLinks,
      users: usersSnapshot,
      loyalty,
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
