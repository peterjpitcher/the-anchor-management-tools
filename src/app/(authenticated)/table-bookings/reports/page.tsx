import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { BarChart } from '@/components/charts/BarChart'
import { checkUserPermission, getUserPermissions } from '@/app/actions/rbac'
import {
  loadTableBookingReportsSnapshot,
  resolveTableBookingReportsWindow
} from '@/lib/analytics/table-booking-reports'
import { isFohOnlyUser } from '@/lib/foh/user-mode'

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
      return 'Weekly buckets over the last 30 days'
    case 'month':
      return 'Monthly buckets over the last 12 months'
  }
}

function formatGeneratedAt(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(iso))
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

  if (!canViewTableBookings && !canViewReports) {
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
        { label: 'Reports', href: '/table-bookings/reports', active: true }
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
              <p className="text-sm text-gray-600">
                Generated: <span className="font-medium text-gray-900">{formatGeneratedAt(snapshot.generated_at)}</span>
              </p>
              <p className="text-xs text-gray-500">
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
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-800'
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
            <h3 className="text-sm font-semibold text-gray-500">Active Guests ({snapshot.selected_window.label})</h3>
            <p className="mt-2 text-3xl font-semibold text-gray-900">
              {formatNumber(snapshot.new_vs_returning.active_guests_selected_window)}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              New: {formatNumber(snapshot.new_vs_returning.new_guests_selected_window)} | Returning: {formatNumber(snapshot.new_vs_returning.returning_guests_selected_window)}
            </p>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-500">Bookings (All Time)</h3>
            <p className="mt-2 text-3xl font-semibold text-gray-900">
              {formatNumber(snapshot.bookings_by_type.all_time.total)}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Event {formatNumber(snapshot.bookings_by_type.all_time.event)} | Table {formatNumber(snapshot.bookings_by_type.all_time.table)} | Private {formatNumber(snapshot.bookings_by_type.all_time.private)}
            </p>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-500">Bookings ({snapshot.selected_window.label})</h3>
            <p className="mt-2 text-3xl font-semibold text-gray-900">
              {formatNumber(snapshot.bookings_by_type.selected_window.total)}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Event {formatNumber(snapshot.bookings_by_type.selected_window.event)} | Table {formatNumber(snapshot.bookings_by_type.selected_window.table)} | Private {formatNumber(snapshot.bookings_by_type.selected_window.private)}
            </p>
          </Card>
        </div>

        <Card>
          <h3 className="text-base font-semibold text-gray-900">Covers Trend</h3>
          <p className="mt-1 text-sm text-gray-600">
            {describeCoverTrend(snapshot.covers_trend.granularity)} | Total covers: {formatNumber(snapshot.covers_trend.total_covers)}
          </p>
          <div className="mt-4 h-[300px] rounded-lg border border-gray-200 bg-gray-50 p-3">
            <BarChart
              data={snapshot.covers_trend.buckets.map((bucket) => ({
                label: bucket.label,
                value: bucket.covers,
                color: '#2563EB'
              }))}
              height={270}
              formatType="number"
            />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="text-base font-semibold text-gray-900">Event Conversion and Waitlist</h3>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-500">Bookings Created</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(snapshot.event_conversion_and_waitlist.bookings_created)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Bookings Confirmed</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(snapshot.event_conversion_and_waitlist.bookings_confirmed)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Waitlist Joined</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(snapshot.event_conversion_and_waitlist.waitlist_joined)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Offers Sent</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(snapshot.event_conversion_and_waitlist.waitlist_offers_sent)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Offers Accepted</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(snapshot.event_conversion_and_waitlist.waitlist_offers_accepted)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Acceptance Rate</dt>
                <dd className="font-semibold text-gray-900">{formatPercent(snapshot.event_conversion_and_waitlist.waitlist_acceptance_rate_percent)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h3 className="text-base font-semibold text-gray-900">Charge Request Outcomes</h3>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-500">Total Requests</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(snapshot.charge_request_outcomes.total_requests)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Approved</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(snapshot.charge_request_outcomes.approved)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Waived</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(snapshot.charge_request_outcomes.waived)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Pending</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(snapshot.charge_request_outcomes.pending)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Succeeded Amount</dt>
                <dd className="font-semibold text-gray-900">{formatCurrency(snapshot.charge_request_outcomes.succeeded_amount_gbp)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Total Amount</dt>
                <dd className="font-semibold text-gray-900">{formatCurrency(snapshot.charge_request_outcomes.total_amount_gbp)}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="text-base font-semibold text-gray-900">Top Engaged Guests</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Guest</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Score</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">30d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {snapshot.top_engaged_guests.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-gray-500" colSpan={3}>
                        No engagement scores available yet.
                      </td>
                    </tr>
                  ) : (
                    snapshot.top_engaged_guests.map((guest) => (
                      <tr key={guest.customer_id}>
                        <td className="px-3 py-2 text-gray-900">{guest.name}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">{formatNumber(guest.total_score)}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{formatNumber(guest.bookings_last_30)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h3 className="text-base font-semibold text-gray-900">Event Type Interest Segments</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Event Type</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Guests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {snapshot.event_type_interest_segments.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-gray-500" colSpan={2}>
                        No event type activity available yet.
                      </td>
                    </tr>
                  ) : (
                    snapshot.event_type_interest_segments.slice(0, 12).map((segment) => (
                      <tr key={segment.event_type}>
                        <td className="px-3 py-2 text-gray-900">{segment.event_type}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">{formatNumber(segment.guest_count)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card>
          <h3 className="text-base font-semibold text-gray-900">Review SMS vs Clicks</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Event Reviews</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{formatPercent(snapshot.review_sms_vs_clicks.event.click_rate_percent)}</p>
              <p className="text-sm text-gray-600">{formatNumber(snapshot.review_sms_vs_clicks.event.clicked)} clicks from {formatNumber(snapshot.review_sms_vs_clicks.event.sent)} sent</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Table Reviews</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{formatPercent(snapshot.review_sms_vs_clicks.table.click_rate_percent)}</p>
              <p className="text-sm text-gray-600">{formatNumber(snapshot.review_sms_vs_clicks.table.clicked)} clicks from {formatNumber(snapshot.review_sms_vs_clicks.table.sent)} sent</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Overall Reviews</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{formatPercent(snapshot.review_sms_vs_clicks.total.click_rate_percent)}</p>
              <p className="text-sm text-gray-600">{formatNumber(snapshot.review_sms_vs_clicks.total.clicked)} clicks from {formatNumber(snapshot.review_sms_vs_clicks.total.sent)} sent</p>
            </div>
          </div>
        </Card>
      </div>
    </PageLayout>
  )
}
