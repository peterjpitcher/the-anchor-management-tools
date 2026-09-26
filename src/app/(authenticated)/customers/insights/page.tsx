import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  loadCustomerInsightsSnapshot,
  resolveCustomerInsightsWindow,
  type CustomerInsightsSnapshot,
  type CustomerInsightsWindow
} from '@/lib/analytics/customer-insights'
import { PageLayout, Icon } from '@/ds'
import { Alert, Badge, BarChart, Card, CardBody, CardHeader, Empty, Section, Stat, StatGrid, SubHeading } from '@/ds'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds'
import { WinBackCampaign } from '@/components/features/customers/WinBackCampaign'
import { CUSTOMERS_NAV } from '../_shared/nav'
import { STRATEGIC_SIGNAL_TONE } from '../_shared/status-ui'
import { InsightsWindowPicker } from './_components/InsightsWindowPicker'

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

  const layoutProps = {
    title: 'Customers',
    subtitle: 'Strategy-focused customer intelligence',
    navItems: CUSTOMERS_NAV,
    headerActions: (
      <InsightsWindowPicker options={WINDOW_OPTIONS} value={snapshot?.selected_window.key ?? selectedWindow} />
    ),
  }

  if (!snapshot) {
    return <PageLayout {...layoutProps} error={errorMessage || 'Failed to load customer insights'} />
  }

  // Chart tokens. Each booking type keeps a colour close to its old one: event sky, table
  // brand green, private amber, parking violet.
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
    <PageLayout {...layoutProps}>
      {snapshot.data_warnings.length > 0 ? (
        <Alert tone="warning">{snapshot.data_warnings.join(' ')}</Alert>
      ) : null}

      {!hasMeaningfulData ? (
        <Card>
          <CardBody>
            <Empty
              size="sm"
              icon="chart"
              title="No customer insight data yet"
              description="Once customers and bookings are active, strategy signals will appear here."
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <Section
            title="Key Figures"
            description={`Last ${snapshot.selected_window.label}, generated ${formatGeneratedAt(snapshot.generated_at)}`}
          >
            <div className="space-y-4">
              <StatGrid columns={4}>
                <Stat
                  label="Total Customers"
                  value={formatNumber(snapshot.kpis.total_customers)}
                  icon={<Icon name="users" size={20} />}
                />
                <Stat
                  label="New Customers"
                  value={formatNumber(snapshot.kpis.new_customers)}
                  delta={snapshot.kpis.new_customer_growth_percent}
                  icon={<Icon name="userPlus" size={20} />}
                />
                <Stat
                  label="Active Customers"
                  value={formatNumber(snapshot.kpis.active_customers)}
                  hint={`${formatNumber(snapshot.kpis.repeat_active_customers)} repeat in-window`}
                  icon={<Icon name="users" size={20} />}
                />
                <Stat
                  label="Repeat Rate"
                  value={formatPercent(snapshot.kpis.repeat_rate_percent)}
                  icon={<Icon name="refresh" size={20} />}
                />
              </StatGrid>

              <StatGrid columns={2}>
                <Stat
                  label="Dormant Customers (90d+)"
                  value={formatNumber(snapshot.kpis.dormant_customers_90d)}
                  icon={<Icon name="userMinus" size={20} className="text-warning" />}
                />
                <Stat
                  label="Dormant High-Value Customers"
                  value={formatNumber(snapshot.kpis.dormant_high_value_customers_90d)}
                  icon={<Icon name="alertTriangle" size={20} className="text-danger" />}
                />
              </StatGrid>
            </div>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Booking Mix"
                subtitle={`Total bookings in window: ${formatNumber(snapshot.booking_mix.total_bookings)}`}
              />
              <CardBody className="space-y-4">
                <BarChart
                  data={bookingMixChartData}
                  height={280}
                  formatType="number"
                  seriesLabel="Bookings"
                  ariaLabel="Bookings in the window by booking type"
                />
                <div className="grid grid-cols-2 gap-2 text-sm text-text-muted">
                  <p>Event: {formatPercent(snapshot.booking_mix.shares_percent.event)}</p>
                  <p>Table: {formatPercent(snapshot.booking_mix.shares_percent.table)}</p>
                  <p>Private: {formatPercent(snapshot.booking_mix.shares_percent.private)}</p>
                  <p>Parking: {formatPercent(snapshot.booking_mix.shares_percent.parking)}</p>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Top Interest Categories"
                subtitle="Unique-customer interest concentration by category"
              />
              <CardBody>
                {categoryChartData.length === 0 ? (
                  <Empty size="sm" title="No category-preference data available" />
                ) : (
                  <BarChart
                    data={categoryChartData}
                    height={280}
                    formatType="number"
                    seriesLabel="Customers"
                    ariaLabel="Customers interested in each event category"
                  />
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="SMS Health Summary" />
              <CardBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
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

                <div>
                  <SubHeading>Top Failure Reasons</SubHeading>
                  {snapshot.sms_health.top_failure_reasons.length === 0 ? (
                    <p className="mt-2 text-sm text-text-muted">No dominant failure reason detected.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-border text-sm text-text">
                      {snapshot.sms_health.top_failure_reasons.map((item) => (
                        <li key={item.reason} className="flex items-center justify-between py-1.5">
                          <span>{item.reason}</span>
                          <span className="font-medium">{formatNumber(item.count)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Strategic Signals" />
              {snapshot.strategic_signals.length === 0 ? (
                <CardBody>
                  <Empty size="sm" title="No strategic signals" />
                </CardBody>
              ) : (
                <ul className="divide-y divide-border">
                  {snapshot.strategic_signals.map((signal) => (
                    <li key={signal.key} className="px-pad-card py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-text">{signal.title}</p>
                        <Badge tone={STRATEGIC_SIGNAL_TONE[signal.severity]} size="sm">
                          {signal.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-text">{signal.detail}</p>
                      <p className="mt-1 text-sm text-text-muted">{signal.recommendation}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Win-Back Candidates" subtitle="High-value customers dormant for 90+ days" />

            {snapshot.win_back_candidates.length === 0 ? (
              <CardBody>
                <Empty size="sm" title="No dormant high-value candidates detected in current scoring data" />
              </CardBody>
            ) : (
              <>
                <div className="hidden md:block">
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

                <ul className="divide-y divide-border md:hidden">
                  {snapshot.win_back_candidates.map((candidate) => (
                    <li key={candidate.customer_id} className="px-pad-card py-3">
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
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          {canManageCustomers && <WinBackCampaign />}
        </>
      )}
    </PageLayout>
  )
}
