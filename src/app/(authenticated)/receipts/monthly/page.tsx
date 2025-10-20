import { getMonthlyReceiptSummary } from '@/app/actions/receipts'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

export const runtime = 'nodejs'

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value ?? 0)
}

function formatMonthLabel(isoDate: string) {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default async function ReceiptsMonthlyPage() {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const summary = await getMonthlyReceiptSummary(12)

  const totalIncome = summary.reduce((sum, row) => sum + row.totalIncome, 0)
  const totalOutgoing = summary.reduce((sum, row) => sum + row.totalOutgoing, 0)
  const averageOutgoing = summary.length ? totalOutgoing / summary.length : 0

  return (
    <PageLayout
      title="Monthly receipts overview"
      subtitle="Track income and spending trends across recent months."
    >
      <section className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/receipts"
            className="inline-flex items-center rounded-md border border-emerald-100 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50"
          >
            ← Back to receipts
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="Total income (12m)" value={formatCurrency(totalIncome)} tone="income" />
          <MetricCard label="Total spending (12m)" value={formatCurrency(totalOutgoing)} tone="spend" />
          <MetricCard label="Average monthly spending" value={formatCurrency(averageOutgoing)} tone="neutral" />
        </div>

        <Card variant="bordered" header={<h2 className="text-lg font-semibold text-gray-900">Monthly breakdown</h2>}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Month</th>
                  <th className="px-4 py-3 text-right">Income</th>
                  <th className="px-4 py-3 text-right">Outgoings</th>
                  <th className="px-4 py-3">Top income sources</th>
                  <th className="px-4 py-3">Top outgoing vendors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                {summary.map((row) => (
                  <tr key={row.monthStart}>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatMonthLabel(row.monthStart)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(row.totalIncome)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(row.totalOutgoing)}</td>
                    <td className="px-4 py-3">
                      <TopList items={row.topIncome} emptyLabel="No income recorded" badgeTone="income" />
                    </td>
                    <td className="px-4 py-3">
                      <TopList items={row.topOutgoing} emptyLabel="No outgoings recorded" badgeTone="spend" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </PageLayout>
  )
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'income' | 'spend' | 'neutral'
}) {
  const toneClasses: Record<typeof tone, string> = {
    income: 'bg-emerald-50 text-emerald-700',
    spend: 'bg-rose-50 text-rose-700',
    neutral: 'bg-gray-50 text-gray-700',
  }

  return (
    <Card variant="bordered" className="h-full">
      <div className="space-y-2">
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-3xl font-semibold text-gray-900">{value}</p>
        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${toneClasses[tone]}`}>
          {tone === 'neutral' ? 'Average of last 12 months' : tone === 'income' ? 'Total received' : 'Total paid'}
        </span>
      </div>
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

  const badgeStyles = badgeTone === 'income'
    ? 'bg-emerald-50 text-emerald-700'
    : 'bg-rose-50 text-rose-700'

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-gray-900" title={item.label}>{item.label}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeStyles}`}>{formatCurrency(item.amount)}</span>
        </div>
      ))}
    </div>
  )
}
