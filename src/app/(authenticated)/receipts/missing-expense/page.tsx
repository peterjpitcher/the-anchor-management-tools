import { getReceiptMissingExpenseSummary } from '@/app/actions/receipts'
import { Card, LinkButton } from '@/ds'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { ReceiptsPageChrome } from '../_components/ReceiptsPageChrome'

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  }).format(value ?? 0)
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

export const runtime = 'nodejs'

export default async function ReceiptsMissingExpensePage() {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const summary = await getReceiptMissingExpenseSummary()
  const totalTransactions = summary.reduce((sum, item) => sum + item.transactionCount, 0)
  const totalOutgoing = summary.reduce((sum, item) => sum + item.totalOutgoing, 0)
  const totalIncoming = summary.reduce((sum, item) => sum + item.totalIncoming, 0)

  return (
    <ReceiptsPageChrome
      title="Transactions needing expense category"
      subtitle="Vendors with receipts that still require an expense category."
      navState={{ view: 'missing-expense' }}
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryCard label="Transactions without expense" value={totalTransactions} tone="warning" />
          <SummaryCard label="Uncategorised outgoing" value={formatCurrency(totalOutgoing)} tone="spend" />
          <SummaryCard label="Uncategorised incoming" value={formatCurrency(totalIncoming)} tone="income" />
        </div>

        {/* Desktop / tablet: table (unchanged at >=768px) */}
        <Card className="hidden md:block">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Vendor</th>
                  <th scope="col" className="px-4 py-3 text-right">Transactions</th>
                  <th scope="col" className="px-4 py-3 text-right">Total out</th>
                  <th scope="col" className="px-4 py-3 text-right">Total in</th>
                  <th scope="col" className="px-4 py-3">Latest activity</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {summary.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={6}>
                      All transactions have an expense category assigned.
                    </td>
                  </tr>
                ) : (
                  summary.map((item) => (
                    <tr key={item.vendorLabel}>
                      <td className="px-4 py-3 font-medium text-gray-900">{item.vendorLabel}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{item.transactionCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-rose-700">{formatCurrency(item.totalOutgoing)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{formatCurrency(item.totalIncoming)}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(item.latestTransaction)}</td>
                      <td className="px-4 py-3 text-right text-sm">
                        <Link
                          href={`/receipts?needsExpense=1${item.vendorLabel !== 'Unassigned vendor' ? `&search=${encodeURIComponent(item.vendorLabel)}` : ''}`}
                          className="text-emerald-600 hover:text-emerald-700"
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Mobile: stacked cards (below 768px) */}
        <div className="space-y-3 md:hidden">
          {summary.length === 0 ? (
            <Card variant="bordered">
              <p className="py-4 text-center text-sm text-gray-500">
                All transactions have an expense category assigned.
              </p>
            </Card>
          ) : (
            summary.map((item) => (
              <Card key={item.vendorLabel} variant="bordered">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold leading-snug text-gray-900">{item.vendorLabel}</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">Transactions</dt>
                      <dd className="mt-0.5 font-medium text-gray-900 tabular-nums">{item.transactionCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">Latest activity</dt>
                      <dd className="mt-0.5 font-medium text-gray-600">{formatDate(item.latestTransaction)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">Total out</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-rose-700">{formatCurrency(item.totalOutgoing)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">Total in</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-emerald-700">{formatCurrency(item.totalIncoming)}</dd>
                    </div>
                  </dl>
                  <LinkButton
                    href={`/receipts?needsExpense=1${item.vendorLabel !== 'Unassigned vendor' ? `&search=${encodeURIComponent(item.vendorLabel)}` : ''}`}
                    variant="secondary"
                    size="sm"
                    className="w-full"
                  >
                    Review
                  </LinkButton>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </ReceiptsPageChrome>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string | number; tone: 'income' | 'spend' | 'warning' }) {
  const toneStyles: Record<typeof tone, string> = {
    income: 'bg-emerald-50 text-emerald-700',
    spend: 'bg-rose-50 text-rose-700',
    warning: 'bg-amber-50 text-amber-700',
  }

  return (
    <Card variant="bordered" className="h-full">
      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-2xl font-semibold text-gray-900">{value}</p>
        <span className={`inline-flex w-fit items-center rounded-full px-2 py-1 text-[11px] font-medium ${toneStyles[tone]}`}>
          {tone === 'spend' ? 'Awaiting categorisation' : tone === 'income' ? 'Incoming balance' : 'Needs attention'}
        </span>
      </div>
    </Card>
  )
}
