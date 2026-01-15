import { getMonthlyReceiptInsights } from '@/app/actions/receipts'
import { MonthlyCharts, StackedBreakdownChart } from './MonthlyCharts'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getReceiptsNavItems } from '../receiptsNavItems'

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

const SPENDING_PALETTE = ['bg-rose-500', 'bg-rose-400', 'bg-rose-300', 'bg-rose-200', 'bg-rose-600', 'bg-rose-700']
const INCOME_PALETTE = ['bg-emerald-500', 'bg-emerald-400', 'bg-emerald-300', 'bg-emerald-200', 'bg-emerald-700', 'bg-emerald-600']

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

function changeTone(delta: number) {
  if (delta > 0) return 'negative' as const
  if (delta < 0) return 'positive' as const
  return 'neutral' as const
}

export default async function ReceiptsMonthlyPage() {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const { months } = await getMonthlyReceiptInsights(12)

  if (months.length === 0) {
    return (
      <PageLayout
        title="Monthly receipts overview"
        subtitle="Track income and spending trends across recent months."
        navItems={getReceiptsNavItems({ view: 'monthly' })}
      >
        <EmptyState
          title="No receipt data yet"
          description="Upload a bank statement to start tracking monthly trends."
          action={<Link href="/receipts" className="text-emerald-600 hover:text-emerald-500">Go to receipts workspace</Link>}
        />
      </PageLayout>
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

  const insightItems: Array<{ tone: 'positive' | 'negative' | 'neutral'; title: string; detail: string }> = []

  if (notableSpendIncrease && notableSpendIncrease.delta > 0) {
    insightItems.push({
      tone: 'negative',
      title: `Spending up on ${notableSpendIncrease.label}`,
      detail: `Up ${diffLabel(notableSpendIncrease.delta)} vs last month.`,
    })
  }

  if (notableIncomeIncrease && notableIncomeIncrease.delta > 0) {
    insightItems.push({
      tone: 'positive',
      title: `Income boost from ${notableIncomeIncrease.label}`,
      detail: `Up ${diffLabel(notableIncomeIncrease.delta)} vs last month.`,
    })
  }

  if (notableSpendReduction && notableSpendReduction.delta < 0) {
    insightItems.push({
      tone: 'positive',
      title: `Reduced spend on ${notableSpendReduction.label}`,
      detail: `Down ${diffLabel(notableSpendReduction.delta)} vs last month.`,
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
    <PageLayout
      title="Monthly receipts overview"
      subtitle="Track income and spending trends across recent months."
      backButton={{ label: 'Back to receipts', href: '/receipts' }}
      navItems={getReceiptsNavItems({ view: 'monthly' })}
    >
      <section className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <StatCard
            label={`Net cash · ${formatMonthLabel(current.monthStart)}`}
            value={formatCurrency(netCash)}
            delta={netDelta}
            deltaPercent={netDeltaPercent ?? undefined}
            tone={netCash >= 0 ? 'positive' : 'negative'}
            footnote={previous ? `Previous month ${formatCurrency(previous.netCash)}` : undefined}
          />
          <StatCard
            label="Spending vs rolling average"
            value={formatCurrency(current.totalOutgoing)}
            delta={outgoingDelta}
            deltaPercent={outgoingDeltaPercent ?? undefined}
            tone={outgoingDelta <= 0 ? 'positive' : 'negative'}
            footnote={`Avg of prior months ${formatCurrency(avgOutgoing)}`}
          />
          <StatCard
            label="Automation coverage"
            value={percentFormatter.format(automationCoverage)}
            delta={previousAutomationCoverage !== null ? automationCoverage - previousAutomationCoverage : undefined}
            tone={automationCoverage >= 0.8 ? 'positive' : automationCoverage >= 0.6 ? 'neutral' : 'negative'}
            footnote={`${automatedTransactions} / ${totalTransactions} receipts auto matched`}
          />
        </div>

        <MonthlyCharts data={chartPoints} />

        <div className="grid gap-6 xl:grid-cols-[2fr,2fr,1fr]">
          <StackedBreakdownChart
            title="Where spending went"
            data={spendingStack}
            palette={SPENDING_PALETTE}
            emptyDescription="No spending recorded for the selected period."
          />
          <StackedBreakdownChart
            title="Income sources"
            data={incomeStack}
            palette={INCOME_PALETTE}
            emptyDescription="No income recorded for the selected period."
          />
          <InsightsFeed items={insightItems} />
        </div>

        <Card variant="bordered" header={<h2 className="text-lg font-semibold text-gray-900">Monthly breakdown</h2>}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Month</th>
                  <th className="px-4 py-3 text-right">Income</th>
                  <th className="px-4 py-3 text-right">Outgoings</th>
                  <th className="px-4 py-3 text-right">Net cash</th>
                  <th className="px-4 py-3 text-right">Automation</th>
                  <th className="px-4 py-3">Top income sources</th>
                  <th className="px-4 py-3">Top outgoing vendors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
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
                    <tr key={month.monthStart}>
                      <td className="px-4 py-3 font-medium text-gray-900">{monthLabel}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(month.totalIncome)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(month.totalOutgoing)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${month.netCash >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {formatCurrency(month.netCash)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {percentFormatter.format(automationRate)}
                        <span className="ml-1 text-xs text-gray-500">({automatedMonthReceipts}/{totalMonthReceipts})</span>
                      </td>
                      <td className="px-4 py-3">
                        <TopList items={month.incomeBreakdown.slice(0, 3)} emptyLabel="No income recorded" badgeTone="income" />
                      </td>
                      <td className="px-4 py-3">
                        <TopList items={month.topOutgoing.slice(0, 3)} emptyLabel="No outgoings recorded" badgeTone="spend" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </PageLayout>
  )
}

function StatCard({
  label,
  value,
  delta,
  deltaPercent,
  footnote,
  tone,
}: {
  label: string
  value: string
  delta?: number
  deltaPercent?: number
  footnote?: string
  tone: 'positive' | 'negative' | 'neutral'
}) {
  const toneClasses =
    tone === 'positive'
      ? 'border-emerald-100 bg-emerald-50/40'
      : tone === 'negative'
        ? 'border-rose-100 bg-rose-50/40'
        : 'border-gray-100 bg-gray-50/40'

  return (
    <Card variant="bordered" className={`h-full ${toneClasses}`}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{label}</p>
        <p className="text-3xl font-semibold text-gray-900">{value}</p>
        {(delta !== undefined || deltaPercent !== undefined) && (
          <ChangePill delta={delta} percent={deltaPercent} />
        )}
        {footnote && <p className="text-xs text-gray-500">{footnote}</p>}
      </div>
    </Card>
  )
}

function ChangePill({ delta, percent }: { delta?: number; percent?: number }) {
  if (delta === undefined && percent === undefined) {
    return null
  }

  const tone = delta !== undefined && delta > 0 ? 'negative' : delta !== undefined && delta < 0 ? 'positive' : 'neutral'
  const toneClasses =
    tone === 'positive'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'negative'
        ? 'bg-rose-100 text-rose-700'
        : 'bg-gray-100 text-gray-600'

  const parts: string[] = []
  if (delta !== undefined && delta !== 0) {
    parts.push(diffLabel(delta))
  }
  if (percent !== undefined && percent !== 0) {
    const formatted = percentFormatter.format(Math.abs(percent))
    parts.push(`${percent > 0 ? '+' : '-'}${formatted}`)
  }

  if (!parts.length) {
    parts.push('No change')
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${toneClasses}`}>
      {parts.join(' · ')}
    </span>
  )
}

function InsightsFeed({
  items,
}: {
  items: Array<{ tone: 'positive' | 'negative' | 'neutral'; title: string; detail: string }>
}) {
  return (
    <Card
      variant="bordered"
      className="h-full"
      header={<h3 className="text-base font-semibold text-gray-900">What changed this month</h3>}
    >
      {items.length === 0 ? (
        <EmptyState title="Steady month" description="No significant changes detected. Keep an eye on receipts for any anomalies." />
      ) : (
        <ol className="space-y-3">
          {items.map((item, index) => {
            const badgeTone =
              item.tone === 'positive'
                ? 'bg-emerald-100 text-emerald-700'
                : item.tone === 'negative'
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-gray-100 text-gray-600'
            const badgeLabel =
              item.tone === 'positive' ? 'Opportunity' : item.tone === 'negative' ? 'Alert' : 'Watchlist'

            return (
              <li key={`${item.title}-${index}`} className="rounded-lg border border-gray-200 bg-white/60 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeTone}`}>
                    {badgeLabel}
                  </span>
                  <span className="text-sm font-semibold text-gray-800">{item.title}</span>
                </div>
                <p className="text-xs text-gray-600">{item.detail}</p>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

function TopList({
  items,
  emptyLabel,
  badgeTone,
}: {
  items: Array<{ label: string; amount: number }>
  emptyLabel: string
  badgeTone: 'income' | 'spend'
}) {
  if (!items.length) {
    return <p className="text-xs text-gray-400">{emptyLabel}</p>
  }

  const badgeStyles =
    badgeTone === 'income' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-gray-900" title={item.label}>{item.label}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeStyles}`}>{formatCurrencyCompact(item.amount)}</span>
        </div>
      ))}
    </div>
  )
}
