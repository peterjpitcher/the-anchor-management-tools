import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { CalendarIcon, UsersIcon, PlusIcon, ChatBubbleLeftIcon, DocumentTextIcon, CurrencyPoundIcon, ClockIcon } from '@heroicons/react/24/outline'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { List, SimpleList } from '@/components/ui-v2/display/List'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'

async function getUpcomingEvents() {
  const supabase = getSupabaseAdminClient()
  const today = new Date().toISOString().split('T')[0]
  
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
  
  return events.map(event => ({
    ...event,
    bookingCount: event.bookings?.reduce((sum: number, booking: any) => sum + (booking.seats || 0), 0) || 0,
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
  const today = new Date().toISOString().split('T')[0]
  
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
  const today = new Date().toISOString().split('T')[0]
  
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
  const [events, stats, privateBookings, tableBookings, unpaidInvoices] = await Promise.all([
    getUpcomingEvents(),
    getStats(),
    getUpcomingPrivateBookings(),
    getUpcomingTableBookings(),
    getUnpaidInvoices()
  ])

  const todayEvents = events.filter(e => e.date === new Date().toISOString().split('T')[0])
  const upcomingEvents = events.filter(e => e.date !== new Date().toISOString().split('T')[0])

  return (
    <PageWrapper>
      <PageHeader 
        title="Dashboard" 
        subtitle="Welcome back! Here's what's happening today."
      />
      <PageContent>
      <div className="space-y-6">
      
      {/* Quick Stats */}
      <StatGroup>
        <Stat
          label="Today's Events"
          value={todayEvents.length}
        />
        <Stat
          label="Total Customers"
          value={stats.totalCustomers.toLocaleString()}
        />
        <Stat
          label="Unread Messages"
          value={stats.unreadMessages}
          href="/messages"
          change={stats.unreadMessages > 0 ? `${stats.unreadMessages} new` : undefined}
          changeType={stats.unreadMessages > 0 ? 'increase' : undefined}
        />
      </StatGroup>

      {/* Today's Events */}
      {todayEvents.length > 0 && (
        <Card 
          header={<CardTitle>Today&apos;s Events</CardTitle>}
        >
          <SimpleList
            items={todayEvents.map(event => ({
              id: event.id,
              title: event.name,
              subtitle: event.time,
              href: `/events/${event.id}`,
              meta: (
                <div className="flex items-center text-sm text-gray-500">
                  <UsersIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                  <span className="whitespace-nowrap">{event.bookingCount}/{event.capacity || '∞'}</span>
                </div>
              )
            }))}
          />
        </Card>
      )}

      {/* Upcoming Events */}
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
                  )
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

      {/* Private Bookings */}
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
                <Badge variant={booking.status === 'confirmed' ? 'success' : 'warning'} size="sm">
                  {booking.status}
                </Badge>
              )
            }))}
          />
        )}
      </Card>

      {/* Table Bookings */}
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
                      <Badge variant={booking.status === 'confirmed' ? 'success' : 'warning'} size="sm">
                        {booking.status}
                      </Badge>
                    )}
                  </div>
                )
              }
            })}
          />
        )}
      </Card>

      {/* Unpaid Invoices */}
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
              
              return {
                id: invoice.id,
                title: `Invoice #${invoice.invoice_number}`,
                subtitle: vendorName,
                href: `/invoices/${invoice.id}`,
                meta: (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center text-sm font-medium text-gray-900">
                      <CurrencyPoundIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                      <span>£{invoice.total_amount?.toFixed(2)}</span>
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
                )
              }
            })}
          />
        )}
      </Card>

      {/* Quick Actions */}
      <Section title="Quick Actions">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Link href="/events/new">
            <Card interactive className="text-center">
              <CalendarIcon className="h-10 w-10 sm:h-8 sm:w-8 mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-900">New Event</p>
            </Card>
          </Link>
          <Link href="/customers">
            <Card interactive className="text-center">
              <UsersIcon className="h-10 w-10 sm:h-8 sm:w-8 mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-900">Customers</p>
            </Card>
          </Link>
          <Link href="/messages">
            <Card interactive className="text-center relative">
              <div className="relative inline-block">
                <ChatBubbleLeftIcon className="h-10 w-10 sm:h-8 sm:w-8 mx-auto text-gray-400 mb-2" />
                {stats.unreadMessages > 0 && (
                  <Badge 
                    variant="error" 
                    size="sm" 
                    dot 
                    className="absolute -top-1 -right-1"
                  />
                )}
              </div>
              <p className="text-sm font-medium text-gray-900">Messages</p>
            </Card>
          </Link>
          <Link href="/private-bookings/new">
            <Card interactive className="text-center">
              <PlusIcon className="h-10 w-10 sm:h-8 sm:w-8 mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-900">Private Booking</p>
            </Card>
          </Link>
        </div>
      </Section>
      
      </div>
      </PageContent>
    </PageWrapper>
  )
}