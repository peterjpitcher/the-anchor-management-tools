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
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3">Vendor</th>
                  <th scope="col" className="px-4 py-3 text-right">Transactions</th>
                  <th scope="col" className="px-4 py-3 text-right">Total out</th>
                  <th scope="col" className="px-4 py-3 text-right">Total in</th>
                  <th scope="col" className="px-4 py-3">Latest activity</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-text">
                {summary.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm text-text-muted" colSpan={6}>
                      All transactions have an expense category assigned.
                    </td>
                  </tr>
                ) : (
                  summary.map((item) => (
                    <tr key={item.vendorLabel}>
                      <td className="px-4 py-3 font-medium text-text-strong">{item.vendorLabel}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{item.transactionCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-danger-fg">{formatCurrency(item.totalOutgoing)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-success-fg">{formatCurrency(item.totalIncoming)}</td>
                      <td className="px-4 py-3 text-text-muted">{formatDate(item.latestTransaction)}</td>
                      <td className="px-4 py-3 text-right text-sm">
                        <Link
                          href={`/receipts?needsExpense=1${item.vendorLabel !== 'Unassigned vendor' ? `&search=${encodeURIComponent(item.vendorLabel)}` : ''}`}
                          className="text-success-fg hover:text-success-fg"
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
              <p className="py-4 text-center text-sm text-text-muted">
                All transactions have an expense category assigned.
              </p>
            </Card>
          ) : (
            summary.map((item) => (
              <Card key={item.vendorLabel} variant="bordered">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold leading-snug text-text-strong">{item.vendorLabel}</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Transactions</dt>
                      <dd className="mt-0.5 font-medium text-text-strong tabular-nums">{item.transactionCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Latest activity</dt>
                      <dd className="mt-0.5 font-medium text-text-muted">{formatDate(item.latestTransaction)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Total out</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-danger-fg">{formatCurrency(item.totalOutgoing)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-text-muted">Total in</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-success-fg">{formatCurrency(item.totalIncoming)}</dd>
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
    income: 'bg-success-soft text-success-fg',
    spend: 'bg-danger-soft text-danger-fg',
    warning: 'bg-warning-soft text-warning-fg',
  }

  return (
    <Card variant="bordered" className="h-full">
      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
        <p className="text-2xl font-semibold text-text-strong">{value}</p>
        <span className={`inline-flex w-fit items-center rounded-full px-2 py-1 text-[11px] font-medium ${toneStyles[tone]}`}>
          {tone === 'spend' ? 'Awaiting categorisation' : tone === 'income' ? 'Incoming balance' : 'Needs attention'}
        </span>
      </div>
    </Card>
  )
}
