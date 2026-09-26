import { getMonthlyReceiptInsights } from '@/app/actions/receipts'
import { MonthlyCharts, StackedBreakdownChart } from './MonthlyCharts'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Empty,
  LinkButton,
  Section,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { ReceiptsPageChrome } from '../_components/ReceiptsPageChrome'
import {
  RECEIPT_FLOW_TONE,
  RECEIPT_INSIGHT_LABEL,
  RECEIPT_INSIGHT_TONE,
  netAmountTextClass,
  type ReceiptInsightKind,
} from '../_shared/status-ui'

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const currencyCompactFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const percentFormatter = new Intl.NumberFormat('en-GB', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

const monthLongFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const monthShortFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

type BreakdownItem = { label: string; amount: number }

type VarianceItem = {
  label: string
  delta: number
  current: number
}

const RECEIPT_STATUSES = ['pending', 'completed', 'auto_completed', 'no_receipt_required', 'cant_find'] as const

// Chart series tokens. Each breakdown is its own chart, so both use the full categorical set:
// six shades of one hue were hard to tell apart.
const BREAKDOWN_PALETTE = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5', 'bg-chart-6']

function formatCurrency(value: number) {
  return currencyFormatter.format(value ?? 0)
}

function formatCurrencyCompact(value: number) {
  return currencyCompactFormatter.format(value ?? 0)
}

function formatMonthLabel(value: string) {
  return monthLongFormatter.format(new Date(value))
}

function computeVariance(current: BreakdownItem[], previous: BreakdownItem[] | undefined): VarianceItem[] {
  const previousMap = new Map<string, number>()
  previous?.forEach((item) => previousMap.set(item.label, item.amount))

  return current.map((item) => ({
    label: item.label,
    delta: item.amount - (previousMap.get(item.label) ?? 0),
    current: item.amount,
  }))
}

function diffLabel(delta: number) {
  const formatted = formatCurrencyCompact(Math.abs(delta))
  return delta >= 0 ? `+${formatted}` : `-${formatted}`
}

/** "+£120 · +5%", the change a figure made, or "No change". */
function changeText(delta?: number, percent?: number): string {
  const parts: string[] = []
  if (delta !== undefined && delta !== 0) {
    parts.push(diffLabel(delta))
  }
  if (percent !== undefined && percent !== 0) {
    const formatted = percentFormatter.format(Math.abs(percent))
    parts.push(`${percent > 0 ? '+' : '-'}${formatted}`)
  }
  return parts.length ? parts.join(' \u00b7 ') : 'No change'
}

const MONTHLY_SUBTITLE = 'Income and spending trends across recent months'

export default async function ReceiptsMonthlyPage() {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('receipts', 'view'),
    checkUserPermission('receipts', 'manage'),
  ])
  if (!canView) {
    redirect('/unauthorized')
  }

  const { months } = await getMonthlyReceiptInsights(12)

  if (months.length === 0) {
    return (
      <ReceiptsPageChrome subtitle={MONTHLY_SUBTITLE} navState={{ view: 'monthly' }} canManage={canManage}>
        <Card>
          <Empty
            size="sm"
            title="No receipt data yet"
            description="Upload a bank statement to start tracking monthly trends."
            action={
              <LinkButton href="/receipts" variant="secondary" size="sm">
                Go to Receipts Workspace
              </LinkButton>
            }
          />
        </Card>
      </ReceiptsPageChrome>
    )
  }

  const current = months[0]
  const previous = months[1]
  const trailingMonths = months.slice(1)

  const netCash = current.netCash
  const previousNet = previous?.netCash ?? 0
  const netDelta = netCash - previousNet
  const netDeltaPercent = previous && previousNet !== 0 ? netDelta / Math.abs(previousNet) : null

  const avgOutgoing = trailingMonths.length
    ? trailingMonths.reduce((sum, month) => sum + month.totalOutgoing, 0) / trailingMonths.length
    : current.totalOutgoing
  const outgoingDelta = current.totalOutgoing - avgOutgoing
  const outgoingDeltaPercent = avgOutgoing !== 0 ? outgoingDelta / avgOutgoing : null

  const currentStatusTotals = RECEIPT_STATUSES.reduce<Record<string, number>>((acc, status) => {
    acc[status] = current.statusCounts[status] ?? 0
    return acc
  }, {})

  const previousStatusTotals = previous
    ? RECEIPT_STATUSES.reduce<Record<string, number>>((acc, status) => {
        acc[status] = previous.statusCounts[status] ?? 0
        return acc
      }, {})
    : null

  const totalTransactions = RECEIPT_STATUSES.reduce((sum, status) => sum + currentStatusTotals[status], 0)
  const automatedTransactions =
    currentStatusTotals.auto_completed + currentStatusTotals.no_receipt_required
  const automationCoverage = totalTransactions > 0 ? automatedTransactions / totalTransactions : 0

  const previousAutomationCoverage = previousStatusTotals
    ? (() => {
        const total = RECEIPT_STATUSES.reduce((sum, status) => sum + previousStatusTotals[status], 0)
        const automated = previousStatusTotals.auto_completed + previousStatusTotals.no_receipt_required
        return total > 0 ? automated / total : 0
      })()
    : null

  const manualReceipts = currentStatusTotals.pending + currentStatusTotals.cant_find

  const spendingVariance = computeVariance(current.spendingBreakdown, previous?.spendingBreakdown)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const incomeVariance = computeVariance(current.incomeBreakdown, previous?.incomeBreakdown)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  const notableSpendIncrease = spendingVariance.find((item) => item.delta > 0)
  const notableSpendReduction = spendingVariance.find((item) => item.delta < 0)
  const notableIncomeIncrease = incomeVariance.find((item) => item.delta > 0)

  const chartPoints = months.map((month) => ({
    monthStart: month.monthStart,
    income: month.totalIncome,
    outgoing: month.totalOutgoing,
  }))

  const spendingStack = months.map((month) => ({
    monthStart: month.monthStart,
    segments: month.spendingBreakdown,
  }))

  const incomeStack = months.map((month) => ({
    monthStart: month.monthStart,
    segments: month.incomeBreakdown,
  }))

  const insightItems: Array<{ tone: ReceiptInsightKind; title: string; detail: string }> = []

  if (notableSpendIncrease && notableSpendIncrease.delta > 0) {
    insightItems.push({
      tone: 'negative',
      title: `Spending up on ${notableSpendIncrease.label}`,
      detail: `Up ${formatCurrencyCompact(notableSpendIncrease.delta)} vs last month.`,
    })
  }

  if (notableIncomeIncrease && notableIncomeIncrease.delta > 0) {
    insightItems.push({
      tone: 'positive',
      title: `Income boost from ${notableIncomeIncrease.label}`,
      detail: `Up ${formatCurrencyCompact(notableIncomeIncrease.delta)} vs last month.`,
    })
  }

  if (notableSpendReduction && notableSpendReduction.delta < 0) {
    insightItems.push({
      tone: 'positive',
      title: `Reduced spend on ${notableSpendReduction.label}`,
      detail: `Down ${formatCurrencyCompact(Math.abs(notableSpendReduction.delta))} vs last month.`,
    })
  }

  if (manualReceipts > 0) {
    insightItems.push({
      tone: 'neutral',
      title: `${manualReceipts} receipts still need attention`,
      detail: 'Review “Outstanding only” in the workspace to clear these down.',
    })
  }

  return (
    <ReceiptsPageChrome subtitle={MONTHLY_SUBTITLE} navState={{ view: 'monthly' }} canManage={canManage}>
      <StatGrid columns={3}>
        <Stat
          label={`Net cash \u00b7 ${formatMonthLabel(current.monthStart)}`}
          value={formatCurrency(netCash)}
          hint={[
            changeText(netDelta, netDeltaPercent ?? undefined),
            previous ? `Previous month ${formatCurrency(previous.netCash)}` : null,
          ].filter(Boolean).join('. ')}
        />
        <Stat
          label="Spending vs rolling average"
          value={formatCurrency(current.totalOutgoing)}
          hint={`${changeText(outgoingDelta, outgoingDeltaPercent ?? undefined)}. Avg of prior months ${formatCurrency(avgOutgoing)}`}
        />
        <Stat
          label="Automation coverage"
          value={percentFormatter.format(automationCoverage)}
          hint={[
            previousAutomationCoverage !== null ? changeText(automationCoverage - previousAutomationCoverage) : null,
            `${automatedTransactions} / ${totalTransactions} receipts auto matched`,
          ].filter(Boolean).join('. ')}
        />
      </StatGrid>

      <MonthlyCharts data={chartPoints} />

      <div className="grid gap-6 xl:grid-cols-[2fr_2fr_1fr]">
        <StackedBreakdownChart
          title="Where Spending Went"
          data={spendingStack}
          palette={BREAKDOWN_PALETTE}
          emptyDescription="No spending recorded for the selected period."
        />
        <StackedBreakdownChart
          title="Income Sources"
          data={incomeStack}
          palette={BREAKDOWN_PALETTE}
          emptyDescription="No income recorded for the selected period."
        />
        <InsightsFeed items={insightItems} />
      </div>

      <Section title="Monthly Breakdown">
        {/* Desktop and tablet: table (from 768px) */}
        <Card padding="none" className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead align="right">Income</TableHead>
                <TableHead align="right">Outgoings</TableHead>
                <TableHead align="right">Net cash</TableHead>
                <TableHead align="right">Automation</TableHead>
                <TableHead>Top income sources</TableHead>
                <TableHead>Top outgoing vendors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((month) => {
                const monthLabel = formatMonthLabel(month.monthStart)
                const totalMonthReceipts = RECEIPT_STATUSES.reduce(
                  (sum, status) => sum + (month.statusCounts[status] ?? 0),
                  0,
                )
                const automatedMonthReceipts =
                  (month.statusCounts.auto_completed ?? 0) + (month.statusCounts.no_receipt_required ?? 0)
                const automationRate =
                  totalMonthReceipts > 0 ? automatedMonthReceipts / totalMonthReceipts : 0

                return (
                  <TableRow key={month.monthStart}>
                    <TableCell className="font-medium text-text-strong">{monthLabel}</TableCell>
                    <TableCell align="right" className="tabular-nums">{formatCurrency(month.totalIncome)}</TableCell>
                    <TableCell align="right" className="tabular-nums">{formatCurrency(month.totalOutgoing)}</TableCell>
                    <TableCell align="right" className={`tabular-nums ${netAmountTextClass(month.netCash)}`}>
                      {formatCurrency(month.netCash)}
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {percentFormatter.format(automationRate)}
                      <span className="ml-1 text-xs text-text-muted">({automatedMonthReceipts}/{totalMonthReceipts})</span>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <TopList items={month.incomeBreakdown.slice(0, 3)} emptyLabel="No income recorded" flow="income" />
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <TopList items={month.topOutgoing.slice(0, 3)} emptyLabel="No outgoings recorded" flow="spend" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>

        {/* Phones: one card per month (below 768px) */}
        <div className="space-y-3 md:hidden">
          {months.map((month) => {
            const monthLabel = formatMonthLabel(month.monthStart)
            const totalMonthReceipts = RECEIPT_STATUSES.reduce(
              (sum, status) => sum + (month.statusCounts[status] ?? 0),
              0,
            )
            const automatedMonthReceipts =
              (month.statusCounts.auto_completed ?? 0) + (month.statusCounts.no_receipt_required ?? 0)
            const automationRate = totalMonthReceipts > 0 ? automatedMonthReceipts / totalMonthReceipts : 0

            return (
              <Card key={month.monthStart}>
                <CardHeader title={monthLabel} />
                <CardBody className="space-y-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Income</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-text-strong">{formatCurrency(month.totalIncome)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Outgoings</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-text-strong">{formatCurrency(month.totalOutgoing)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Net cash</dt>
                      <dd className={`mt-0.5 font-medium tabular-nums ${netAmountTextClass(month.netCash)}`}>
                        {formatCurrency(month.netCash)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Automation</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-text-strong">
                        {percentFormatter.format(automationRate)}
                        <span className="ml-1 text-xs font-normal text-text-muted">({automatedMonthReceipts}/{totalMonthReceipts})</span>
                      </dd>
                    </div>
                  </dl>
                  <div className="border-t border-border pt-3">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Top income sources</p>
                    <TopList items={month.incomeBreakdown.slice(0, 3)} emptyLabel="No income recorded" flow="income" />
                  </div>
                  <div className="border-t border-border pt-3">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Top outgoing vendors</p>
                    <TopList items={month.topOutgoing.slice(0, 3)} emptyLabel="No outgoings recorded" flow="spend" />
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      </Section>
    </ReceiptsPageChrome>
  )
}

function InsightsFeed({
  items,
}: {
  items: Array<{ tone: ReceiptInsightKind; title: string; detail: string }>
}) {
  return (
    <Card className="h-full">
      <CardHeader title="What Changed This Month" />
      <CardBody>
        {items.length === 0 ? (
          <Empty
            size="sm"
            title="Steady month"
            description="No significant changes detected. Keep an eye on receipts for any anomalies."
          />
        ) : (
          <ol className="divide-y divide-border">
            {items.map((item, index) => (
              <li key={`${item.title}-${index}`} className="py-3 first:pt-0 last:pb-0">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={RECEIPT_INSIGHT_TONE[item.tone]}>{RECEIPT_INSIGHT_LABEL[item.tone]}</Badge>
                  <span className="text-sm font-semibold text-text">{item.title}</span>
                </div>
                <p className="text-xs text-text-muted">{item.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}

function TopList({
  items,
  emptyLabel,
  flow,
}: {
  items: Array<{ label: string; amount: number }>
  emptyLabel: string
  flow: 'income' | 'spend'
}) {
  if (!items.length) {
    return <p className="text-xs text-text-soft">{emptyLabel}</p>
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-text-strong" title={item.label}>{item.label}</span>
          <Badge tone={RECEIPT_FLOW_TONE[flow]} className="shrink-0">{formatCurrencyCompact(item.amount)}</Badge>
        </div>
      ))}
    </div>
  )
}
