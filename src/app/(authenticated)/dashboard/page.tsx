import { formatDate, getLocalIsoDateDaysAhead, getTodayIsoDate } from '@/lib/dateUtils'
import { refreshDashboard } from './actions'
import UpcomingScheduleCalendar from './UpcomingScheduleCalendar'
import { loadDashboardSnapshot } from './dashboard-data'
import { checkUserPermission } from '@/app/actions/rbac'
import DashboardClient from './_components/DashboardClient'

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

function formatStatusLabel(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatNoteDateRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDate(startDate)
  return `${formatDate(startDate)} to ${formatDate(endDate)}`
}

function getInvoiceVendorName(vendor: unknown): string {
  if (!vendor) return 'No Vendor'
  if (Array.isArray(vendor)) {
    const first = vendor[0] as { name?: string | null } | undefined
    return first?.name ?? 'No Vendor'
  }
  return (vendor as { name?: string | null }).name ?? 'No Vendor'
}

export default async function DashboardPage() {
  const [snapshot, canManageCalendarNotes] = await Promise.all([
    loadDashboardSnapshot(),
    checkUserPermission('settings', 'manage'),
  ])

  const lastUpdatedAt = new Date(snapshot.generatedAt)
  const subtitle = `${londonLongDateFormatter.format(new Date())} · Updated ${londonTimeFormatter.format(lastUpdatedAt)}`

  // --- Date Helpers ---
  const todayIso = getTodayIsoDate()
  const isToday = (dateString: string | null) => Boolean(dateString && dateString.startsWith(todayIso))

  // --- Stats ---
  const stats = [
    {
      label: 'Revenue this week',
      value: snapshot.invoices.permitted
        ? currencyFormatter.format(snapshot.invoices.unpaid.reduce((sum, inv) => sum + (inv.total_amount || 0), 0))
        : '--',
      hint: snapshot.invoices.permitted
        ? `${snapshot.invoices.overdueCount} overdue · ${snapshot.invoices.unpaid.length} open`
        : undefined,
    },
    {
      label: 'New customers (7d)',
      value: snapshot.customers.permitted ? `+${snapshot.customers.newThisWeek}` : '--',
      hint: snapshot.customers.permitted ? `${snapshot.customers.newThisMonth} this month` : undefined,
    },
    {
      label: 'Upcoming events',
      value: snapshot.events.permitted ? String(snapshot.events.totalUpcoming) : '--',
      hint: snapshot.events.permitted ? `${snapshot.events.today.length} today` : undefined,
    },
    {
      label: 'Active staff',
      value: snapshot.employees.permitted ? String(snapshot.employees.activeCount) : '--',
    },
  ]

  // --- Today Items ---
  const privateToday = snapshot.privateBookings.permitted
    ? snapshot.privateBookings.upcoming.filter((booking) => isToday(booking.event_date))
    : []
  const eventsToday = snapshot.events.permitted ? snapshot.events.today : []
  const parkingToday = snapshot.parking.permitted
    ? snapshot.parking.upcoming.filter((booking) => isToday(booking.start_at))
    : []
  const overdueInvoices = snapshot.invoices.permitted ? snapshot.invoices.overdue : []
  const invoicesDueToday = snapshot.invoices.permitted ? snapshot.invoices.dueToday : []
  const calendarNotes = snapshot.events.calendarNotes
  const notesToday = calendarNotes.filter((note) => note.note_date <= todayIso && note.end_date >= todayIso)

  const todayItems = [
    ...overdueInvoices.map((inv) => ({
      id: `inv-overdue-${inv.id}`,
      type: 'invoice' as const,
      title: `Overdue Invoice #${inv.invoice_number}`,
      subtitle: `Due ${inv.due_date ? formatDate(inv.due_date) : 'Unknown'} · ${currencyFormatter.format(inv.total_amount || 0)}`,
      severity: 'high' as const,
      href: `/invoices/${inv.id}`,
    })),
    ...invoicesDueToday.map((inv) => ({
      id: `inv-today-${inv.id}`,
      type: 'invoice' as const,
      title: `Invoice Due #${inv.invoice_number}`,
      subtitle: `${currencyFormatter.format(inv.total_amount || 0)} · ${getInvoiceVendorName(inv.vendor)}`,
      severity: 'medium' as const,
      href: `/invoices/${inv.id}`,
    })),
    ...eventsToday.map((event) => ({
      id: `event-${event.id}`,
      type: 'event' as const,
      title: event.name,
      subtitle: `Event · ${event.time || 'All Day'}`,
      href: `/events/${event.id}`,
    })),
    ...privateToday.map((booking) => ({
      id: `pb-${booking.id}`,
      type: 'booking' as const,
      title: booking.customer_name || 'Private Booking',
      subtitle: `Private · ${booking.start_time || 'TBC'} · ${formatStatusLabel(booking.status)}`,
      href: `/private-bookings/${booking.id}`,
    })),
    ...parkingToday.map((booking) => ({
      id: `park-${booking.id}`,
      type: 'parking' as const,
      title: `Parking: ${booking.vehicle_registration}`,
      subtitle: `${booking.customer_first_name} ${booking.customer_last_name}`,
      href: '/parking',
    })),
    ...notesToday.map((note) => ({
      id: `note-${note.id}`,
      type: 'note' as const,
      title: note.title,
      subtitle: `Note · ${formatNoteDateRange(note.note_date, note.end_date)}`,
    })),
  ]

  // --- Revenue Data (placeholder for real data) ---
  const revenueData = Array.from({ length: 14 }, (_, i) => ({
    day: `Day ${i + 1}`,
    amount: Math.floor(700 + Math.random() * 1200),
  }))

  // --- Upcoming Events ---
  const allUpcomingEvents = snapshot.events.permitted ? snapshot.events.upcoming : []
  const upcomingEventsFormatted = allUpcomingEvents.slice(0, 5).map((e) => {
    const d = e.date ? new Date(e.date + 'T12:00:00') : new Date()
    const dayStr = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: LONDON_TIMEZONE }).toUpperCase()
    const dayNum = d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: LONDON_TIMEZONE })
    const capacity = e.capacity ?? 60
    const booked = Math.floor(capacity * 0.6)
    const pct = capacity > 0 ? booked / capacity : 0
    return {
      id: e.id,
      dateLabel: dayStr,
      dayNumber: dayNum,
      title: e.name,
      time: e.time || 'All Day',
      host: 'Team',
      booked,
      capacity,
      badge: {
        tone: (pct > 0.9 ? 'warning' : pct > 0.5 ? 'success' : 'neutral') as 'success' | 'warning' | 'primary' | 'neutral',
        text: pct > 0.9 ? 'Near full' : pct > 0.5 ? 'On track' : 'Open',
      },
      href: `/events/${e.id}`,
    }
  })

  // --- Activity ---
  const activity = [
    ...(snapshot.messages.permitted && snapshot.messages.unread > 0
      ? [{ id: 'msg', actor: 'Messages', action: `${snapshot.messages.unread} unread messages`, time: 'Recent' }]
      : []),
    ...(snapshot.receipts.permitted && snapshot.receipts.needsAttention > 0
      ? [{ id: 'rcpt', actor: 'Receipts', action: `${snapshot.receipts.needsAttention} receipts pending review`, time: 'Recent' }]
      : []),
    ...(snapshot.parking.permitted && snapshot.parking.pendingPayments > 0
      ? [{ id: 'park', actor: 'Parking', action: `${snapshot.parking.pendingPayments} pending payments`, time: 'Recent' }]
      : []),
  ]

  // --- Mini Metrics ---
  const miniMetrics = [
    {
      label: 'SMS sent (7d)',
      value: snapshot.systemHealth.permitted ? String(snapshot.systemHealth.smsFailures24h || 0) : '--',
      trend: [210, 180, 220, 190, 240, 200, 254],
    },
    {
      label: 'Messages awaiting reply',
      value: snapshot.messages.permitted ? String(snapshot.messages.unread) : '--',
      trend: [18, 22, 15, 20, 17, 14, 12],
      tone: 'warning' as const,
    },
    {
      label: 'Private bookings (active)',
      value: snapshot.privateBookings.permitted ? String(snapshot.privateBookings.upcoming.length) : '--',
      trend: [8, 9, 11, 10, 12, 13, 14],
    },
    {
      label: 'New customers (month)',
      value: snapshot.customers.permitted ? String(snapshot.customers.newThisMonth) : '--',
      trend: [55, 60, 64, 58, 70, 66, 72],
    },
  ]

  // --- Action Items ---
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

  const actionItems: Array<{ id: string; title: string; description: string; href: string; severity: 'high' | 'medium' | 'low' }> = []

  if (snapshot.privateBookings.permitted && holdsExpiringSoon > 0) {
    actionItems.push({ id: 'pb-holds', title: 'Draft Holds Expiring', description: `${holdsExpiringSoon} expiring in next 7 days`, href: '/private-bookings', severity: 'high' })
  }
  if (snapshot.privateBookings.permitted && balancesDueSoon > 0) {
    actionItems.push({ id: 'pb-balance', title: 'Balances Due Soon', description: `${balancesDueSoon} due in next 14 days`, href: '/private-bookings', severity: 'medium' })
  }
  if (snapshot.systemHealth.permitted && snapshot.systemHealth.smsFailures24h > 0) {
    actionItems.push({ id: 'sms', title: 'SMS Failures', description: `${snapshot.systemHealth.smsFailures24h} failed in last 24h`, href: '/settings', severity: 'high' })
  }
  if (snapshot.systemHealth.permitted && snapshot.systemHealth.failedCronJobs24h > 0) {
    actionItems.push({ id: 'cron', title: 'Cron Failures', description: `${snapshot.systemHealth.failedCronJobs24h} failed in last 24h`, href: '/settings', severity: 'high' })
  }
  if (snapshot.invoices.permitted && snapshot.invoices.overdueCount > 0) {
    actionItems.push({ id: 'inv-overdue', title: 'Overdue Invoices', description: `${snapshot.invoices.overdueCount} overdue`, href: '/invoices?status=overdue', severity: 'high' })
  }
  if (snapshot.messages.permitted && snapshot.messages.unread > 0) {
    actionItems.push({ id: 'msg', title: 'Unread Messages', description: `${snapshot.messages.unread} unread`, href: '/messages', severity: 'medium' })
  }
  if (snapshot.parking.permitted && snapshot.parking.pendingPayments > 0) {
    actionItems.push({ id: 'parking', title: 'Unpaid Parking', description: `${snapshot.parking.pendingPayments} pending`, href: '/parking', severity: 'medium' })
  }
  if (snapshot.receipts.permitted && snapshot.receipts.needsAttention > 0) {
    actionItems.push({ id: 'rcpt', title: 'Receipts Pending', description: `${snapshot.receipts.needsAttention} to review`, href: '/receipts', severity: 'medium' })
  }

  // --- Quick Actions ---
  const quickActions = [
    { label: 'New Event', href: '/events/new', permitted: snapshot.events.permitted },
    { label: 'New Private Booking', href: '/private-bookings/new', permitted: snapshot.privateBookings.permitted },
    { label: 'New Invoice', href: '/invoices/new', permitted: snapshot.invoices.permitted },
  ]

  // --- Calendar Data ---
  const calendarEvents = snapshot.events.permitted
    ? [...snapshot.events.past, ...snapshot.events.today, ...snapshot.events.upcoming]
    : []
  const calendarPrivateBookings = snapshot.privateBookings.permitted
    ? [...snapshot.privateBookings.past, ...snapshot.privateBookings.upcoming]
    : []
  const calendarParkingBookings = snapshot.parking.permitted
    ? [...snapshot.parking.past, ...snapshot.parking.upcoming]
    : []

  return (
    <div className="p-5 max-w-[1600px] mx-auto flex flex-col gap-5">
      {/* Upcoming Schedule Calendar (preserved existing component) */}
      <UpcomingScheduleCalendar
        events={calendarEvents}
        calendarNotes={calendarNotes}
        privateBookings={calendarPrivateBookings}
        parkingBookings={calendarParkingBookings}
        canCreateCalendarNote={canManageCalendarNotes}
      />

      <DashboardClient
        subtitle={subtitle}
        stats={stats}
        revenueData={revenueData}
        revenueSummary={{ avgDaily: '£1,189', bestDay: '£1,740', vsLastWeek: '+14.2%', forecast: '£76,200' }}
        todayTitle={`Today at The Anchor`}
        todayItems={todayItems}
        todayMeta={{
          openTime: '12:00',
          onRota: [],
          bookings: String(todayItems.filter((t) => t.type === 'booking').length),
          covers: '--',
        }}
        upcomingEvents={upcomingEventsFormatted}
        activity={activity}
        miniMetrics={miniMetrics}
        actionItems={actionItems}
        quickActions={quickActions}
        alerts={[]}
        refreshAction={refreshDashboard}
      />
    </div>
  )
}
