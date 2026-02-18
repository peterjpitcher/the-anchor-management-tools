import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  UserPlusIcon,
  UsersIcon,
  UserGroupIcon,
  UserMinusIcon,
} from '@heroicons/react/24/outline'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  loadCustomerInsightsSnapshot,
  resolveCustomerInsightsWindow,
  type CustomerInsightsSnapshot,
  type CustomerInsightsWindow,
  type StrategicSignal
} from '@/lib/analytics/customer-insights'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat'
import { Badge } from '@/components/ui-v2/display/Badge'
import { BarChart } from '@/components/charts/BarChart'

const WINDOW_OPTIONS: Array<{ key: CustomerInsightsWindow; label: string }> = [
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '365d', label: '12 months' }
]

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value)
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatSignedPercent(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

function formatDate(value: string | null): string {
  if (!value) return 'N/A'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatGeneratedAt(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(iso))
}

function signalBadgeVariant(signal: StrategicSignal): 'success' | 'warning' | 'error' | 'info' {
  if (signal.severity === 'positive') return 'success'
  if (signal.severity === 'watch') return 'warning'
  if (signal.severity === 'risk') return 'error'
  return 'info'
}

type CustomerInsightsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function CustomersInsightsPage({ searchParams }: CustomerInsightsPageProps) {
  const canViewCustomers = await checkUserPermission('customers', 'view')
  if (!canViewCustomers) {
    redirect('/unauthorized')
  }

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const windowParamRaw = resolvedSearchParams.window
  const windowParam = Array.isArray(windowParamRaw) ? windowParamRaw[0] : windowParamRaw
  const selectedWindow = resolveCustomerInsightsWindow(typeof windowParam === 'string' ? windowParam : null)

  let snapshot: CustomerInsightsSnapshot | null = null
  let errorMessage: string | null = null

  try {
    snapshot = await loadCustomerInsightsSnapshot({ window: selectedWindow })
  } catch (error) {
    console.error('Failed to load customer insights:', error)
    errorMessage = 'Failed to load customer insights'
  }

  const navItems = [
    { label: 'Overview', href: '/customers' },
    { label: 'Insights', href: '/customers/insights', active: true }
  ]

  if (!snapshot) {
    return (
      <PageLayout
        title="Customers"
        subtitle="Strategy-focused customer intelligence"
        navItems={navItems}
        error={errorMessage || 'Failed to load customer insights'}
      />
    )
  }

  const bookingMixChartData = [
    { label: 'Event', value: snapshot.booking_mix.by_type.event, color: '#2563EB' },
    { label: 'Table', value: snapshot.booking_mix.by_type.table, color: '#059669' },
    { label: 'Private', value: snapshot.booking_mix.by_type.private, color: '#F59E0B' },
    { label: 'Parking', value: snapshot.booking_mix.by_type.parking, color: '#8B5CF6' }
  ]

  const categoryChartData = snapshot.top_interest_categories.slice(0, 8).map((segment) => ({
    label: segment.category_name,
    value: segment.customer_count,
    color: '#0EA5E9'
  }))

  const hasMeaningfulData =
    snapshot.kpis.total_customers > 0 ||
    snapshot.booking_mix.total_bookings > 0 ||
    snapshot.top_interest_categories.length > 0 ||
    snapshot.win_back_candidates.length > 0

  return (
    <PageLayout
      title="Customers"
      subtitle="Strategy-focused customer intelligence"
      navItems={navItems}
    >
      <div className="space-y-6">
        <Card>
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-600">
                Generated: <span className="font-medium text-gray-900">{formatGeneratedAt(snapshot.generated_at)}</span>
              </p>
              <p className="text-sm text-gray-600">
                Window: <span className="font-medium text-gray-900">{snapshot.selected_window.label}</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {WINDOW_OPTIONS.map((option) => {
                const isActive = option.key === snapshot.selected_window.key
                return (
                  <Link
                    key={option.key}
                    href={`/customers/insights?window=${option.key}`}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                      isActive
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-800'
                    }`}
                  >
                    {option.label}
                  </Link>
                )
              })}
            </div>

            {snapshot.data_warnings.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {snapshot.data_warnings.join(' ')}
              </div>
            ) : null}
          </div>
        </Card>

        {!hasMeaningfulData ? (
          <Card>
            <div className="px-4 py-6 text-sm text-gray-600">
              No customer insight data is available yet. Once customers and bookings are active, strategy signals will appear here.
            </div>
          </Card>
        ) : (
          <>
            <Card>
              <StatGroup columns={4}>
                <Stat
                  label="Total Customers"
                  value={formatNumber(snapshot.kpis.total_customers)}
                  icon={<UsersIcon className="h-5 w-5 text-blue-500" />}
                  variant="bordered"
                />
                <Stat
                  label="New Customers"
                  value={formatNumber(snapshot.kpis.new_customers)}
                  change={formatSignedPercent(snapshot.kpis.new_customer_growth_percent)}
                  changeType={snapshot.kpis.new_customer_growth_percent >= 0 ? 'increase' : 'decrease'}
                  icon={<UserPlusIcon className="h-5 w-5 text-emerald-500" />}
                  variant="bordered"
                />
                <Stat
                  label="Active Customers"
                  value={formatNumber(snapshot.kpis.active_customers)}
                  description={`${formatNumber(snapshot.kpis.repeat_active_customers)} repeat in-window`}
                  icon={<UserGroupIcon className="h-5 w-5 text-indigo-500" />}
                  variant="bordered"
                />
                <Stat
                  label="Repeat Rate"
                  value={formatPercent(snapshot.kpis.repeat_rate_percent)}
                  icon={<ArrowPathIcon className="h-5 w-5 text-cyan-500" />}
                  variant="bordered"
                />
              </StatGroup>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Stat
                  label="Dormant Customers (90d+)"
                  value={formatNumber(snapshot.kpis.dormant_customers_90d)}
                  icon={<UserMinusIcon className="h-5 w-5 text-amber-500" />}
                  variant="bordered"
                />
                <Stat
                  label="Dormant High-Value Customers"
                  value={formatNumber(snapshot.kpis.dormant_high_value_customers_90d)}
                  icon={<ExclamationTriangleIcon className="h-5 w-5 text-red-500" />}
                  variant="bordered"
                />
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h3 className="text-base font-semibold text-gray-900">Booking Mix</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Total bookings in window: {formatNumber(snapshot.booking_mix.total_bookings)}
                </p>
                <div className="mt-4 h-[280px] rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <BarChart
                    data={bookingMixChartData}
                    height={250}
                    formatType="number"
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-600">
                  <p>Event: {formatPercent(snapshot.booking_mix.shares_percent.event)}</p>
                  <p>Table: {formatPercent(snapshot.booking_mix.shares_percent.table)}</p>
                  <p>Private: {formatPercent(snapshot.booking_mix.shares_percent.private)}</p>
                  <p>Parking: {formatPercent(snapshot.booking_mix.shares_percent.parking)}</p>
                </div>
              </Card>

              <Card>
                <h3 className="text-base font-semibold text-gray-900">Top Interest Categories</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Unique-customer interest concentration by category
                </p>
                {categoryChartData.length === 0 ? (
                  <p className="mt-6 text-sm text-gray-500">No category-preference data available.</p>
                ) : (
                  <div className="mt-4 h-[280px] rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <BarChart data={categoryChartData} height={250} formatType="number" />
                  </div>
                )}
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h3 className="text-base font-semibold text-gray-900">SMS Health Summary</h3>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-gray-500">Opted-in Customers</dt>
                    <dd className="font-semibold text-gray-900">{formatNumber(snapshot.sms_health.opted_in_customers)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Opt-in Rate</dt>
                    <dd className="font-semibold text-gray-900">{formatPercent(snapshot.sms_health.sms_opt_in_rate_percent)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">At-risk Customers</dt>
                    <dd className="font-semibold text-gray-900">{formatNumber(snapshot.sms_health.sms_at_risk_count)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">At-risk Share</dt>
                    <dd className="font-semibold text-gray-900">{formatPercent(snapshot.sms_health.sms_at_risk_rate_percent)}</dd>
                  </div>
                </dl>

                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700">Top Failure Reasons</h4>
                  {snapshot.sms_health.top_failure_reasons.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">No dominant failure reason detected.</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm text-gray-700">
                      {snapshot.sms_health.top_failure_reasons.map((item) => (
                        <li key={item.reason} className="flex items-center justify-between rounded border border-gray-200 px-3 py-1.5">
                          <span>{item.reason}</span>
                          <span className="font-medium">{formatNumber(item.count)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>

              <Card>
                <h3 className="text-base font-semibold text-gray-900">Strategic Signals</h3>
                <div className="mt-3 space-y-3">
                  {snapshot.strategic_signals.map((signal) => (
                    <div key={signal.key} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-gray-900">{signal.title}</p>
                        <Badge variant={signalBadgeVariant(signal)} size="sm">
                          {signal.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-gray-700">{signal.detail}</p>
                      <p className="mt-1 text-sm text-gray-500">{signal.recommendation}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card>
              <h3 className="text-base font-semibold text-gray-900">Win-back Candidates</h3>
              <p className="mt-1 text-sm text-gray-600">
                High-value customers dormant for 90+ days
              </p>

              {snapshot.win_back_candidates.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No dormant high-value candidates detected in current scoring data.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Customer</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Score</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">90d</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">365d</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Last booking</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {snapshot.win_back_candidates.map((candidate) => (
                        <tr key={candidate.customer_id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900">{candidate.name}</p>
                            {candidate.mobile ? <p className="text-xs text-gray-500">{candidate.mobile}</p> : null}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">{formatNumber(candidate.total_score)}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{formatNumber(candidate.bookings_last_90)}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{formatNumber(candidate.bookings_last_365)}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {formatDate(candidate.last_booking_date)}
                            {candidate.days_since_last_booking !== null ? (
                              <span className="ml-1 text-xs text-gray-500">({candidate.days_since_last_booking}d ago)</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  )
}
