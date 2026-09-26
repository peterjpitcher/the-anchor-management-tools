import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PageLayout } from '@/ds'
import { Card, Stat, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds'
import { BarChart } from '@/components/charts/BarChart'
import { checkUserPermission, getUserPermissions } from '@/app/actions/rbac'
import {
  loadTableBookingReportsSnapshot,
  resolveTableBookingReportsWindow
} from '@/lib/analytics/table-booking-reports'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
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
      title="Table Bookings Reports"
      subtitle="Guest analytics, conversion tracking, and engagement performance"
      navItems={[
        { label: 'Back of House', href: '/table-bookings/boh' },
        { label: 'Front of House', href: '/table-bookings/foh' },
        { label: 'Reports', href: '/table-bookings/reports' }
      ]}
      backButton={{
        label: 'Back to Dashboard',
        href: '/'
      }}
    >
      <div className="space-y-6">
        <Card>
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-text-muted">
                Generated: <span className="font-medium text-text">{formatGeneratedAt(snapshot.generated_at)}</span>
              </p>
              <p className="text-xs text-text-muted">
                Access level: {canManageTableBookings ? 'Manager' : 'Read only'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {WINDOW_OPTIONS.map((option) => {
                const active = snapshot.selected_window.key === option.key
                return (
                  <Link
                    key={option.key}
                    href={`/table-bookings/reports?window=${option.key}`}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs transition max-shell:min-h-touch focus-visible:outline-hidden focus-visible:shadow-ring ${
                      active
                        ? 'border-primary bg-primary-soft font-semibold text-primary-soft-fg'
                        : 'font-medium border-border-strong bg-surface text-text-muted hover:bg-surface-hover hover:text-text'
                    }`}
                  >
                    {option.label}
                  </Link>
                )
              })}
            </div>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <Stat
              label={`Active Guests (${snapshot.selected_window.label})`}
              value={formatNumber(snapshot.new_vs_returning.active_guests_selected_window)}
              hint={`New: ${formatNumber(snapshot.new_vs_returning.new_guests_selected_window)} | Returning: ${formatNumber(snapshot.new_vs_returning.returning_guests_selected_window)}`}
            />
          </Card>

          <Card>
            <Stat
              label="Bookings (All Time)"
              value={formatNumber(snapshot.bookings_by_type.all_time.total)}
              hint={`Event ${formatNumber(snapshot.bookings_by_type.all_time.event)} | Table ${formatNumber(snapshot.bookings_by_type.all_time.table)} | Private ${formatNumber(snapshot.bookings_by_type.all_time.private)}`}
            />
          </Card>

          <Card>
            <Stat
              label={`Bookings (${snapshot.selected_window.label})`}
              value={formatNumber(snapshot.bookings_by_type.selected_window.total)}
              hint={`Event ${formatNumber(snapshot.bookings_by_type.selected_window.event)} | Table ${formatNumber(snapshot.bookings_by_type.selected_window.table)} | Private ${formatNumber(snapshot.bookings_by_type.selected_window.private)}`}
            />
          </Card>
        </div>

        <Card>
          <h3 className="text-base font-semibold text-text">Covers Trend</h3>
          <p className="mt-1 text-sm text-text-muted">
            {describeCoverTrend(snapshot.covers_trend.granularity)} | Total covers: {formatNumber(snapshot.covers_trend.total_covers)}
          </p>
          <div className="mt-4 h-[300px] rounded-lg border border-border bg-surface-2 p-3">
            <BarChart
              data={snapshot.covers_trend.buckets.map((bucket) => ({
                label: bucket.label,
                value: bucket.covers,
                color: 'var(--color-chart-1)'
              }))}
              height={270}
              formatType="number"
            />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="text-base font-semibold text-text">Event Conversion and Waitlist</h3>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-text-muted">Bookings Created</dt>
                <dd className="font-semibold text-text">{formatNumber(snapshot.event_conversion_and_waitlist.bookings_created)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Bookings Confirmed</dt>
                <dd className="font-semibold text-text">{formatNumber(snapshot.event_conversion_and_waitlist.bookings_confirmed)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Waitlist Joined</dt>
                <dd className="font-semibold text-text">{formatNumber(snapshot.event_conversion_and_waitlist.waitlist_joined)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Offers Sent</dt>
                <dd className="font-semibold text-text">{formatNumber(snapshot.event_conversion_and_waitlist.waitlist_offers_sent)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Offers Accepted</dt>
                <dd className="font-semibold text-text">{formatNumber(snapshot.event_conversion_and_waitlist.waitlist_offers_accepted)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Acceptance Rate</dt>
                <dd className="font-semibold text-text">{formatPercent(snapshot.event_conversion_and_waitlist.waitlist_acceptance_rate_percent)}</dd>
              </div>
            </dl>
          </Card>

        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="text-base font-semibold text-text">Top Engaged Guests</h3>
            <Table className="mt-4">
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
                    <TableCell className="text-text-muted" colSpan={3}>
                      No engagement scores available yet.
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
            <h3 className="text-base font-semibold text-text">Event Type Interest Segments</h3>
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Event Type</TableHead>
                  <TableHead align="right">Guests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.event_type_interest_segments.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-text-muted" colSpan={2}>
                      No event type activity available yet.
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

        <Card>
          <h3 className="text-base font-semibold text-text">Review SMS vs Clicks</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Event Reviews</p>
              <p className="mt-1 text-lg font-semibold text-text">{formatPercent(snapshot.review_sms_vs_clicks.event.click_rate_percent)}</p>
              <p className="text-sm text-text-muted">{formatNumber(snapshot.review_sms_vs_clicks.event.clicked)} clicks from {formatNumber(snapshot.review_sms_vs_clicks.event.sent)} sent</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Table Reviews</p>
              <p className="mt-1 text-lg font-semibold text-text">{formatPercent(snapshot.review_sms_vs_clicks.table.click_rate_percent)}</p>
              <p className="text-sm text-text-muted">{formatNumber(snapshot.review_sms_vs_clicks.table.clicked)} clicks from {formatNumber(snapshot.review_sms_vs_clicks.table.sent)} sent</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Overall Reviews</p>
              <p className="mt-1 text-lg font-semibold text-text">{formatPercent(snapshot.review_sms_vs_clicks.total.click_rate_percent)}</p>
              <p className="text-sm text-text-muted">{formatNumber(snapshot.review_sms_vs_clicks.total.clicked)} clicks from {formatNumber(snapshot.review_sms_vs_clicks.total.sent)} sent</p>
            </div>
          </div>
        </Card>
      </div>
    </PageLayout>
  )
}
