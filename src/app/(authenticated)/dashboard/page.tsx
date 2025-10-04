import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import { formatDate, formatDateTime, getTodayIsoDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { CalendarIcon, UsersIcon, PlusIcon, ChatBubbleLeftIcon, CurrencyPoundIcon, TruckIcon } from '@heroicons/react/24/outline'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Stat } from '@/components/ui-v2/display/Stat'
import { Badge, type BadgeProps } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { SimpleList } from '@/components/ui-v2/display/List'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import type { ParkingBookingStatus, ParkingPaymentStatus } from '@/types/parking'

const PARKING_STATUS_LABELS: Record<ParkingBookingStatus, string> = {
  pending_payment: 'Pending payment',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

const PARKING_STATUS_VARIANTS = {
  pending_payment: 'warning',
  confirmed: 'success',
  completed: 'info',
  cancelled: 'error',
  expired: 'default',
} satisfies Record<ParkingBookingStatus, BadgeProps['variant']>

const PARKING_PAYMENT_LABELS: Record<ParkingPaymentStatus, string> = {
  pending: 'Payment pending',
  paid: 'Paid',
  refunded: 'Refunded',
  failed: 'Payment failed',
  expired: 'Payment expired',
}

const PARKING_PAYMENT_VARIANTS = {
  pending: 'warning',
  paid: 'success',
  refunded: 'info',
  failed: 'error',
  expired: 'default',
} satisfies Record<ParkingPaymentStatus, BadgeProps['variant']>

async function getUpcomingEvents() {
  const supabase = getSupabaseAdminClient()
  const today = getTodayIsoDate()
  
  const { data: events, error } = await supabase
    .from('events')
    .select(`
      id,
      name,
      date,
      time,
      capacity,
      bookings (id, seats)
    `)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('time', { ascending: true })
  
  if (error) {
    console.error('Error fetching events:', error)
    return []
  }
  
  type BookingSeat = { seats: number | null }
  return events.map(event => ({
    ...event,
    bookingCount: event.bookings?.reduce((sum: number, booking: BookingSeat) => sum + (booking.seats || 0), 0) || 0,
    bookings: undefined
  }))
}

async function getStats() {
  const supabase = getSupabaseAdminClient()
  
  const [customersResult, messagesResult] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true }),
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound').is('read_at', null)
  ])
  
  return {
    totalCustomers: customersResult.count || 0,
    unreadMessages: messagesResult.count || 0
  }
}

async function getUpcomingPrivateBookings() {
  const supabase = getSupabaseAdminClient()
  const today = getTodayIsoDate()
  
  const { data: bookings, error } = await supabase
    .from('private_bookings')
    .select(`
      id,
      customer_name,
      event_date,
      start_time,
      status,
      customer_id
    `)
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(5)
  
  if (error) {
    console.error('Error fetching private bookings:', error)
    return []
  }
  
  return bookings || []
}

async function getUpcomingTableBookings() {
  const supabase = getSupabaseAdminClient()
  const today = getTodayIsoDate()
  
  const { data: bookings, error } = await supabase
    .from('table_bookings')
    .select(`
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
    `)
    .gte('booking_date', today)
    .neq('status', 'cancelled')
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(5)
  
  if (error) {
    console.error('Error fetching table bookings:', error)
    return []
  }
  
  return bookings || []
}

async function getUpcomingParkingBookings() {
  const supabase = getSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  const { data: bookings, error } = await supabase
    .from('parking_bookings')
    .select(`
      id,
      reference,
      customer_first_name,
      customer_last_name,
      vehicle_registration,
      start_at,
      end_at,
      status,
      payment_status
    `)
    .gte('start_at', nowIso)
    .in('status', ['pending_payment', 'confirmed'])
    .order('start_at', { ascending: true })
    .limit(5)

  if (error) {
    console.error('Error fetching parking bookings:', error)
    return []
  }

  return bookings || []
}

async function getUnpaidInvoices() {
  const supabase = getSupabaseAdminClient()
  
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      total_amount,
      status,
      due_date,
      vendor:invoice_vendors(
        name
      )
    `)
    .neq('status', 'paid')
    .order('due_date', { ascending: true })
    .limit(5)
  
  if (error) {
    console.error('Error fetching unpaid invoices:', error)
    return []
  }
  
  return invoices || []
}

export default async function SimpleDashboardPage() {
  const [
    events,
    stats,
    privateBookings,
    tableBookings,
    parkingBookings,
    unpaidInvoices,
  ] = await Promise.all([
    getUpcomingEvents(),
    getStats(),
    getUpcomingPrivateBookings(),
    getUpcomingTableBookings(),
    getUpcomingParkingBookings(),
    getUnpaidInvoices(),
  ])

  const todayIsoDate = getTodayIsoDate()
  const todayEvents = events.filter((event) => event.date === todayIsoDate)
  const upcomingEvents = events.filter((event) => event.date !== todayIsoDate)

  const upcomingParking = parkingBookings
  const parkingTodayCount = upcomingParking.filter((booking) => booking.start_at?.slice(0, 10) === todayIsoDate).length
  const nextParkingBooking = upcomingParking[0]
  const pendingParkingPayments = upcomingParking.filter((booking) => booking.payment_status === 'pending').length

  const unpaidInvoiceCount = unpaidInvoices.length
  const overdueInvoicesCount = unpaidInvoices.filter((invoice) => {
    if (!invoice.due_date) return false
    return new Date(invoice.due_date) < new Date()
  }).length

  const nextEvent = upcomingEvents[0]

  const statsCards = [
    {
      key: 'events-today',
      label: "Today's events",
      value: todayEvents.length,
      icon: <CalendarIcon className="h-full w-full" />,
      description: nextEvent
        ? `Next: ${formatDate(new Date(nextEvent.date))} · ${nextEvent.time}`
        : 'No upcoming events scheduled',
      color: 'info',
    },
    {
      key: 'customers-total',
      label: 'Customers on file',
      value: stats.totalCustomers.toLocaleString(),
      icon: <UsersIcon className="h-full w-full" />,
      description: 'All active records',
      color: 'primary',
    },
    {
      key: 'messages-unread',
      label: 'Unread messages',
      value: stats.unreadMessages,
      icon: <ChatBubbleLeftIcon className="h-full w-full" />,
      description: stats.unreadMessages > 0 ? 'Waiting for a reply' : 'Inbox is clear',
      change: stats.unreadMessages > 0 ? `${stats.unreadMessages} new` : undefined,
      changeType: stats.unreadMessages > 0 ? 'increase' : undefined,
      color: 'warning',
      href: '/messages',
    },
    {
      key: 'parking-arrivals',
      label: 'Parking arrivals today',
      value: parkingTodayCount,
      icon: <TruckIcon className="h-full w-full" />,
      description: nextParkingBooking
        ? `Next arrival ${formatDateTime(nextParkingBooking.start_at)}`
        : 'No arrivals scheduled',
      change: pendingParkingPayments > 0 ? `${pendingParkingPayments} awaiting payment` : undefined,
      changeType: pendingParkingPayments > 0 ? 'neutral' : undefined,
      color: 'info',
    },
    {
      key: 'unpaid-invoices',
      label: 'Unpaid invoices',
      value: unpaidInvoiceCount,
      icon: <CurrencyPoundIcon className="h-full w-full" />,
      description: overdueInvoicesCount > 0 ? `${overdueInvoicesCount} overdue` : 'All on track',
      color: overdueInvoicesCount > 0 ? 'warning' : 'primary',
      href: '/invoices?status=unpaid',
    },
  ]

  const renderStatCard = (card: (typeof statsCards)[number], size: 'sm' | 'md' = 'md') => (
    <Stat
      key={card.key}
      label={card.label}
      value={card.value}
      icon={card.icon}
      description={card.description}
      change={card.change}
      changeType={card.changeType as 'increase' | 'decrease' | 'neutral' | undefined}
      variant="filled"
      color={card.color as 'error' | 'default' | 'success' | 'info' | 'primary' | 'warning' | undefined}
      size={size}
      href={card.href}
    />
  )

  return (
    <PageWrapper>
      <PageHeader
        title="Dashboard"
        subtitle="Welcome back! Here's what's happening today."
      />
      <PageContent>
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="-mx-2 sm:hidden">
              <div className="flex gap-3 px-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
                {statsCards.map((card) => (
                  <div key={card.key} className="flex-none w-[240px] snap-start">
                    {renderStatCard(card, 'sm')}
                  </div>
                ))}
              </div>
            </div>
            <div className="hidden sm:grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {statsCards.map((card) => renderStatCard(card))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[2fr,1fr]">
            <div className="space-y-4">
              {todayEvents.length > 0 && (
                <Card header={<CardTitle>Today&apos;s Events</CardTitle>}>
                  <SimpleList
                    items={todayEvents.map((event) => ({
                      id: event.id,
                      title: event.name,
                      subtitle: event.time,
                      href: `/events/${event.id}`,
                      meta: (
                        <div className="flex items-center text-sm text-gray-500">
                          <UsersIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                          <span className="whitespace-nowrap">{event.bookingCount}/{event.capacity || '∞'}</span>
                        </div>
                      ),
                    }))}
                  />
                </Card>
              )}

              <Card
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Upcoming Events</CardTitle>
                    <LinkButton href="/events" variant="secondary" size="sm">
                      View all
                    </LinkButton>
                  </div>
                }
              >
                {upcomingEvents.length === 0 ? (
                  <EmptyState
                    title="No upcoming events"
                    description="No events are scheduled yet."
                    action={
                      <LinkButton href="/events/new" variant="primary">
                        Create Event
                      </LinkButton>
                    }
                  />
                ) : (
                  <>
                    <SimpleList
                      items={upcomingEvents.slice(0, 10).map((event) => {
                        const eventDate = new Date(event.date)
                        const isThisWeek = eventDate.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000

                        return {
                          id: event.id,
                          title: event.name,
                          subtitle: `${formatDate(eventDate)} at ${event.time}`,
                          href: `/events/${event.id}`,
                          meta: (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center text-sm text-gray-500">
                                <UsersIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                                <span className="whitespace-nowrap">{event.bookingCount}/{event.capacity || '∞'}</span>
                              </div>
                              {isThisWeek && <Badge variant="warning" size="sm">This week</Badge>}
                            </div>
                          ),
                        }
                      })}
                    />
                    {upcomingEvents.length > 10 && (
                      <div className="text-center pt-4">
                        <Badge variant="secondary" size="sm">
                          +{upcomingEvents.length - 10} more events
                        </Badge>
                      </div>
                    )}
                  </>
                )}
              </Card>

              <Card
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Upcoming Private Bookings</CardTitle>
                    <LinkButton href="/private-bookings" variant="secondary" size="sm">
                      View all
                    </LinkButton>
                  </div>
                }
              >
                {privateBookings.length === 0 ? (
                  <EmptyState
                    title="No upcoming private bookings"
                    description="No private bookings are scheduled yet."
                    action={
                      <LinkButton href="/private-bookings/new" variant="primary">
                        Create Booking
                      </LinkButton>
                    }
                  />
                ) : (
                  <SimpleList
                    items={privateBookings.map((booking) => ({
                      id: booking.id,
                      title: booking.customer_name,
                      subtitle: `${formatDate(new Date(booking.event_date))} at ${booking.start_time}`,
                      href: `/private-bookings/${booking.id}`,
                      meta: (
                        <Badge
                          variant={booking.status === 'confirmed' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {booking.status}
                        </Badge>
                      ),
                    }))}
                  />
                )}
              </Card>

              <Card
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Upcoming Table Bookings</CardTitle>
                    <LinkButton href="/table-bookings" variant="secondary" size="sm">
                      View all
                    </LinkButton>
                  </div>
                }
              >
                {tableBookings.length === 0 ? (
                  <EmptyState
                    title="No upcoming table bookings"
                    description="No table bookings are scheduled yet."
                    action={
                      <LinkButton href="/table-bookings/new" variant="primary">
                        Create Booking
                      </LinkButton>
                    }
                  />
                ) : (
                  <SimpleList
                    items={tableBookings.map((booking) => {
                      const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers
                      const customerName = customer
                        ? `${customer.first_name} ${customer.last_name}`
                        : 'Unknown Customer'
                      return {
                        id: booking.id,
                        title: customerName,
                        subtitle: `${formatDate(new Date(booking.booking_date))} at ${booking.booking_time}`,
                        href: `/table-bookings/${booking.id}`,
                        meta: (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center text-sm text-gray-500">
                              <UsersIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                              <span className="whitespace-nowrap">{booking.party_size} guests</span>
                            </div>
                            {booking.status && (
                              <Badge
                                variant={booking.status === 'confirmed' ? 'success' : 'warning'}
                                size="sm"
                              >
                                {booking.status}
                              </Badge>
                            )}
                          </div>
                        ),
                      }
                    })}
                  />
                )}
              </Card>
            </div>

            <div className="space-y-4">
              <Card
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Upcoming Car Parking</CardTitle>
                    <LinkButton href="/parking" variant="secondary" size="sm">
                      Manage parking
                    </LinkButton>
                  </div>
                }
              >
                {upcomingParking.length === 0 ? (
                  <EmptyState
                    title="No upcoming parking bookings"
                    description="No arrivals scheduled for the next few days."
                    action={
                      <LinkButton href="/parking" variant="primary">
                        Open parking
                      </LinkButton>
                    }
                  />
                ) : (
                  <SimpleList
                    items={upcomingParking.map((booking) => {
                      const customerName = [
                        booking.customer_first_name,
                        booking.customer_last_name,
                      ]
                        .filter(Boolean)
                        .join(' ')
                        .trim() || booking.vehicle_registration?.toUpperCase() || 'Parking booking'

                      return {
                        id: booking.id,
                        title: customerName,
                        subtitle: `${formatDateTime(booking.start_at)} · ${booking.vehicle_registration?.toUpperCase() ?? 'Unknown vehicle'}`,
                        href: '/parking',
                        meta: (
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={PARKING_STATUS_VARIANTS[booking.status as ParkingBookingStatus]}
                              size="sm"
                            >
                              {PARKING_STATUS_LABELS[booking.status as ParkingBookingStatus]}
                            </Badge>
                            <Badge
                              variant={PARKING_PAYMENT_VARIANTS[booking.payment_status as ParkingPaymentStatus]}
                              size="sm"
                            >
                              {PARKING_PAYMENT_LABELS[booking.payment_status as ParkingPaymentStatus]}
                            </Badge>
                          </div>
                        ),
                      }
                    })}
                  />
                )}
              </Card>

              <Card
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Recent Unpaid Invoices</CardTitle>
                    <LinkButton href="/invoices?status=unpaid" variant="secondary" size="sm">
                      View all
                    </LinkButton>
                  </div>
                }
              >
                {unpaidInvoices.length === 0 ? (
                  <EmptyState
                    title="No unpaid invoices"
                    description="All invoices are up to date."
                  />
                ) : (
                  <SimpleList
                    items={unpaidInvoices.map((invoice) => {
                      const isOverdue = invoice.due_date && new Date(invoice.due_date) < new Date()
                      const vendor = Array.isArray(invoice.vendor) ? invoice.vendor[0] : invoice.vendor
                      const vendorName = vendor?.name || 'Unknown Vendor'
                      const totalAmount = invoice.total_amount != null ? Number(invoice.total_amount) : null
                      const formattedTotal = totalAmount != null && Number.isFinite(totalAmount)
                        ? totalAmount.toFixed(2)
                        : '0.00'

                      return {
                        id: invoice.id,
                        title: `Invoice #${invoice.invoice_number}`,
                        subtitle: vendorName,
                        href: `/invoices/${invoice.id}`,
                        meta: (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center text-sm font-medium text-gray-900">
                              <CurrencyPoundIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                              <span>£{formattedTotal}</span>
                            </div>
                            {invoice.due_date && (
                              <Badge
                                variant={isOverdue ? 'error' : 'warning'}
                                size="sm"
                              >
                                {isOverdue ? 'Overdue' : `Due ${formatDate(new Date(invoice.due_date))}`}
                              </Badge>
                            )}
                          </div>
                        ),
                      }
                    })}
                  />
                )}
              </Card>

              <Card header={<CardTitle>Quick Actions</CardTitle>}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Link href="/events/new">
                    <Card interactive className="text-center" padding="sm">
                      <CalendarIcon className="h-8 w-8 sm:h-10 sm:w-10 mx-auto text-gray-400 mb-1 sm:mb-2" />
                      <p className="text-xs sm:text-sm font-medium text-gray-900">New Event</p>
                    </Card>
                  </Link>
                  <Link href="/customers">
                    <Card interactive className="text-center" padding="sm">
                      <UsersIcon className="h-8 w-8 sm:h-10 sm:w-10 mx-auto text-gray-400 mb-1 sm:mb-2" />
                      <p className="text-xs sm:text-sm font-medium text-gray-900">Customers</p>
                    </Card>
                  </Link>
                  <Link href="/messages">
                    <Card interactive className="text-center relative" padding="sm">
                      <div className="relative inline-block">
                        <ChatBubbleLeftIcon className="h-8 w-8 sm:h-10 sm:w-10 mx-auto text-gray-400 mb-1 sm:mb-2" />
                        {stats.unreadMessages > 0 && (
                          <Badge
                            variant="error"
                            size="sm"
                            dot
                            className="absolute -top-1 -right-1"
                          />
                        )}
                      </div>
                      <p className="text-xs sm:text-sm font-medium text-gray-900">Messages</p>
                    </Card>
                  </Link>
                  <Link href="/private-bookings/new">
                    <Card interactive className="text-center" padding="sm">
                      <PlusIcon className="h-8 w-8 sm:h-10 sm:w-10 mx-auto text-gray-400 mb-1 sm:mb-2" />
                      <p className="text-xs sm:text-sm font-medium text-gray-900">Private Booking</p>
                    </Card>
                  </Link>
                  <Link href="/parking">
                    <Card interactive className="text-center" padding="sm">
                      <TruckIcon className="h-8 w-8 sm:h-10 sm:w-10 mx-auto text-gray-400 mb-1 sm:mb-2" />
                      <p className="text-xs sm:text-sm font-medium text-gray-900">Parking</p>
                    </Card>
                  </Link>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </PageContent>
    </PageWrapper>
  )
}
