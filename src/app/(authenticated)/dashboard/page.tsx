import Link from 'next/link'
import {
  ArrowRightIcon,
  BanknotesIcon,
  BellIcon,
  CalendarIcon,
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  CurrencyPoundIcon,
  ExclamationTriangleIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { formatDate, getLocalIsoDateDaysAhead, getTodayIsoDate } from '@/lib/dateUtils'
import { refreshDashboard } from './actions'
import UpcomingScheduleCalendar from './UpcomingScheduleCalendar'
import { loadDashboardSnapshot } from './dashboard-data'

const LONDON_TIMEZONE = 'Europe/London'

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
})

const londonLongDateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: LONDON_TIMEZONE,
})

const londonTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: LONDON_TIMEZONE,
})

function getInvoiceVendorName(vendor: unknown): string {
  if (!vendor) return 'No Vendor'
  if (Array.isArray(vendor)) {
    const first = vendor[0] as { name?: string | null } | undefined
    return first?.name ?? 'No Vendor'
  }
  return (vendor as { name?: string | null }).name ?? 'No Vendor'
}

function formatStatusLabel(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default async function DashboardPage() {
  const snapshot = await loadDashboardSnapshot()

  const lastUpdatedAt = new Date(snapshot.generatedAt)
  const subtitle = `${londonLongDateFormatter.format(new Date())} • Updated ${londonTimeFormatter.format(lastUpdatedAt)}`

  const quickActions = [
    { label: 'New Event', href: '/events/new', icon: CalendarIcon, permitted: snapshot.events.permitted },
    {
      label: 'New Private Booking',
      href: '/private-bookings/new',
      icon: CurrencyPoundIcon,
      permitted: snapshot.privateBookings.permitted,
    },
    { label: 'New Invoice', href: '/invoices/new', icon: ClipboardDocumentListIcon, permitted: snapshot.invoices.permitted },
  ]

  // --- Date Helpers ---
  const todayIso = getTodayIsoDate()
  const isToday = (dateString: string | null) => Boolean(dateString && dateString.startsWith(todayIso))

  // --- Aggregate Today's Items ---
  const privateToday = snapshot.privateBookings.permitted
    ? snapshot.privateBookings.upcoming.filter((booking) => isToday(booking.event_date))
    : []

  const eventsToday = snapshot.events.permitted ? snapshot.events.today : []

  const parkingToday = snapshot.parking.permitted
    ? snapshot.parking.upcoming.filter((booking) => isToday(booking.start_at))
    : []

  const overdueInvoices = snapshot.invoices.permitted ? snapshot.invoices.overdue : []
  const invoicesDueToday = snapshot.invoices.permitted ? snapshot.invoices.dueToday : []

  const todayItemCount =
    eventsToday.length + privateToday.length + parkingToday.length + invoicesDueToday.length + overdueInvoices.length

  const calendarEvents = snapshot.events.permitted ? [...snapshot.events.today, ...snapshot.events.upcoming] : []
  const calendarPrivateBookings = snapshot.privateBookings.permitted ? snapshot.privateBookings.upcoming : []
  const calendarParkingBookings = snapshot.parking.permitted ? snapshot.parking.upcoming : []

  const upcomingScheduleCount =
    calendarEvents.filter((event) => Boolean(event.date)).length +
    calendarPrivateBookings.filter((booking) => Boolean(booking.event_date)).length +
    calendarParkingBookings.filter((booking) => Boolean(booking.start_at)).length

  // --- Private Booking Attention Metrics ---
  const now = new Date()
  const holdExpiryCutoff = new Date(now)
  holdExpiryCutoff.setDate(holdExpiryCutoff.getDate() + 7)

  const holdsExpiringSoon = snapshot.privateBookings.permitted
    ? snapshot.privateBookings.upcoming.filter((booking) => {
        if (booking.status !== 'draft') return false
        if (!booking.hold_expiry) return false
        const expiry = new Date(booking.hold_expiry)
        return expiry > now && expiry <= holdExpiryCutoff
      }).length
    : 0

  const balanceDueCutoffIso = getLocalIsoDateDaysAhead(14)
  const balancesDueSoon = snapshot.privateBookings.permitted
    ? snapshot.privateBookings.upcoming.filter((booking) => {
        if (booking.status !== 'confirmed') return false
        if (!booking.balance_due_date) return false
        return booking.balance_due_date >= todayIso && booking.balance_due_date <= balanceDueCutoffIso
      }).length
    : 0

  // --- Action Items (Needs Attention) ---
  const actionItems: Array<{
    id: string
    title: string
    description: string
    href: string
    severity: 'high' | 'medium' | 'low'
    icon: any
  }> = []

  // Private bookings
  if (snapshot.privateBookings.permitted && holdsExpiringSoon > 0) {
    actionItems.push({
      id: 'pb-holds-expiring',
      title: 'Draft Holds Expiring',
      description: `${holdsExpiringSoon} expiring in next 7 days`,
      href: '/private-bookings',
      severity: 'high',
      icon: ExclamationTriangleIcon,
    })
  }

  if (snapshot.privateBookings.permitted && balancesDueSoon > 0) {
    actionItems.push({
      id: 'pb-balances-due',
      title: 'Balances Due Soon',
      description: `${balancesDueSoon} due in next 14 days`,
      href: '/private-bookings',
      severity: 'medium',
      icon: CurrencyPoundIcon,
    })
  }

  // System health
  if (snapshot.systemHealth.permitted) {
    if (snapshot.systemHealth.smsFailures24h > 0) {
      actionItems.push({
        id: 'sms-failures',
        title: 'SMS Failures',
        description: `${snapshot.systemHealth.smsFailures24h} failed in last 24h`,
        href: '/settings',
        severity: 'high',
        icon: ExclamationTriangleIcon,
      })
    }

    if (snapshot.systemHealth.failedCronJobs24h > 0) {
      actionItems.push({
        id: 'cron-failures',
        title: 'Cron Failures',
        description: `${snapshot.systemHealth.failedCronJobs24h} failed in last 24h`,
        href: '/settings',
        severity: 'high',
        icon: ExclamationTriangleIcon,
      })
    }
  }

  // Invoices
  if (snapshot.invoices.permitted && snapshot.invoices.overdueCount > 0) {
    actionItems.push({
      id: 'overdue-inv',
      title: 'Overdue Invoices',
      description: `${snapshot.invoices.overdueCount} overdue`,
      href: '/invoices?status=overdue',
      severity: 'high',
      icon: CurrencyPoundIcon,
    })
  }

  // Messages
  if (snapshot.messages.permitted && snapshot.messages.unread > 0) {
    actionItems.push({
      id: 'unread-msg',
      title: 'Unread Messages',
      description: `${snapshot.messages.unread} unread`,
      href: '/messages',
      severity: 'medium',
      icon: ChatBubbleLeftIcon,
    })
  }

  // Parking
  if (snapshot.parking.permitted && snapshot.parking.pendingPayments > 0) {
    actionItems.push({
      id: 'parking-unpaid',
      title: 'Unpaid Parking',
      description: `${snapshot.parking.pendingPayments} pending`,
      href: '/parking',
      severity: 'medium',
      icon: TruckIcon,
    })
  }

  // Receipts
  if (snapshot.receipts.permitted && snapshot.receipts.needsAttention > 0) {
    actionItems.push({
      id: 'receipts',
      title: 'Receipts Pending',
      description: `${snapshot.receipts.needsAttention} to review`,
      href: '/receipts',
      severity: 'medium',
      icon: ClipboardDocumentListIcon,
    })
  }

  const overviewCards: Array<{
    key: string
    href: string
    title: string
    value: React.ReactNode
    description: React.ReactNode
    icon: any
    borderClassName: string
    iconWrapperClassName: string
  }> = []

  if (snapshot.cashingUp.permitted) {
    overviewCards.push({
      key: 'weekly-takings',
      href: '/cashing-up/dashboard',
      title: 'Weekly Takings',
      value: currencyFormatter.format(snapshot.cashingUp.thisWeekTotal),
      description: (
        <span className="text-xs text-gray-500">
          {snapshot.cashingUp.completedThrough ? `(up to ${snapshot.cashingUp.completedThrough})` : '(no days cashed yet)'}
        </span>
      ),
      icon: BanknotesIcon,
      borderClassName: 'border-l-4 border-l-emerald-500',
      iconWrapperClassName: 'bg-emerald-50 text-emerald-600',
    })
  }

  if (snapshot.privateBookings.permitted) {
    overviewCards.push({
      key: 'private-bookings-holds',
      href: '/private-bookings',
      title: 'Holds Expiring (7d)',
      value: holdsExpiringSoon,
      description: (
        <span className="text-xs text-gray-500">
          {balancesDueSoon > 0 ? `${balancesDueSoon} balances due in 14d` : 'No balances due soon'}
        </span>
      ),
      icon: CurrencyPoundIcon,
      borderClassName: 'border-l-4 border-l-indigo-500',
      iconWrapperClassName: 'bg-indigo-50 text-indigo-600',
    })
  }

  if (snapshot.parking.permitted) {
    overviewCards.push({
      key: 'parking-pending',
      href: '/parking',
      title: 'Parking Pending',
      value: snapshot.parking.pendingPayments,
      description: (
        <span className="text-xs text-gray-500">
          {snapshot.parking.arrivalsToday} arrivals today
        </span>
      ),
      icon: TruckIcon,
      borderClassName: 'border-l-4 border-l-gray-400',
      iconWrapperClassName: 'bg-gray-100 text-gray-700',
    })
  }

  if (snapshot.invoices.permitted) {
    overviewCards.push({
      key: 'unpaid-invoices',
      href: '/invoices?status=unpaid',
      title: 'Unpaid Invoices',
      value: currencyFormatter.format(snapshot.invoices.totalUnpaidValue),
      description: (
        <span className="text-xs text-gray-500">
          {snapshot.invoices.unpaidCount} outstanding • {snapshot.invoices.overdueCount} overdue
        </span>
      ),
      icon: CurrencyPoundIcon,
      borderClassName: 'border-l-4 border-l-red-500',
      iconWrapperClassName: 'bg-red-50 text-red-600',
    })
  }

  if (snapshot.receipts.permitted) {
    overviewCards.push({
      key: 'receipts',
      href: '/receipts',
      title: 'Receipts to Resolve',
      value: snapshot.receipts.needsAttention,
      description: (
        <span className="text-xs text-gray-500">
          {snapshot.receipts.lastImportAt
            ? `Last import ${londonTimeFormatter.format(new Date(snapshot.receipts.lastImportAt))}`
            : 'No imports yet'}
        </span>
      ),
      icon: ClipboardDocumentListIcon,
      borderClassName: 'border-l-4 border-l-orange-500',
      iconWrapperClassName: 'bg-orange-50 text-orange-600',
    })
  }

  if (snapshot.messages.permitted) {
    overviewCards.push({
      key: 'messages',
      href: '/messages',
      title: 'Unread Messages',
      value: snapshot.messages.unread,
      description: <span className="text-xs text-gray-500">From customers</span>,
      icon: ChatBubbleLeftIcon,
      borderClassName: 'border-l-4 border-l-green-500',
      iconWrapperClassName: 'bg-green-50 text-green-600',
    })
  }

  return (
    <PageLayout
      title="Dashboard"
      subtitle={subtitle}
      navItems={[]}
      headerActions={
        <form action={refreshDashboard}>
          <Button type="submit" variant="secondary" size="sm">
            Refresh
          </Button>
        </form>
      }
      className="bg-gray-50"
      padded={false}
    >
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
        {/* 1. Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {overviewCards.map((card) => (
            <Link key={card.key} href={card.href} className="block">
              <Card className={`hover:shadow-md transition-shadow cursor-pointer h-full ${card.borderClassName}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">{card.title}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
                    <div className="mt-1">{card.description}</div>
                  </div>
                  <div className={`p-2 rounded-lg ${card.iconWrapperClassName}`}>
                    <card.icon className="h-6 w-6" />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Upcoming Schedule Calendar (Full Width) */}
          <div className="lg:col-span-3">
            <Card
              header={
                <div className="flex items-center justify-between">
                  <CardTitle>Upcoming Schedule</CardTitle>
                  <Badge variant="secondary">{upcomingScheduleCount} items</Badge>
                </div>
              }
            >
              <UpcomingScheduleCalendar
                events={calendarEvents}
                privateBookings={calendarPrivateBookings}
                parkingBookings={calendarParkingBookings}
              />
            </Card>
          </div>

          {/* 2. Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Today's Schedule */}
            <Card
              header={
                <div className="flex items-center justify-between">
                  <CardTitle>Today&apos;s Schedule</CardTitle>
                  <Badge variant="secondary">{todayItemCount} items</Badge>
                </div>
              }
            >
              {todayItemCount === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <CalendarIcon className="h-12 w-12 mx-auto text-gray-300 mb-2" />
                  <p>Nothing scheduled for today.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {/* Overdue Invoices - High Priority */}
                  {overdueInvoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="p-4 flex items-start gap-4 bg-red-50 hover:bg-red-100 transition-colors border-l-4 border-red-500"
                    >
                      <div className="p-2 bg-white text-red-600 rounded-lg border border-red-200">
                        <ExclamationTriangleIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-red-900">Overdue Invoice #{invoice.invoice_number}</h4>
                        <p className="text-xs text-red-700">
                          Due {invoice.due_date ? formatDate(invoice.due_date) : 'Unknown'} •{' '}
                          {currencyFormatter.format(invoice.total_amount || 0)}
                        </p>
                      </div>
                      <Link href={`/invoices/${invoice.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-700 hover:text-red-900 hover:bg-red-200"
                          rightIcon={<ArrowRightIcon className="h-4 w-4" />}
                        >
                          View
                        </Button>
                      </Link>
                    </div>
                  ))}

                  {/* Invoices Due Today */}
                  {invoicesDueToday.map((invoice) => (
                    <div key={invoice.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                      <div className="p-2 bg-yellow-100 text-yellow-700 rounded-lg">
                        <CurrencyPoundIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">Invoice Due Today #{invoice.invoice_number}</h4>
                        <p className="text-xs text-gray-500">
                          {currencyFormatter.format(invoice.total_amount || 0)} • {getInvoiceVendorName(invoice.vendor)}
                        </p>
                      </div>
                      <Link href={`/invoices/${invoice.id}`}>
                        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon className="h-4 w-4" />}>
                          View
                        </Button>
                      </Link>
                    </div>
                  ))}

                  {/* Parking Arrivals */}
                  {parkingToday.map((booking) => (
                    <div key={booking.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                      <div className="p-2 bg-gray-100 text-gray-600 rounded-lg">
                        <TruckIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">Parking Arrival: {booking.vehicle_registration}</h4>
                        <p className="text-xs text-gray-500">
                          {booking.customer_first_name} {booking.customer_last_name} •{' '}
                          {booking.start_at ? londonTimeFormatter.format(new Date(booking.start_at)) : 'Time TBC'}
                        </p>
                      </div>
                      <Link href="/parking">
                        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon className="h-4 w-4" />}>
                          View
                        </Button>
                      </Link>
                    </div>
                  ))}

                  {/* Events */}
                  {eventsToday.map((event) => (
                    <div key={event.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                      <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                        <CalendarIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">{event.name}</h4>
                        <p className="text-xs text-gray-500">Event • {event.time || 'All Day'}</p>
                      </div>
                      <Link href={`/events/${event.id}`}>
                        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon className="h-4 w-4" />}>
                          View
                        </Button>
                      </Link>
                    </div>
                  ))}

                  {/* Private Bookings */}
                  {privateToday.map((booking) => (
                    <div key={booking.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                      <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                        <CurrencyPoundIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">{booking.customer_name}</h4>
                        <p className="text-xs text-gray-500">
                          Private Booking • {booking.start_time || 'TBC'} • {formatStatusLabel(booking.status)}
                        </p>
                      </div>
                      <Link href={`/private-bookings/${booking.id}`}>
                        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon className="h-4 w-4" />}>
                          View
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Finance */}
            {(snapshot.invoices.permitted || snapshot.receipts.permitted || snapshot.quotes.permitted) && (
              <Card
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Finance</CardTitle>
                    <div className="flex items-center gap-3 text-sm">
                      {snapshot.invoices.permitted && (
                        <Link href="/invoices" className="text-primary-600 hover:text-primary-700 font-medium">
                          Invoices
                        </Link>
                      )}
                      {snapshot.receipts.permitted && (
                        <Link href="/receipts" className="text-primary-600 hover:text-primary-700 font-medium">
                          Receipts
                        </Link>
                      )}
                      {snapshot.quotes.permitted && (
                        <Link href="/quotes" className="text-primary-600 hover:text-primary-700 font-medium">
                          Quotes
                        </Link>
                      )}
                    </div>
                  </div>
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {snapshot.invoices.permitted ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-gray-900">Next Unpaid Invoices</h4>
                        <Badge variant={snapshot.invoices.overdueCount > 0 ? 'warning' : 'secondary'}>
                          {snapshot.invoices.overdueCount} overdue
                        </Badge>
                      </div>
                      {snapshot.invoices.unpaid.length === 0 ? (
                        <p className="text-sm text-gray-500">No unpaid invoices.</p>
                      ) : (
                        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                          {snapshot.invoices.unpaid.map((invoice) => (
                            <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="block hover:bg-gray-50 transition-colors">
                              <div className="p-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">#{invoice.invoice_number}</p>
                                  <p className="text-xs text-gray-500 truncate">
                                    Due {invoice.due_date ? formatDate(invoice.due_date) : 'Unknown'} • {getInvoiceVendorName(invoice.vendor)}
                                  </p>
                                </div>
                                <div className="text-sm font-semibold text-gray-900">
                                  {currencyFormatter.format(invoice.total_amount || 0)}
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">Invoices not available.</div>
                  )}

                  <div className="space-y-4">
                    {snapshot.receipts.permitted && (
                      <div className="rounded-lg border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-gray-900">Receipts</h4>
                          <Badge variant={snapshot.receipts.needsAttention > 0 ? 'warning' : 'success'}>
                            {snapshot.receipts.needsAttention > 0 ? 'Needs review' : 'Clear'}
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Pending</span>
                            <span className="font-medium text-gray-900">{snapshot.receipts.pendingCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Can&apos;t find</span>
                            <span className="font-medium text-gray-900">{snapshot.receipts.cantFindCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Last import</span>
                            <span className="font-medium text-gray-900">
                              {snapshot.receipts.lastImportAt
                                ? londonTimeFormatter.format(new Date(snapshot.receipts.lastImportAt))
                                : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">OpenAI cost</span>
                            <span className="font-medium text-gray-900">
                              {snapshot.receipts.openAiCost != null ? currencyFormatter.format(snapshot.receipts.openAiCost) : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {snapshot.quotes.permitted && (
                      <div className="rounded-lg border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-gray-900">Quotes</h4>
                          <Badge variant={snapshot.quotes.draftCount > 0 ? 'secondary' : 'default'}>
                            {snapshot.quotes.draftCount} drafts
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Pending</span>
                            <span className="font-medium text-gray-900">
                              {currencyFormatter.format(snapshot.quotes.totalPendingValue)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Expired</span>
                            <span className="font-medium text-gray-900">
                              {currencyFormatter.format(snapshot.quotes.totalExpiredValue)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Accepted</span>
                            <span className="font-medium text-gray-900">
                              {currencyFormatter.format(snapshot.quotes.totalAcceptedValue)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* 3. Sidebar */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card>
              <CardTitle className="mb-4">Quick Actions</CardTitle>
              <div className="grid grid-cols-2 gap-3">
                {quickActions
                  .filter((qa) => qa.permitted)
                  .map((action) => (
                    <Link
                      key={action.label}
                      href={action.href}
                      className="flex flex-col items-center justify-center p-3 bg-white border border-gray-200 rounded-lg hover:border-primary-500 hover:shadow-sm transition-all text-center group"
                    >
                      <action.icon className="h-6 w-6 text-gray-400 group-hover:text-primary-600 mb-2" />
                      <span className="text-xs font-medium text-gray-700 group-hover:text-primary-700">{action.label}</span>
                    </Link>
                  ))}
              </div>
            </Card>

            {/* Action Required */}
            <Card
              header={
                <div className="flex items-center gap-2">
                  <BellIcon className="h-5 w-5 text-gray-500" />
                  <CardTitle>Action Required</CardTitle>
                </div>
              }
            >
              {actionItems.length > 0 ? (
                <div className="space-y-3">
                  {actionItems.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`
                        flex items-start gap-3 p-3 rounded-lg border transition-colors
                        ${item.severity === 'high'
                          ? 'bg-red-50 border-red-100 hover:bg-red-100'
                          : 'bg-orange-50 border-orange-100 hover:bg-orange-100'
                        }
                      `}
                    >
                      <item.icon
                        className={`h-5 w-5 mt-0.5 flex-shrink-0 ${item.severity === 'high' ? 'text-red-600' : 'text-orange-600'}`}
                      />
                      <div>
                        <p className={`text-sm font-medium ${item.severity === 'high' ? 'text-red-900' : 'text-orange-900'}`}>
                          {item.title}
                        </p>
                        <p className={`text-xs ${item.severity === 'high' ? 'text-red-700' : 'text-orange-700'}`}>
                          {item.description}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <CheckCircleIcon className="h-10 w-10 text-green-500 mx-auto mb-2 opacity-50" />
                  <p className="text-sm text-gray-600">All caught up!</p>
                  <p className="text-xs text-gray-400">No alerts requiring attention.</p>
                </div>
              )}
            </Card>

            {/* Status / Info */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">At a Glance</h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Last Updated</span>
                  <span className="text-sm font-medium text-gray-900">{londonTimeFormatter.format(lastUpdatedAt)}</span>
                </div>

                {snapshot.employees.permitted && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Active Staff</span>
                    <Badge variant="secondary">{snapshot.employees.activeCount}</Badge>
                  </div>
                )}

                {snapshot.customers.permitted && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">New Customers (7d)</span>
                    <Badge variant="success">+{snapshot.customers.newThisWeek}</Badge>
                  </div>
                )}

                {snapshot.events.permitted && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Upcoming Events</span>
                    <span className="text-sm font-medium text-gray-900">{snapshot.events.totalUpcoming}</span>
                  </div>
                )}

                {snapshot.shortLinks.permitted && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Active Short Links</span>
                    <span className="text-sm font-medium text-gray-900">{snapshot.shortLinks.activeCount}</span>
                  </div>
                )}

                {snapshot.customers.permitted && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Customers (Month)</span>
                    <span className="text-sm font-medium text-gray-900">+{snapshot.customers.newThisMonth}</span>
                  </div>
                )}

                {snapshot.user.email && (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-500">Signed in as</p>
                    <p className="text-sm font-medium text-gray-900 truncate">{snapshot.user.email}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  )
}
