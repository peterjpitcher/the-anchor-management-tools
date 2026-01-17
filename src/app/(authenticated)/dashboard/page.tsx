import Link from 'next/link'
import { 
  CalendarIcon, 
  UsersIcon, 
  ChatBubbleLeftIcon, 
  CurrencyPoundIcon, 
  TruckIcon,
  ExclamationTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  PlusIcon,
  BellIcon,
  BanknotesIcon
} from '@heroicons/react/24/outline'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { formatDate } from '@/lib/dateUtils'
import { loadDashboardSnapshot } from './dashboard-data'

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
})

// Helper to group items by relative date
function groupItems<T>(items: T[], getDate: (item: T) => string | null) {
  const groups: Record<string, T[]> = {
    'Tomorrow': [],
    'This Week': [],
    'Next Week': [],
    'This Month': [],
    'Later': [],
    'To Be Confirmed': []
  }

  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowIso = tomorrow.toISOString().split('T')[0]

  // Get end of current week (Sunday)
  const endOfWeek = new Date(now)
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? 0 : 7) // adjust when day is sunday
  endOfWeek.setDate(diff)
  endOfWeek.setHours(23, 59, 59, 999)

  // Get end of next week
  const endOfNextWeek = new Date(endOfWeek)
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7)

  // Get end of current month
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  items.forEach(item => {
    const dateStr = getDate(item)
    
    if (!dateStr) {
      groups['To Be Confirmed'].push(item)
      return
    }

    const date = new Date(dateStr)
    const dateIso = date.toISOString().split('T')[0]

    if (dateIso === tomorrowIso) {
      groups['Tomorrow'].push(item)
    } else if (date <= endOfWeek) {
      groups['This Week'].push(item)
    } else if (date <= endOfNextWeek) {
      groups['Next Week'].push(item)
    } else if (date <= endOfMonth) {
      groups['This Month'].push(item)
    } else {
      groups['Later'].push(item)
    }
  })

  // Filter out empty groups
  return Object.entries(groups).filter(([_, items]) => items.length > 0)
}

export default async function DashboardPage() {
  const snapshot = await loadDashboardSnapshot()

  const quickActions = [
    { label: 'New Event', href: '/events/new', icon: CalendarIcon, permission: snapshot.events.permitted },
    { label: 'New Private Booking', href: '/private-bookings/new', icon: CurrencyPoundIcon, permission: snapshot.privateBookings.permitted },
    { label: 'New Invoice', href: '/invoices/new', icon: ClipboardDocumentListIcon, permission: snapshot.invoices.permitted },
  ]

  // --- Date Helpers ---
  const todayDate = new Date()
  const todayIso = todayDate.toISOString().split('T')[0]
  const isToday = (dateString: string | null) => {
    if (!dateString) return false
    return dateString.startsWith(todayIso)
  }

  // --- Aggregate Today's Items ---
  const privateToday = snapshot.privateBookings.permitted
    ? snapshot.privateBookings.upcoming.filter(b => isToday(b.event_date))
    : []

  const eventsToday = snapshot.events.permitted
    ? snapshot.events.today
    : []

  const parkingToday = snapshot.parking.permitted
    ? snapshot.parking.upcoming.filter(b => isToday(b.start_at))
    : []

  const overdueInvoices = snapshot.invoices.permitted
    ? snapshot.invoices.overdue
    : []

  const invoicesDueToday = snapshot.invoices.permitted
    ? snapshot.invoices.dueToday
    : []

  // Filter Horizon items to exclude today
  const upcomingPrivate = snapshot.privateBookings.permitted
    ? snapshot.privateBookings.upcoming.filter(b => !isToday(b.event_date))
    : []
  const upcomingParking = snapshot.parking.permitted
    ? snapshot.parking.upcoming.filter(b => !isToday(b.start_at))
    : []

  // Group items
  const groupedPrivate = groupItems(upcomingPrivate, b => b.event_date)
  const groupedParking = groupItems(upcomingParking, b => b.start_at)

  // --- Action Items (Needs Attention) ---
  const actionItems: Array<{
    id: string
    title: string
    description: string
    href: string
    severity: 'high' | 'medium' | 'low'
    icon: any
  }> = []

  // System Health
  if (snapshot.systemHealth.permitted) {
    if (snapshot.systemHealth.smsFailures24h > 0) {
      actionItems.push({
        id: 'sms-failures',
        title: 'SMS Failures',
        description: `${snapshot.systemHealth.smsFailures24h} failed in last 24h`,
        href: '/settings',
        severity: 'high',
        icon: ExclamationTriangleIcon
      })
    }
  }

  // Invoices
  if (snapshot.invoices.permitted) {
    if (snapshot.invoices.overdueCount > 0) {
      actionItems.push({
        id: 'overdue-inv',
        title: 'Overdue Invoices',
        description: `${snapshot.invoices.overdueCount} overdue`,
        href: '/invoices?status=overdue',
        severity: 'high',
        icon: CurrencyPoundIcon
      })
    }
  }
  
  // Messages
  if (snapshot.messages.permitted && snapshot.messages.unread > 0) {
    actionItems.push({
      id: 'unread-msg',
      title: 'Unread Messages',
      description: `${snapshot.messages.unread} unread`,
      href: '/messages',
      severity: 'medium',
      icon: ChatBubbleLeftIcon
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
       icon: TruckIcon
     })
  }

  // Receipts
  if (snapshot.receipts.permitted && snapshot.receipts.needsAttention > 0) {
    actionItems.push({
      id: 'receipts',
      title: 'Receipt Issues',
      description: `${snapshot.receipts.needsAttention} need review`,
      href: '/receipts',
      severity: 'medium',
      icon: ClipboardDocumentListIcon
    })
  }

  return (
    <PageLayout
      title="Dashboard"
      subtitle={new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      navItems={[]}
      className="bg-gray-50"
      padded={false}
    >
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
        
        {/* 1. Stats Overview Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Weekly Takings */}
          {snapshot.cashingUp.permitted && (
            <Link href="/cashing-up/dashboard" className="block">
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full border-l-4 border-l-emerald-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Weekly Takings</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {currencyFormatter.format(snapshot.cashingUp.thisWeekTotal)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {snapshot.cashingUp.completedThrough ? `(up to ${snapshot.cashingUp.completedThrough})` : '(no days cashed yet)'}
                    </p>
                  </div>
                  <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                    <BanknotesIcon className="h-6 w-6" />
                  </div>
                </div>
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">vs Target</span>
                    <span className={snapshot.cashingUp.thisWeekTotal >= snapshot.cashingUp.thisWeekTarget ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                      {snapshot.cashingUp.thisWeekTotal >= snapshot.cashingUp.thisWeekTarget ? '+' : ''}
                      {currencyFormatter.format(snapshot.cashingUp.thisWeekTotal - snapshot.cashingUp.thisWeekTarget)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                     <span className="text-gray-500">vs Last Week</span>
                     <span className={snapshot.cashingUp.thisWeekTotal >= snapshot.cashingUp.lastWeekTotal ? 'text-emerald-600' : 'text-red-600'}>
                       {snapshot.cashingUp.thisWeekTotal >= snapshot.cashingUp.lastWeekTotal ? '↑' : '↓'} {currencyFormatter.format(Math.abs(snapshot.cashingUp.thisWeekTotal - snapshot.cashingUp.lastWeekTotal))}
                     </span>
                  </div>
                   <div className="flex justify-between text-xs">
                     <span className="text-gray-500">vs Last Year</span>
                     <span className={snapshot.cashingUp.thisWeekTotal >= snapshot.cashingUp.lastYearTotal ? 'text-emerald-600' : 'text-red-600'}>
                       {snapshot.cashingUp.thisWeekTotal >= snapshot.cashingUp.lastYearTotal ? '↑' : '↓'} {currencyFormatter.format(Math.abs(snapshot.cashingUp.thisWeekTotal - snapshot.cashingUp.lastYearTotal))}
                     </span>
                  </div>
                </div>
              </Card>
            </Link>
          )}

          {/* New Customers */}
          {snapshot.customers.permitted && (
            <Link href="/customers" className="block">
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full border-l-4 border-l-blue-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">New Customers (Month)</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{snapshot.customers.newThisMonth}</p>
                  </div>
                  <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                    <UsersIcon className="h-6 w-6" />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  vs {snapshot.customers.newLastMonth} last month
                </p>
              </Card>
            </Link>
          )}

          {/* Unpaid Invoices */}
          {snapshot.invoices.permitted && (
            <Link href="/invoices?status=unpaid" className="block">
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full border-l-4 border-l-red-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Unpaid Invoices</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {currencyFormatter.format(snapshot.invoices.totalUnpaidValue)}
                    </p>
                  </div>
                  <div className="p-2 bg-red-50 rounded-lg text-red-600">
                    <CurrencyPoundIcon className="h-6 w-6" />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  {snapshot.invoices.unpaidCount} invoices outstanding
                </p>
              </Card>
            </Link>
          )}

          {/* Receipts */}
          {snapshot.receipts.permitted && (
            <Link href="/receipts" className="block">
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full border-l-4 border-l-orange-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Receipts to Resolve</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{snapshot.receipts.needsAttention}</p>
                  </div>
                  <div className="p-2 bg-orange-50 rounded-lg text-orange-600">
                    <ClipboardDocumentListIcon className="h-6 w-6" />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Pending review or details
                </p>
              </Card>
            </Link>
          )}

          {/* Unread Messages */}
          {snapshot.messages.permitted && (
            <Link href="/messages" className="block">
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full border-l-4 border-l-green-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Unread Messages</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{snapshot.messages.unread}</p>
                  </div>
                  <div className="p-2 bg-green-50 rounded-lg text-green-600">
                    <ChatBubbleLeftIcon className="h-6 w-6" />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  From customers
                </p>
              </Card>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          
          {/* 2. Main Content (Left 2 Columns) */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Today's Schedule */}
            <Card 
              header={
                <div className="flex items-center justify-between">
                  <CardTitle>Today&apos;s Schedule</CardTitle>
                  <Badge variant="secondary">
                    {eventsToday.length + privateToday.length + parkingToday.length + invoicesDueToday.length + overdueInvoices.length} Items
                  </Badge>
                </div>
              }
            >
              {eventsToday.length === 0 && privateToday.length === 0 && parkingToday.length === 0 && invoicesDueToday.length === 0 && overdueInvoices.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <CalendarIcon className="h-12 w-12 mx-auto text-gray-300 mb-2" />
                  <p>Nothing scheduled for today.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {/* Overdue Invoices - High Priority */}
                  {overdueInvoices.map(invoice => (
                    <div key={invoice.id} className="p-4 flex items-start gap-4 bg-red-50 hover:bg-red-100 transition-colors border-l-4 border-red-500">
                      <div className="p-2 bg-white text-red-600 rounded-lg border border-red-200">
                        <ExclamationTriangleIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-red-900">Overdue Invoice #{invoice.invoice_number}</h4>
                        <p className="text-xs text-red-700">
                          Due {invoice.due_date ? formatDate(new Date(invoice.due_date)) : 'Unknown'} • {currencyFormatter.format(invoice.total_amount || 0)}
                        </p>
                      </div>
                      <Link href={`/invoices/${invoice.id}`}>
                        <Button variant="ghost" size="sm" className="text-red-700 hover:text-red-900 hover:bg-red-200" rightIcon={<ArrowRightIcon className="h-4 w-4" />}>View</Button>
                      </Link>
                    </div>
                  ))}

                  {/* Invoices Due Today */}
                  {invoicesDueToday.map(invoice => (
                    <div key={invoice.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                      <div className="p-2 bg-yellow-100 text-yellow-700 rounded-lg">
                        <CurrencyPoundIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">Invoice Due Today #{invoice.invoice_number}</h4>
                        <p className="text-xs text-gray-500">
                          {currencyFormatter.format(invoice.total_amount || 0)} • {invoice.vendor ? (Array.isArray(invoice.vendor) ? invoice.vendor[0]?.name : invoice.vendor.name) : 'No Vendor'}
                        </p>
                      </div>
                      <Link href={`/invoices/${invoice.id}`}>
                        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon className="h-4 w-4" />}>View</Button>
                      </Link>
                    </div>
                  ))}

                  {/* Parking Arrivals */}
                  {parkingToday.map(booking => (
                    <div key={booking.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                      <div className="p-2 bg-gray-100 text-gray-600 rounded-lg">
                        <TruckIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">Parking Arrival: {booking.vehicle_registration}</h4>
                        <p className="text-xs text-gray-500">
                          {booking.customer_first_name} {booking.customer_last_name} • {booking.start_at ? new Date(booking.start_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Time TBC'}
                        </p>
                      </div>
                      <Link href="/parking">
                        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon className="h-4 w-4" />}>View</Button>
                      </Link>
                    </div>
                  ))}

                  {/* Events */}
                  {eventsToday.map(event => (
                    <div key={event.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                      <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                        <CalendarIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">{event.name}</h4>
                        <p className="text-xs text-gray-500">Event • {event.time || 'All Day'}</p>
                      </div>
                      <Link href={`/events/${event.id}`}>
                        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon className="h-4 w-4" />}>View</Button>
                      </Link>
                    </div>
                  ))}

                  {/* Private Bookings */}
                  {privateToday.map(booking => (
                    <div key={booking.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                      <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                        <CurrencyPoundIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">{booking.customer_name}</h4>
                        <p className="text-xs text-gray-500">Private Booking • {booking.start_time || 'TBC'} • {booking.status}</p>
                      </div>
                      <Link href={`/private-bookings/${booking.id}`}>
                        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon className="h-4 w-4" />}>View</Button>
                      </Link>
                    </div>
                  ))}

                </div>
              )}
            </Card>

            {/* Upcoming Private Bookings */}
            {snapshot.privateBookings.permitted && (
              <Card 
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Upcoming Private Bookings</CardTitle>
                    <Link href="/private-bookings" className="text-sm text-primary-600 hover:text-primary-700 font-medium">View All</Link>
                  </div>
                }
              >
                {groupedPrivate.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {groupedPrivate.map(([label, items]) => (
                      <div key={label}>
                        <div className="bg-gray-50 px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider sticky top-0">
                          {label}
                        </div>
                        {items.map(booking => (
                          <Link key={booking.id} href={`/private-bookings/${booking.id}`} className="block hover:bg-gray-50 transition-colors">
                            <div className="py-2 px-4 flex items-center gap-3">
                              <div className="flex-shrink-0 w-10 text-center bg-indigo-50 rounded-lg p-1 border border-indigo-100 text-indigo-700">
                                <span className="block text-xs font-bold uppercase">
                                  {booking.event_date ? new Date(booking.event_date).toLocaleDateString('en-US', { month: 'short' }) : 'TBC'}
                                </span>
                                <span className="block text-base font-bold">
                                  {booking.event_date ? new Date(booking.event_date).getDate() : '?'}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {booking.customer_name || 'Guest'} <span className="text-xs text-gray-500">• {booking.start_time || 'Time TBC'} • {booking.status}</span>
                                </p>
                              </div>
                              <ArrowRightIcon className="h-5 w-5 text-gray-300" />
                            </div>
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-gray-500">No upcoming private bookings.</div>
                )}
              </Card>
            )}

            {/* Upcoming Parking */}
            {snapshot.parking.permitted && (
              <Card 
                header={
                  <div className="flex items-center justify-between">
                    <CardTitle>Upcoming Parking</CardTitle>
                    <Link href="/parking" className="text-sm text-primary-600 hover:text-primary-700 font-medium">View All</Link>
                  </div>
                }
              >
                {groupedParking.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {groupedParking.map(([label, items]) => (
                      <div key={label}>
                        <div className="bg-gray-50 px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider sticky top-0">
                          {label}
                        </div>
                        {items.map(booking => (
                          <Link key={booking.id} href={`/parking`} className="block hover:bg-gray-50 transition-colors">
                            <div className="py-2 px-4 flex items-center gap-3">
                              <div className="flex-shrink-0 w-10 text-center bg-gray-50 rounded-lg p-1 border border-gray-200 text-gray-700">
                                <TruckIcon className="h-5 w-5 mx-auto" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {booking.vehicle_registration} <span className="text-xs text-gray-500">• {booking.start_at ? formatDate(new Date(booking.start_at)) : 'TBC'} {booking.customer_first_name && `• ${booking.customer_first_name} ${booking.customer_last_name || ''}`}</span>
                                </p>
                              </div>
                              <Badge variant={booking.payment_status === 'paid' ? 'success' : 'warning'}>
                                {booking.payment_status}
                              </Badge>
                            </div>
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-gray-500">No upcoming parking bookings.</div>
                )}
              </Card>
            )}
          </div>

          {/* 3. Sidebar (Right Column) */}
          <div className="space-y-6">
            
            {/* Quick Actions */}
            <Card>
              <CardTitle className="mb-4">Quick Actions</CardTitle>
              <div className="grid grid-cols-2 gap-3">
                {quickActions.filter(qa => qa.permission).map((action) => (
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
                  {actionItems.map(item => (
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
                      <item.icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${item.severity === 'high' ? 'text-red-600' : 'text-orange-600'}`} />
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

            {/* Quick Stats / System Info */}
            {snapshot.employees.permitted && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">System Status</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Active Staff</span>
                    <Badge variant="secondary">{snapshot.employees.activeCount}</Badge>
                  </div>
                  {snapshot.customers.permitted && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">New Customers (7d)</span>
                      <Badge variant="success">+{snapshot.customers.newThisWeek}</Badge>
                    </div>
                  )}
                  {snapshot.shortLinks.permitted && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Active Short Links</span>
                      <span className="text-sm font-medium text-gray-900">{snapshot.shortLinks.activeCount}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </PageLayout>
  )
}
