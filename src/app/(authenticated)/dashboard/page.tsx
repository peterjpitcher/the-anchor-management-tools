import type { ReactNode } from 'react'
import Link from 'next/link'
import { CalendarIcon, UsersIcon, ChatBubbleLeftIcon, CurrencyPoundIcon, TruckIcon } from '@heroicons/react/24/outline'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Stat } from '@/components/ui-v2/display/Stat'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { SimpleList } from '@/components/ui-v2/display/List'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import type { BadgeProps } from '@/components/ui-v2/display/Badge'
import { formatDate, formatDateTime } from '@/lib/dateUtils'
import { loadDashboardSnapshot, type DashboardSnapshot } from './dashboard-data'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

type SectionSummary = {
  id: string
  label: string
  href?: string
  permitted: boolean
  subtitle: string
  badgeVariant: BadgeProps['variant']
  badgeText: string
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
})

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : '0'
}

function buildSectionSummaries(snapshot: DashboardSnapshot): SectionSummary[] {
  const summaries: SectionSummary[] = []

  const eventsSubtitle = snapshot.events.permitted
    ? snapshot.events.error
      ? snapshot.events.error
      : `${formatNumber(snapshot.events.today.length)} today · ${formatNumber(snapshot.events.totalUpcoming)} upcoming`
    : 'Requires events:view permission'
  summaries.push({
    id: 'events',
    label: 'Events',
    href: snapshot.events.permitted ? '/events' : undefined,
    permitted: snapshot.events.permitted,
    subtitle: eventsSubtitle,
    badgeVariant: snapshot.events.permitted
      ? snapshot.events.error
        ? 'warning'
        : 'success'
      : 'secondary',
    badgeText: snapshot.events.permitted
      ? snapshot.events.error
        ? 'Issue'
        : 'Accessible'
      : 'Restricted',
  })

  const customersSubtitle = snapshot.customers.permitted
    ? snapshot.customers.error
      ? snapshot.customers.error
      : `${formatNumber(snapshot.customers.total)} on file · ${formatNumber(snapshot.customers.newThisWeek)} new this week`
    : 'Requires customers:view permission'
  summaries.push({
    id: 'customers',
    label: 'Customers',
    href: snapshot.customers.permitted ? '/customers' : undefined,
    permitted: snapshot.customers.permitted,
    subtitle: customersSubtitle,
    badgeVariant: snapshot.customers.permitted
      ? snapshot.customers.error
        ? 'warning'
        : 'success'
      : 'secondary',
    badgeText: snapshot.customers.permitted
      ? snapshot.customers.error
        ? 'Issue'
        : 'Accessible'
      : 'Restricted',
  })

  const messagesSubtitle = snapshot.messages.permitted
    ? snapshot.messages.error
      ? snapshot.messages.error
      : `${formatNumber(snapshot.messages.unread)} unread conversations`
    : 'Requires messages:view permission'
  summaries.push({
    id: 'messages',
    label: 'Messages',
    href: snapshot.messages.permitted ? '/messages' : undefined,
    permitted: snapshot.messages.permitted,
    subtitle: messagesSubtitle,
    badgeVariant: snapshot.messages.permitted
      ? snapshot.messages.error
        ? 'warning'
        : snapshot.messages.unread > 0
          ? 'warning'
          : 'success'
      : 'secondary',
    badgeText: snapshot.messages.permitted
      ? snapshot.messages.error
        ? 'Issue'
        : snapshot.messages.unread > 0
          ? 'Attention'
          : 'Accessible'
      : 'Restricted',
  })

  const privateBookingSubtitle = snapshot.privateBookings.permitted
    ? snapshot.privateBookings.error
      ? snapshot.privateBookings.error
      : `${formatNumber(snapshot.privateBookings.totalUpcoming)} upcoming bookings`
    : 'Requires private_bookings:view permission'
  summaries.push({
    id: 'private-bookings',
    label: 'Private Bookings',
    href: snapshot.privateBookings.permitted ? '/private-bookings' : undefined,
    permitted: snapshot.privateBookings.permitted,
    subtitle: privateBookingSubtitle,
    badgeVariant: snapshot.privateBookings.permitted
      ? snapshot.privateBookings.error
        ? 'warning'
        : 'success'
      : 'secondary',
    badgeText: snapshot.privateBookings.permitted
      ? snapshot.privateBookings.error
        ? 'Issue'
        : 'Accessible'
      : 'Restricted',
  })

  const tableBookingSubtitle = snapshot.tableBookings.permitted
    ? snapshot.tableBookings.error
      ? snapshot.tableBookings.error
      : `${formatNumber(snapshot.tableBookings.totalUpcoming)} upcoming bookings`
    : 'Requires table_bookings:view permission'
  summaries.push({
    id: 'table-bookings',
    label: 'Table Bookings',
    href: snapshot.tableBookings.permitted ? '/table-bookings' : undefined,
    permitted: snapshot.tableBookings.permitted,
    subtitle: tableBookingSubtitle,
    badgeVariant: snapshot.tableBookings.permitted
      ? snapshot.tableBookings.error
        ? 'warning'
        : 'success'
      : 'secondary',
    badgeText: snapshot.tableBookings.permitted
      ? snapshot.tableBookings.error
        ? 'Issue'
        : 'Accessible'
      : 'Restricted',
  })

  const parkingSubtitle = snapshot.parking.permitted
    ? snapshot.parking.error
      ? snapshot.parking.error
      : `${formatNumber(snapshot.parking.arrivalsToday)} arrivals today · ${formatNumber(snapshot.parking.totalUpcoming)} upcoming`
    : 'Requires parking:view permission'
  summaries.push({
    id: 'parking',
    label: 'Parking',
    href: snapshot.parking.permitted ? '/parking' : undefined,
    permitted: snapshot.parking.permitted,
    subtitle: parkingSubtitle,
    badgeVariant: snapshot.parking.permitted
      ? snapshot.parking.error
        ? 'warning'
        : snapshot.parking.pendingPayments > 0
          ? 'warning'
          : 'success'
      : 'secondary',
    badgeText: snapshot.parking.permitted
      ? snapshot.parking.error
        ? 'Issue'
        : snapshot.parking.pendingPayments > 0
          ? 'Attention'
          : 'Accessible'
      : 'Restricted',
  })

  const invoicesSubtitle = snapshot.invoices.permitted
    ? snapshot.invoices.error
      ? snapshot.invoices.error
      : `${formatNumber(snapshot.invoices.unpaidCount)} unpaid · ${formatNumber(snapshot.invoices.overdueCount)} overdue`
    : 'Requires invoices:view permission'
  summaries.push({
    id: 'invoices',
    label: 'Invoices',
    href: snapshot.invoices.permitted ? '/invoices' : undefined,
    permitted: snapshot.invoices.permitted,
    subtitle: invoicesSubtitle,
    badgeVariant: snapshot.invoices.permitted
      ? snapshot.invoices.error
        ? 'warning'
        : snapshot.invoices.overdueCount > 0
          ? 'warning'
          : 'success'
      : 'secondary',
    badgeText: snapshot.invoices.permitted
      ? snapshot.invoices.error
        ? 'Issue'
        : snapshot.invoices.overdueCount > 0
          ? 'Attention'
          : 'Accessible'
      : 'Restricted',
  })

  const receiptsSubtitle = snapshot.receipts.permitted
    ? snapshot.receipts.error
      ? snapshot.receipts.error
      : `${formatNumber(snapshot.receipts.needsAttention)} need review`
    : 'Requires receipts:view permission'
  summaries.push({
    id: 'receipts',
    label: 'Receipts',
    href: snapshot.receipts.permitted ? '/receipts' : undefined,
    permitted: snapshot.receipts.permitted,
    subtitle: receiptsSubtitle,
    badgeVariant: snapshot.receipts.permitted
      ? snapshot.receipts.error
        ? 'warning'
        : snapshot.receipts.needsAttention > 0
          ? 'warning'
          : 'success'
      : 'secondary',
    badgeText: snapshot.receipts.permitted
      ? snapshot.receipts.error
        ? 'Issue'
        : snapshot.receipts.needsAttention > 0
          ? 'Attention'
          : 'Accessible'
      : 'Restricted',
  })

  const quotesSubtitle = snapshot.quotes.permitted
    ? snapshot.quotes.error
      ? snapshot.quotes.error
      : `Pending ${currencyFormatter.format(snapshot.quotes.totalPendingValue)} · ${snapshot.quotes.draftCount} drafts`
    : 'Requires quotes or invoices permissions'
  summaries.push({
    id: 'quotes',
    label: 'Quotes',
    href: snapshot.quotes.permitted ? '/quotes' : undefined,
    permitted: snapshot.quotes.permitted,
    subtitle: quotesSubtitle,
    badgeVariant: snapshot.quotes.permitted
      ? snapshot.quotes.error
        ? 'warning'
        : snapshot.quotes.totalPendingValue > 0
          ? 'warning'
          : 'success'
      : 'secondary',
    badgeText: snapshot.quotes.permitted
      ? snapshot.quotes.error
        ? 'Issue'
        : snapshot.quotes.totalPendingValue > 0
          ? 'Attention'
          : 'Accessible'
      : 'Restricted',
  })

  const employeesSubtitle = snapshot.employees.permitted
    ? snapshot.employees.error
      ? snapshot.employees.error
      : `${formatNumber(snapshot.employees.activeCount)} active employees`
    : 'Requires employees:view permission'
  summaries.push({
    id: 'employees',
    label: 'Employees',
    href: snapshot.employees.permitted ? '/employees' : undefined,
    permitted: snapshot.employees.permitted,
    subtitle: employeesSubtitle,
    badgeVariant: snapshot.employees.permitted
      ? snapshot.employees.error
        ? 'warning'
        : 'success'
      : 'secondary',
    badgeText: snapshot.employees.permitted
      ? snapshot.employees.error
        ? 'Issue'
        : 'Accessible'
      : 'Restricted',
  })

  const rolesSubtitle = snapshot.roles.permitted
    ? snapshot.roles.error
      ? snapshot.roles.error
      : `${formatNumber(snapshot.roles.totalRoles)} roles defined`
    : 'Requires roles:view permission'
  summaries.push({
    id: 'roles',
    label: 'Roles',
    href: snapshot.roles.permitted ? '/roles' : undefined,
    permitted: snapshot.roles.permitted,
    subtitle: rolesSubtitle,
    badgeVariant: snapshot.roles.permitted
      ? snapshot.roles.error
        ? 'warning'
        : 'success'
      : 'secondary',
    badgeText: snapshot.roles.permitted
      ? snapshot.roles.error
        ? 'Issue'
        : 'Accessible'
      : 'Restricted',
  })

  const shortLinksSubtitle = snapshot.shortLinks.permitted
    ? snapshot.shortLinks.error
      ? snapshot.shortLinks.error
      : `${formatNumber(snapshot.shortLinks.activeCount)} active links`
    : 'Requires short_links:view permission'
  summaries.push({
    id: 'short-links',
    label: 'Short Links',
    href: snapshot.shortLinks.permitted ? '/short-links' : undefined,
    permitted: snapshot.shortLinks.permitted,
    subtitle: shortLinksSubtitle,
    badgeVariant: snapshot.shortLinks.permitted
      ? snapshot.shortLinks.error
        ? 'warning'
        : 'success'
      : 'secondary',
    badgeText: snapshot.shortLinks.permitted
      ? snapshot.shortLinks.error
        ? 'Issue'
        : 'Accessible'
      : 'Restricted',
  })

  const usersSubtitle = snapshot.users.permitted
    ? snapshot.users.error
      ? snapshot.users.error
      : `${formatNumber(snapshot.users.totalUsers)} users`
    : 'Requires users:view permission'
  summaries.push({
    id: 'users',
    label: 'Users',
    href: snapshot.users.permitted ? '/users' : undefined,
    permitted: snapshot.users.permitted,
    subtitle: usersSubtitle,
    badgeVariant: snapshot.users.permitted
      ? snapshot.users.error
        ? 'warning'
        : 'success'
      : 'secondary',
    badgeText: snapshot.users.permitted
      ? snapshot.users.error
        ? 'Issue'
        : 'Accessible'
      : 'Restricted',
  })

  summaries.push({
    id: 'profile',
    label: 'Profile',
    href: '/profile',
    permitted: true,
    subtitle: snapshot.user.lastSignInAt
      ? `Last signed in ${formatDateTime(snapshot.user.lastSignInAt)}`
      : 'No recent sign-in recorded',
    badgeVariant: 'success',
    badgeText: 'Accessible',
  })

  summaries.push({
    id: 'loyalty',
    label: 'Loyalty',
    permitted: snapshot.loyalty.permitted,
    subtitle: snapshot.loyalty.permitted
      ? 'Legacy tools accessible'
      : 'Feature decommissioned',
    badgeVariant: snapshot.loyalty.permitted ? 'warning' : 'default',
    badgeText: snapshot.loyalty.permitted ? 'Legacy' : 'Removed',
  })

  summaries.push({
    id: 'unauthorized',
    label: 'Unauthorized',
    href: '/unauthorized',
    permitted: true,
    subtitle: 'System route for denied access handling',
    badgeVariant: 'default',
    badgeText: 'System',
  })

  return summaries
}

export default async function DashboardPage() {
  const snapshot = await loadDashboardSnapshot()

  const statsCards: Array<{
    key: string
    label: string
    value: number | string
    icon: ReactNode
    description?: string
    change?: string
    changeType?: 'increase' | 'decrease' | 'neutral'
    color?: 'error' | 'default' | 'success' | 'info' | 'primary' | 'warning'
    href?: string
  }> = []

  if (snapshot.events.permitted) {
    statsCards.push({
      key: 'events-today',
      label: "Today's events",
      value: snapshot.events.today.length,
      icon: <CalendarIcon className="h-full w-full" />,
      description: snapshot.events.nextUpcoming
        ? `Next: ${snapshot.events.nextUpcoming.time ?? 'TBC'} on ${snapshot.events.nextUpcoming.date ? formatDate(new Date(snapshot.events.nextUpcoming.date)) : 'unknown date'}`
        : 'No upcoming events scheduled',
      color: 'info',
      href: '/events',
    })
  }

  if (snapshot.customers.permitted) {
    statsCards.push({
      key: 'customers-total',
      label: 'Customers on file',
      value: snapshot.customers.total.toLocaleString(),
      icon: <UsersIcon className="h-full w-full" />,
      description: snapshot.customers.newThisWeek > 0
        ? `${snapshot.customers.newThisWeek} added this week`
        : 'No new customers in the last 7 days',
      color: 'primary',
      href: '/customers',
    })
  }

  if (snapshot.messages.permitted) {
    statsCards.push({
      key: 'messages-unread',
      label: 'Unread messages',
      value: snapshot.messages.unread,
      icon: <ChatBubbleLeftIcon className="h-full w-full" />,
      description: snapshot.messages.unread > 0 ? 'Waiting for a reply' : 'Inbox is clear',
      change: snapshot.messages.unread > 0 ? `${snapshot.messages.unread} new` : undefined,
      changeType: snapshot.messages.unread > 0 ? 'increase' : undefined,
      color: snapshot.messages.unread > 0 ? 'warning' : 'info',
      href: '/messages',
    })
  }

  if (snapshot.parking.permitted) {
    statsCards.push({
      key: 'parking-arrivals',
      label: 'Parking arrivals today',
      value: snapshot.parking.arrivalsToday,
      icon: <TruckIcon className="h-full w-full" />,
      description: snapshot.parking.nextBooking?.start_at
        ? `Next arrival ${formatDateTime(snapshot.parking.nextBooking.start_at)}`
        : 'No arrivals scheduled',
      change: snapshot.parking.pendingPayments > 0 ? `${snapshot.parking.pendingPayments} awaiting payment` : undefined,
      changeType: snapshot.parking.pendingPayments > 0 ? 'neutral' : undefined,
      color: 'info',
      href: '/parking',
    })
  }

  if (snapshot.invoices.permitted) {
    statsCards.push({
      key: 'unpaid-invoices',
      label: 'Unpaid invoices',
      value: snapshot.invoices.unpaidCount,
      icon: <CurrencyPoundIcon className="h-full w-full" />,
      description: snapshot.invoices.overdueCount > 0 ? `${snapshot.invoices.overdueCount} overdue` : 'All on track',
      color: snapshot.invoices.overdueCount > 0 ? 'warning' : 'primary',
      href: '/invoices?status=unpaid',
    })
  }

  if (snapshot.employees.permitted) {
    statsCards.push({
      key: 'employees-active',
      label: 'Active employees',
      value: snapshot.employees.activeCount,
      icon: <UsersIcon className="h-full w-full" />,
      description: 'Currently active staff',
      color: 'success',
      href: '/employees',
    })
  }

  if (snapshot.receipts.permitted) {
    statsCards.push({
      key: 'receipts-attention',
      label: 'Receipts needing review',
      value: snapshot.receipts.needsAttention,
      icon: <ReceiptIcon />,
      description: snapshot.receipts.needsAttention > 0
        ? `${snapshot.receipts.pendingCount} pending · ${snapshot.receipts.cantFindCount} missing`
        : 'All receipts reconciled',
      color: snapshot.receipts.needsAttention > 0 ? 'warning' : 'success',
      href: '/receipts',
    })
  }

  const sectionSummaries = buildSectionSummaries(snapshot)

  const renderStatCard = (
    card: (typeof statsCards)[number],
    size: 'sm' | 'md' = 'md',
  ) => (
    <Stat
      key={card.key}
      label={card.label}
      value={card.value}
      icon={card.icon}
      description={card.description}
      change={card.change}
      changeType={card.changeType}
      variant="filled"
      color={card.color}
      size={size}
      href={card.href}
    />
  )

  const navItems: HeaderNavItem[] = [
    { label: 'Overview', href: '#metrics' },
    { label: 'Operations', href: '#operations' },
    { label: 'Finance', href: '#finance' },
  ]

  return (
    <PageLayout
      title="Dashboard"
      subtitle="Welcome back! Here's what's happening today."
      navItems={navItems}
    >
      <div className="space-y-6">
        <section id="metrics" className="space-y-3">
          {statsCards.length > 0 ? (
            <>
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
            </>
          ) : (
            <Card>
              <EmptyState
                title="No metrics available"
                description="You do not have access to any dashboard metrics yet."
              />
            </Card>
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-[2fr,1fr]">
          <section id="operations" className="space-y-4">
            {snapshot.events.permitted && snapshot.events.today.length > 0 && (
              <Card header={<CardTitle>Today&apos;s Events</CardTitle>}>
                <SimpleList
                  items={snapshot.events.today.map((event) => ({
                    id: event.id,
                      title: event.name,
                      subtitle: event.time ?? 'Time TBC',
                      href: `/events/${event.id}`,
                      meta: (
                        <div className="flex items-center text-sm text-gray-500">
                          <UsersIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                          <span className="whitespace-nowrap">
                            {event.bookingCount}/{event.capacity ?? '∞'}
                          </span>
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
                    {snapshot.events.permitted && (
                      <LinkButton href="/events" variant="secondary" size="sm">
                        View all
                      </LinkButton>
                    )}
                  </div>
                }
              >
                {!snapshot.events.permitted ? (
                  <EmptyState
                    title="Events access restricted"
                    description="You need the events:view permission to see upcoming events."
                  />
                ) : snapshot.events.error ? (
                  <EmptyState
                    title="Events unavailable"
                    description={snapshot.events.error}
                  />
                ) : snapshot.events.upcoming.length === 0 ? (
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
                      items={snapshot.events.upcoming.slice(0, 10).map((event) => {
                        const eventDate = event.date ? new Date(event.date) : null
                        const isThisWeek =
                          eventDate != null && eventDate.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000

                        return {
                          id: event.id,
                          title: event.name,
                          subtitle: eventDate
                            ? `${formatDate(eventDate)} at ${event.time ?? 'TBC'}`
                            : `Date TBC at ${event.time ?? 'TBC'}`,
                          href: `/events/${event.id}`,
                          meta: (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center text-sm text-gray-500">
                                <UsersIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                                <span className="whitespace-nowrap">
                                  {event.bookingCount}/{event.capacity ?? '∞'}
                                </span>
                              </div>
                              {isThisWeek && <Badge variant="warning" size="sm">This week</Badge>}
                            </div>
                          ),
                        }
                      })}
                    />
                    {snapshot.events.totalUpcoming > 10 && (
                      <div className="text-center pt-4">
                        <Badge variant="secondary" size="sm">
                          +{snapshot.events.totalUpcoming - 10} more events
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
                    {snapshot.privateBookings.permitted && (
                      <LinkButton href="/private-bookings" variant="secondary" size="sm">
                        View all
                      </LinkButton>
                    )}
                  </div>
                }
              >
                {!snapshot.privateBookings.permitted ? (
                  <EmptyState
                    title="Private bookings access restricted"
                    description="You need the private_bookings:view permission to see this data."
                  />
                ) : snapshot.privateBookings.error ? (
                  <EmptyState
                    title="Private bookings unavailable"
                    description={snapshot.privateBookings.error}
                  />
                ) : snapshot.privateBookings.upcoming.length === 0 ? (
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
                    items={snapshot.privateBookings.upcoming.map((booking) => ({
                      id: booking.id,
                      title: booking.customer_name ?? 'Unknown customer',
                      subtitle: `${booking.event_date ? formatDate(new Date(booking.event_date)) : 'Date TBC'} at ${booking.start_time ?? 'TBC'}`,
                      href: `/private-bookings/${booking.id}`,
                      meta: (
                        <Badge
                          variant={booking.status === 'confirmed' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {booking.status ?? 'pending'}
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
                    {snapshot.tableBookings.permitted && (
                      <LinkButton href="/table-bookings" variant="secondary" size="sm">
                        View all
                      </LinkButton>
                    )}
                  </div>
                }
              >
                {!snapshot.tableBookings.permitted ? (
                  <EmptyState
                    title="Table bookings access restricted"
                    description="You need the table_bookings:view permission to see this data."
                  />
                ) : snapshot.tableBookings.error ? (
                  <EmptyState
                    title="Table bookings unavailable"
                    description={snapshot.tableBookings.error}
                  />
                ) : snapshot.tableBookings.upcoming.length === 0 ? (
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
                    items={snapshot.tableBookings.upcoming.map((booking) => {
                      const customer = Array.isArray(booking.customers)
                        ? booking.customers[0]
                        : booking.customers
                      const customerName = customer
                        ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'Unknown customer'
                        : 'Unknown customer'
                      return {
                        id: booking.id,
                        title: customerName,
                        subtitle: `${booking.booking_date ? formatDate(new Date(booking.booking_date)) : 'Date TBC'} at ${booking.booking_time ?? 'TBC'}`,
                        href: `/table-bookings/${booking.id}`,
                        meta: (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center text-sm text-gray-500">
                              <UsersIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                              <span className="whitespace-nowrap">
                                {booking.party_size ?? 0} guests
                              </span>
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
          </section>

          <section id="finance" className="space-y-4">
              <Card
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Upcoming Car Parking</CardTitle>
                    {snapshot.parking.permitted && (
                      <LinkButton href="/parking" variant="secondary" size="sm">
                        Manage parking
                      </LinkButton>
                    )}
                  </div>
                }
              >
                {!snapshot.parking.permitted ? (
                  <EmptyState
                    title="Parking access restricted"
                    description="You need the parking:view permission to see this data."
                  />
                ) : snapshot.parking.error ? (
                  <EmptyState
                    title="Parking bookings unavailable"
                    description={snapshot.parking.error}
                  />
                ) : snapshot.parking.upcoming.length === 0 ? (
                  <EmptyState
                    title="No upcoming parking bookings"
                    description="No arrivals scheduled for the next few days."
                  />
                ) : (
                  <SimpleList
                    items={snapshot.parking.upcoming.map((booking) => ({
                      id: booking.id,
                      title: booking.reference ?? 'No reference',
                      subtitle: booking.start_at ? formatDateTime(booking.start_at) : 'Start time TBC',
                      href: `/parking/${booking.id}`,
                      meta: (
                        <div className="flex items-center gap-2">
                          {booking.status && (
                            <Badge
                              variant={booking.status === 'confirmed' ? 'success' : 'warning'}
                              size="sm"
                            >
                              {booking.status}
                            </Badge>
                          )}
                          {booking.payment_status && (
                            <Badge
                              variant={
                                booking.payment_status === 'paid'
                                  ? 'success'
                                  : booking.payment_status === 'pending'
                                    ? 'warning'
                                    : 'default'
                              }
                              size="sm"
                            >
                              {booking.payment_status}
                            </Badge>
                          )}
                        </div>
                      ),
                    }))}
                  />
                )}
              </Card>

              <Card
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Recent Unpaid Invoices</CardTitle>
                    {snapshot.invoices.permitted && (
                      <LinkButton href="/invoices?status=unpaid" variant="secondary" size="sm">
                        View all
                      </LinkButton>
                    )}
                  </div>
                }
              >
                {!snapshot.invoices.permitted ? (
                  <EmptyState
                    title="Invoices access restricted"
                    description="You need the invoices:view permission to see this data."
                  />
                ) : snapshot.invoices.error ? (
                  <EmptyState
                    title="Invoices unavailable"
                    description={snapshot.invoices.error}
                  />
                ) : snapshot.invoices.unpaid.length === 0 ? (
                  <EmptyState
                    title="No unpaid invoices"
                    description="All invoices are up to date."
                  />
                ) : (
                  <SimpleList
                    items={snapshot.invoices.unpaid.map((invoice) => {
                      const vendor = Array.isArray(invoice.vendor) ? invoice.vendor[0] : invoice.vendor
                      const vendorName = vendor?.name ?? 'Unknown vendor'
                      const formattedTotal =
                        invoice.total_amount != null && Number.isFinite(invoice.total_amount)
                          ? currencyFormatter.format(invoice.total_amount)
                          : currencyFormatter.format(0)
                      const isOverdue =
                        invoice.due_date != null && new Date(invoice.due_date) < new Date()

                      return {
                        id: invoice.id,
                        title: `Invoice #${invoice.invoice_number ?? '—'}`,
                        subtitle: vendorName,
                        href: `/invoices/${invoice.id}`,
                        meta: (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center text-sm font-medium text-gray-900">
                              <CurrencyPoundIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                              <span>{formattedTotal}</span>
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

              <Card header={<CardTitle>Section Snapshot</CardTitle>}>
                <SimpleList
                  items={sectionSummaries.map((section) => ({
                    id: section.id,
                    title: section.label,
                    subtitle: section.subtitle,
                    href: section.href,
                    meta: (
                      <Badge variant={section.badgeVariant} size="sm">
                        {section.badgeText}
                      </Badge>
                    ),
                  }))}
                />
              </Card>
          </section>
        </div>
      </div>
    </PageLayout>
  )
}

function ReceiptIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-full w-full"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 7h6M9 11h6m-6 4h3m7 3.5-2-2-2 2-2-2-2 2-2-2-2 2V4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V18.5Z"
      />
    </svg>
  )
}
