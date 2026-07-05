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

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
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
  const specialHoursToday = snapshot.events.specialHours.filter((entry) => entry.date === todayIso)

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
    ...specialHoursToday.map((entry) => ({
      id: `special-${entry.id}`,
      type: 'note' as const,
      title: entry.note || (entry.is_closed ? 'Closed' : entry.is_kitchen_closed ? 'Kitchen closed' : 'Special opening hours'),
      subtitle: entry.is_closed ? 'Special hours · Closed' : `Special hours · ${entry.opens?.slice(0, 5) || '--'}-${entry.closes?.slice(0, 5) || '--'}`,
      href: '/settings/business-hours',
    })),
  ]

  // --- Revenue Data (last 7 days only; full 14-day session list used for stats) ---
  const allSessions = snapshot.cashingUp.permitted ? snapshot.cashingUp.dailySessions : []
  const recentSessions = allSessions.slice(-7) // last 7 days for the chart
  const priorSessions = allSessions.slice(0, Math.max(allSessions.length - 7, 0)) // prior days for comparison

  const revenueData: { day: string; amount: number; target: number }[] = []
  if (snapshot.cashingUp.permitted) {
    if (recentSessions.length > 0) {
      for (const s of recentSessions) {
        const d = new Date(s.date + 'T12:00:00')
        const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: LONDON_TIMEZONE })
        revenueData.push({ day: label, amount: s.amount, target: s.target })
      }
    }
  }

  // --- Upcoming Events ---
  const allUpcomingEvents = snapshot.events.permitted ? snapshot.events.upcoming : []
  const upcomingEventsFormatted = allUpcomingEvents.slice(0, 5).map((e) => {
    const d = e.date ? new Date(e.date + 'T12:00:00') : new Date()
    const dayStr = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: LONDON_TIMEZONE }).toUpperCase()
    const dayNum = d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: LONDON_TIMEZONE })
    const capacity = e.capacity ?? 60
    const booked = e.bookedSeatsCount
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
  const activity: Array<{ id: string; actor: string; action: string; time: string }> = []
  if (snapshot.invoices.permitted && snapshot.invoices.overdueCount > 0) {
    activity.push({ id: 'inv-overdue', actor: 'Invoices', action: `${snapshot.invoices.overdueCount} overdue`, time: 'Urgent' })
  }
  if (eventsToday.length > 0) {
    activity.push({ id: 'ev-today', actor: 'Events', action: `${eventsToday.length} event${eventsToday.length > 1 ? 's' : ''} today`, time: 'Today' })
  }
  if (privateToday.length > 0) {
    activity.push({ id: 'pb-today', actor: 'Bookings', action: `${privateToday.length} private booking${privateToday.length > 1 ? 's' : ''} today`, time: 'Today' })
  }
  if (parkingToday.length > 0) {
    activity.push({ id: 'park-today', actor: 'Parking', action: `${parkingToday.length} parking arrival${parkingToday.length > 1 ? 's' : ''} today`, time: 'Today' })
  }
  if (snapshot.messages.permitted && snapshot.messages.unread > 0) {
    activity.push({ id: 'msg', actor: 'Messages', action: `${snapshot.messages.unread} unread`, time: 'Recent' })
  }
  if (snapshot.receipts.permitted && snapshot.receipts.needsAttention > 0) {
    activity.push({ id: 'rcpt', actor: 'Receipts', action: `${snapshot.receipts.needsAttention} pending review`, time: 'Recent' })
  }
  if (snapshot.parking.permitted && snapshot.parking.pendingPayments > 0) {
    activity.push({ id: 'park-pay', actor: 'Parking', action: `${snapshot.parking.pendingPayments} pending payment${snapshot.parking.pendingPayments > 1 ? 's' : ''}`, time: 'Recent' })
  }

  // --- Mini Metrics ---
  const miniMetrics = [
    {
      label: 'SMS failures (24h)',
      value: snapshot.systemHealth.permitted ? String(snapshot.systemHealth.smsFailures24h) : '--',
      trend: [] as number[],
      tone: (snapshot.systemHealth.permitted && snapshot.systemHealth.smsFailures24h > 0 ? 'warning' : undefined) as 'warning' | undefined,
    },
    {
      label: 'Unread messages',
      value: snapshot.messages.permitted ? String(snapshot.messages.unread) : '--',
      trend: [] as number[],
      tone: (snapshot.messages.permitted && snapshot.messages.unread > 0 ? 'warning' : undefined) as 'warning' | undefined,
    },
    {
      label: 'Active private bookings',
      value: snapshot.privateBookings.permitted ? String(snapshot.privateBookings.upcoming.length) : '--',
      trend: [] as number[],
    },
    {
      label: 'New customers (month)',
      value: snapshot.customers.permitted ? String(snapshot.customers.newThisMonth) : '--',
      trend: [] as number[],
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
    ? snapshot.privateBookings.balanceDueDates.filter((booking) => {
        if (!booking.balance_due_date) return false
        if (Number(booking.total_amount ?? 0) <= 0) return false
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
    actionItems.push({ id: 'sms', title: 'SMS Failures', description: `${snapshot.systemHealth.smsFailures24h} failed in last 24h`, href: '/settings/sms-failures', severity: 'high' })
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
  const calendarBalanceDueDates = snapshot.privateBookings.permitted
    ? snapshot.privateBookings.balanceDueDates
    : []
  const calendarEmployeeBirthdays = snapshot.employees.permitted
    ? snapshot.employees.birthdays
    : []
  const calendarParkingBookings = snapshot.parking.permitted
    ? uniqueById([...snapshot.parking.past, ...snapshot.parking.upcoming])
    : []

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <DashboardClient
        subtitle={subtitle}
        calendar={
          <UpcomingScheduleCalendar
            events={calendarEvents}
            calendarNotes={calendarNotes}
            privateBookings={calendarPrivateBookings}
            balanceDueDates={calendarBalanceDueDates}
            employeeBirthdays={calendarEmployeeBirthdays}
            specialHours={snapshot.events.specialHours}
            parkingBookings={calendarParkingBookings}
            canCreateCalendarNote={canManageCalendarNotes}
            dailyOps={snapshot.dailyOps}
          />
        }
        revenueData={revenueData}
        revenueSummary={(() => {
          if (!snapshot.cashingUp.permitted) return { avgDaily: '--', completedThrough: '--', vsLastWeek: '--', lastYearSameWeek: '--' }

          // Average daily — from the displayed 7 days
          const daysWithData = revenueData.filter(d => d.amount > 0)
          const totalDisplayed = daysWithData.reduce((sum, d) => sum + d.amount, 0)
          const avgDaily = daysWithData.length > 0
            ? currencyFormatter.format(totalDisplayed / daysWithData.length)
            : '£0'
          const completedThrough = daysWithData.length > 0
            ? daysWithData[daysWithData.length - 1].day
            : '--'

          // Week vs last — recent 7 days vs prior 7 days from the 14-day session list
          const recentSum = recentSessions.reduce((sum, s) => sum + s.amount, 0)
          const priorSum = priorSessions.reduce((sum, s) => sum + s.amount, 0)
          const vsLastWeek = priorSum > 0
            ? `${recentSum >= priorSum ? '+' : ''}${(((recentSum - priorSum) / priorSum) * 100).toFixed(1)}%`
            : '--'

          // Last year same week — ISO week number match (weekdays align)
          const lastYearTotal = snapshot.cashingUp.lastYearTotal
          const lastYearSameWeek = lastYearTotal > 0 && recentSum > 0
            ? `${recentSum >= lastYearTotal ? '+' : ''}${(((recentSum - lastYearTotal) / lastYearTotal) * 100).toFixed(1)}%`
            : '--'

          return { avgDaily, completedThrough, vsLastWeek, lastYearSameWeek }
        })()}
        todayTitle={`Today at The Anchor`}
        todayItems={todayItems}
        todayMeta={{
          openTime: '12:00',
          onRota: snapshot.rotaToday.staffOnRota,
          bookings: snapshot.tableBookings.permitted ? String(snapshot.tableBookings.todayTotal) : '--',
          covers: (() => {
            if (!snapshot.tableBookings.permitted) return '--'
            const total = snapshot.tableBookings.todayCovers
            return total > 0 ? String(total) : '--'
          })(),
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
