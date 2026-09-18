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
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { Stat, StatGroup } from '@/ds'
import { Badge } from '@/ds'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds'
import { BarChart } from '@/components/charts/BarChart'
import { WinBackCampaign } from '@/components/features/customers/WinBackCampaign'

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

function signalBadgeTone(signal: StrategicSignal): 'success' | 'warning' | 'danger' | 'info' {
  if (signal.severity === 'positive') return 'success'
  if (signal.severity === 'watch') return 'warning'
  if (signal.severity === 'risk') return 'danger'
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

  const canManageCustomers = await checkUserPermission('customers', 'manage')

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
    { label: 'Insights', href: '/customers/insights' },
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

  // Chart tokens (the canvas BarChart resolves var() colours). Each booking type keeps a
  // colour close to its old one: event sky, table brand green, private amber, parking violet.
  const bookingMixChartData = [
    { label: 'Event', value: snapshot.booking_mix.by_type.event, color: 'var(--color-chart-2)' },
    { label: 'Table', value: snapshot.booking_mix.by_type.table, color: 'var(--color-chart-1)' },
    { label: 'Private', value: snapshot.booking_mix.by_type.private, color: 'var(--color-chart-3)' },
    { label: 'Parking', value: snapshot.booking_mix.by_type.parking, color: 'var(--color-chart-4)' }
  ]

  const categoryChartData = snapshot.top_interest_categories.slice(0, 8).map((segment) => ({
    label: segment.category_name,
    value: segment.customer_count,
    color: 'var(--color-chart-1)'
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
              <p className="text-sm text-text-muted">
                Generated: <span className="font-medium text-text">{formatGeneratedAt(snapshot.generated_at)}</span>
              </p>
              <p className="text-sm text-text-muted">
                Window: <span className="font-medium text-text">{snapshot.selected_window.label}</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {WINDOW_OPTIONS.map((option) => {
                const isActive = option.key === snapshot.selected_window.key
                return (
                  <Link
                    key={option.key}
                    href={`/customers/insights?window=${option.key}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-hidden focus-visible:shadow-ring ${
                      isActive
                        ? 'border-primary bg-primary-soft text-primary-soft-fg'
                        : 'border-border-strong bg-surface text-text-muted hover:bg-surface-hover hover:text-text'
                    }`}
                  >
                    {option.label}
                  </Link>
                )
              })}
            </div>

            {snapshot.data_warnings.length > 0 ? (
              <div className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning-fg">
                {snapshot.data_warnings.join(' ')}
              </div>
            ) : null}
          </div>
        </Card>

        {!hasMeaningfulData ? (
          <Card>
            <div className="px-4 py-6 text-sm text-text-muted">
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
                  icon={<UsersIcon className="h-5 w-5" />}
                  variant="bordered"
                />
                <Stat
                  label="New Customers"
                  value={formatNumber(snapshot.kpis.new_customers)}
                  delta={snapshot.kpis.new_customer_growth_percent}
                  icon={<UserPlusIcon className="h-5 w-5" />}
                  variant="bordered"
                />
                <Stat
                  label="Active Customers"
                  value={formatNumber(snapshot.kpis.active_customers)}
                  description={`${formatNumber(snapshot.kpis.repeat_active_customers)} repeat in-window`}
                  icon={<UserGroupIcon className="h-5 w-5" />}
                  variant="bordered"
                />
                <Stat
                  label="Repeat Rate"
                  value={formatPercent(snapshot.kpis.repeat_rate_percent)}
                  icon={<ArrowPathIcon className="h-5 w-5" />}
                  variant="bordered"
                />
              </StatGroup>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Stat
                  label="Dormant Customers (90d+)"
                  value={formatNumber(snapshot.kpis.dormant_customers_90d)}
                  icon={<UserMinusIcon className="h-5 w-5 text-warning" />}
                  variant="bordered"
                />
                <Stat
                  label="Dormant High-Value Customers"
                  value={formatNumber(snapshot.kpis.dormant_high_value_customers_90d)}
                  icon={<ExclamationTriangleIcon className="h-5 w-5 text-danger" />}
                  variant="bordered"
                />
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h3 className="text-base font-semibold text-text">Booking Mix</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Total bookings in window: {formatNumber(snapshot.booking_mix.total_bookings)}
                </p>
                <div className="mt-4 h-[280px] rounded-lg border border-border bg-surface-2 p-3">
                  <BarChart
                    data={bookingMixChartData}
                    height={250}
                    formatType="number"
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-text-muted">
                  <p>Event: {formatPercent(snapshot.booking_mix.shares_percent.event)}</p>
                  <p>Table: {formatPercent(snapshot.booking_mix.shares_percent.table)}</p>
                  <p>Private: {formatPercent(snapshot.booking_mix.shares_percent.private)}</p>
                  <p>Parking: {formatPercent(snapshot.booking_mix.shares_percent.parking)}</p>
                </div>
              </Card>

              <Card>
                <h3 className="text-base font-semibold text-text">Top Interest Categories</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Unique-customer interest concentration by category
                </p>
                {categoryChartData.length === 0 ? (
                  <p className="mt-6 text-sm text-text-muted">No category-preference data available.</p>
                ) : (
                  <div className="mt-4 h-[280px] rounded-lg border border-border bg-surface-2 p-3">
                    <BarChart data={categoryChartData} height={250} formatType="number" />
                  </div>
                )}
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h3 className="text-base font-semibold text-text">SMS Health Summary</h3>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-text-muted">Opted-in Customers</dt>
                    <dd className="font-semibold text-text">{formatNumber(snapshot.sms_health.opted_in_customers)}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Opt-in Rate</dt>
                    <dd className="font-semibold text-text">{formatPercent(snapshot.sms_health.sms_opt_in_rate_percent)}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">At-risk Customers</dt>
                    <dd className="font-semibold text-text">{formatNumber(snapshot.sms_health.sms_at_risk_count)}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">At-risk Share</dt>
                    <dd className="font-semibold text-text">{formatPercent(snapshot.sms_health.sms_at_risk_rate_percent)}</dd>
                  </div>
                </dl>

                <div className="mt-4">
                  <h4 className="text-sm font-medium text-text">Top Failure Reasons</h4>
                  {snapshot.sms_health.top_failure_reasons.length === 0 ? (
                    <p className="mt-2 text-sm text-text-muted">No dominant failure reason detected.</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm text-text">
                      {snapshot.sms_health.top_failure_reasons.map((item) => (
                        <li key={item.reason} className="flex items-center justify-between rounded-sm border border-border px-3 py-1.5">
                          <span>{item.reason}</span>
                          <span className="font-medium">{formatNumber(item.count)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>

              <Card>
                <h3 className="text-base font-semibold text-text">Strategic Signals</h3>
                <div className="mt-3 space-y-3">
                  {snapshot.strategic_signals.map((signal) => (
                    <div key={signal.key} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-text">{signal.title}</p>
                        <Badge tone={signalBadgeTone(signal)} size="sm">
                          {signal.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-text">{signal.detail}</p>
                      <p className="mt-1 text-sm text-text-muted">{signal.recommendation}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card>
              <h3 className="text-base font-semibold text-text">Win-back Candidates</h3>
              <p className="mt-1 text-sm text-text-muted">
                High-value customers dormant for 90+ days
              </p>

              {snapshot.win_back_candidates.length === 0 ? (
                <p className="mt-4 text-sm text-text-muted">No dormant high-value candidates detected in current scoring data.</p>
              ) : (
                <div className="mt-4 hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead align="right">Score</TableHead>
                        <TableHead align="right">90d</TableHead>
                        <TableHead align="right">365d</TableHead>
                        <TableHead>Last booking</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.win_back_candidates.map((candidate) => (
                        <TableRow key={candidate.customer_id}>
                          <TableCell>
                            <p className="font-medium text-text">{candidate.name}</p>
                            {candidate.mobile ? <p className="text-xs text-text-muted">{candidate.mobile}</p> : null}
                          </TableCell>
                          <TableCell align="right" className="font-medium">{formatNumber(candidate.total_score)}</TableCell>
                          <TableCell align="right">{formatNumber(candidate.bookings_last_90)}</TableCell>
                          <TableCell align="right">{formatNumber(candidate.bookings_last_365)}</TableCell>
                          <TableCell>
                            {formatDate(candidate.last_booking_date)}
                            {candidate.days_since_last_booking !== null ? (
                              <span className="ml-1 text-xs text-text-muted">({candidate.days_since_last_booking}d ago)</span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {snapshot.win_back_candidates.length > 0 ? (
                <div className="mt-4 space-y-3 md:hidden">
                  {snapshot.win_back_candidates.map((candidate) => (
                    <div key={candidate.customer_id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-text">{candidate.name}</p>
                          {candidate.mobile ? <p className="text-xs text-text-muted">{candidate.mobile}</p> : null}
                        </div>
                        <Badge size="sm" className="flex-shrink-0">
                          Score {formatNumber(candidate.total_score)}
                        </Badge>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <dt className="text-text-muted">90d bookings</dt>
                          <dd className="font-medium text-text">{formatNumber(candidate.bookings_last_90)}</dd>
                        </div>
                        <div>
                          <dt className="text-text-muted">365d bookings</dt>
                          <dd className="font-medium text-text">{formatNumber(candidate.bookings_last_365)}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-text-muted">Last booking</dt>
                          <dd className="text-text">
                            {formatDate(candidate.last_booking_date)}
                            {candidate.days_since_last_booking !== null ? (
                              <span className="ml-1 text-xs text-text-muted">({candidate.days_since_last_booking}d ago)</span>
                            ) : null}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>

            {canManageCustomers && (
              <Card>
                <h3 className="text-base font-semibold text-text mb-3">Campaigns</h3>
                <WinBackCampaign />
              </Card>
            )}
          </>
        )}
      </div>
    </PageLayout>
  )
}
