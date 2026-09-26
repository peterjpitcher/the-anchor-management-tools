import { redirect } from 'next/navigation'
import {
  BarChart,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Empty,
  PageLayout,
  Section,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/ds'
import { checkUserPermission, getUserPermissions } from '@/app/actions/rbac'
import {
  loadTableBookingReportsSnapshot,
  resolveTableBookingReportsWindow
} from '@/lib/analytics/table-booking-reports'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { tableBookingsNav } from '../_shared/nav'
import { ReportsWindowSwitch } from './ReportsWindowSwitch'
import { formatDateTimeInLondon } from '@/lib/dateUtils'

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value)
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2
  }).format(value)
}

function describeCoverTrend(granularity: 'hour' | 'day' | 'week' | 'month'): string {
  switch (granularity) {
    case 'hour':
      return 'Last 24 hours'
    case 'day':
      return 'Last 7 days'
    case 'week':
      return 'Weekly buckets for the current month'
    case 'month':
      return 'Monthly buckets over the last 12 months'
  }
}

function formatGeneratedAt(iso: string): string {
  return formatDateTimeInLondon(iso, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

type TableBookingReportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const WINDOW_OPTIONS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' }
] as const

export default async function TableBookingReportsPage({ searchParams }: TableBookingReportsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const windowParamRaw = resolvedSearchParams.window
  const windowParam = Array.isArray(windowParamRaw) ? windowParamRaw[0] : windowParamRaw
  const selectedWindow = resolveTableBookingReportsWindow(
    typeof windowParam === 'string' ? windowParam : null
  )

  const [canViewTableBookings, canViewReports, canManageTableBookings, permissionsResult] = await Promise.all([
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('reports', 'view'),
    checkUserPermission('table_bookings', 'manage'),
    getUserPermissions()
  ])

  if (!canViewReports) {
    redirect('/unauthorized')
  }

  if (permissionsResult.success && permissionsResult.data && isFohOnlyUser(permissionsResult.data)) {
    redirect('/table-bookings/foh')
  }

  const snapshot = await loadTableBookingReportsSnapshot({ window: selectedWindow })

  return (
    <PageLayout
      title="Table Bookings"
      subtitle="Reports"
      navItems={tableBookingsNav({ canViewReports })}
      headerActions={
        <ReportsWindowSwitch options={WINDOW_OPTIONS} value={snapshot.selected_window.key} />
      }
    >
      <Card>
        <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-text-muted">
            Generated: <span className="font-medium text-text">{formatGeneratedAt(snapshot.generated_at)}</span>
          </p>
          <p className="text-xs text-text-muted">
            Access level: {canManageTableBookings ? 'Manager' : 'Read only'}
          </p>
        </CardBody>
      </Card>

      <StatGrid columns={3}>
        <Stat
          label={`Active Guests (${snapshot.selected_window.label})`}
          value={formatNumber(snapshot.new_vs_returning.active_guests_selected_window)}
          hint={`New: ${formatNumber(snapshot.new_vs_returning.new_guests_selected_window)} | Returning: ${formatNumber(snapshot.new_vs_returning.returning_guests_selected_window)}`}
        />
        <Stat
          label="Bookings (All Time)"
          value={formatNumber(snapshot.bookings_by_type.all_time.total)}
          hint={`Event ${formatNumber(snapshot.bookings_by_type.all_time.event)} | Table ${formatNumber(snapshot.bookings_by_type.all_time.table)} | Private ${formatNumber(snapshot.bookings_by_type.all_time.private)}`}
        />
        <Stat
          label={`Bookings (${snapshot.selected_window.label})`}
          value={formatNumber(snapshot.bookings_by_type.selected_window.total)}
          hint={`Event ${formatNumber(snapshot.bookings_by_type.selected_window.event)} | Table ${formatNumber(snapshot.bookings_by_type.selected_window.table)} | Private ${formatNumber(snapshot.bookings_by_type.selected_window.private)}`}
        />
      </StatGrid>

      <Card>
        <CardHeader
          title="Covers Trend"
          subtitle={`${describeCoverTrend(snapshot.covers_trend.granularity)} | Total covers: ${formatNumber(snapshot.covers_trend.total_covers)}`}
        />
        <CardBody>
          <BarChart
            data={snapshot.covers_trend.buckets.map((bucket) => ({
              label: bucket.label,
              value: bucket.covers
            }))}
            height={300}
            formatType="number"
            seriesLabel="Covers"
            ariaLabel={`Covers trend: ${describeCoverTrend(snapshot.covers_trend.granularity)}`}
          />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Event Conversion and Waitlist" />
          <CardBody>
            <DescriptionList
              items={[
                {
                  key: 'bookings-created',
                  label: 'Bookings Created',
                  value: formatNumber(snapshot.event_conversion_and_waitlist.bookings_created)
                },
                {
                  key: 'bookings-confirmed',
                  label: 'Bookings Confirmed',
                  value: formatNumber(snapshot.event_conversion_and_waitlist.bookings_confirmed)
                },
                {
                  key: 'waitlist-joined',
                  label: 'Waitlist Joined',
                  value: formatNumber(snapshot.event_conversion_and_waitlist.waitlist_joined)
                },
                {
                  key: 'offers-sent',
                  label: 'Offers Sent',
                  value: formatNumber(snapshot.event_conversion_and_waitlist.waitlist_offers_sent)
                },
                {
                  key: 'offers-accepted',
                  label: 'Offers Accepted',
                  value: formatNumber(snapshot.event_conversion_and_waitlist.waitlist_offers_accepted)
                },
                {
                  key: 'acceptance-rate',
                  label: 'Acceptance Rate',
                  value: formatPercent(snapshot.event_conversion_and_waitlist.waitlist_acceptance_rate_percent)
                }
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top Engaged Guests" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead align="right">Score</TableHead>
                <TableHead align="right">30d</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.top_engaged_guests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Empty size="sm" title="No engagement scores available yet" />
                  </TableCell>
                </TableRow>
              ) : (
                snapshot.top_engaged_guests.map((guest) => (
                  <TableRow key={guest.customer_id}>
                    <TableCell>{guest.name}</TableCell>
                    <TableCell align="right" className="font-medium">{formatNumber(guest.total_score)}</TableCell>
                    <TableCell align="right">{formatNumber(guest.bookings_last_30)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Event Type Interest Segments" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event Type</TableHead>
                <TableHead align="right">Guests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.event_type_interest_segments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2}>
                    <Empty size="sm" title="No event type activity available yet" />
                  </TableCell>
                </TableRow>
              ) : (
                snapshot.event_type_interest_segments.slice(0, 12).map((segment) => (
                  <TableRow key={segment.event_type}>
                    <TableCell>{segment.event_type}</TableCell>
                    <TableCell align="right" className="font-medium">{formatNumber(segment.guest_count)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Section title="Review SMS vs Clicks">
        <StatGrid columns={3}>
          <Stat
            label="Event Reviews"
            value={formatPercent(snapshot.review_sms_vs_clicks.event.click_rate_percent)}
            hint={`${formatNumber(snapshot.review_sms_vs_clicks.event.clicked)} clicks from ${formatNumber(snapshot.review_sms_vs_clicks.event.sent)} sent`}
          />
          <Stat
            label="Table Reviews"
            value={formatPercent(snapshot.review_sms_vs_clicks.table.click_rate_percent)}
            hint={`${formatNumber(snapshot.review_sms_vs_clicks.table.clicked)} clicks from ${formatNumber(snapshot.review_sms_vs_clicks.table.sent)} sent`}
          />
          <Stat
            label="Overall Reviews"
            value={formatPercent(snapshot.review_sms_vs_clicks.total.click_rate_percent)}
            hint={`${formatNumber(snapshot.review_sms_vs_clicks.total.clicked)} clicks from ${formatNumber(snapshot.review_sms_vs_clicks.total.sent)} sent`}
          />
        </StatGrid>
      </Section>
    </PageLayout>
  )
}
