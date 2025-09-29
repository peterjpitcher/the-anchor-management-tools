import { getReceiptVendorSummary, type ReceiptVendorSummary } from '@/app/actions/receipts'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import Link from 'next/link'

export const runtime = 'nodejs'

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value ?? 0)
}

function formatMonth(isoDate: string) {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatChange(value: number) {
  if (!Number.isFinite(value) || value === 0) return '0%'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

export default async function ReceiptsVendorsPage() {
  const vendors = await getReceiptVendorSummary(12)

  return (
    <PageWrapper>
      <PageHeader
        title="Vendor spending trends"
        subtitle="See which suppliers are rising in cost and where spend is stable."
      />
      <PageContent>
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <Link
              href="/receipts"
              className="inline-flex items-center rounded-md border border-emerald-100 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50"
            >
              ← Back to receipts
            </Link>
          </div>

          {vendors.length === 0 && (
            <Card variant="bordered">
              <p className="text-sm text-gray-500">No vendor data available yet. Import statements to see trends.</p>
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            {vendors.map((vendor) => (
              <VendorCard key={vendor.vendorLabel} vendor={vendor} />
            ))}
          </div>
        </div>
      </PageContent>
    </PageWrapper>
  )
}

function VendorCard({ vendor }: { vendor: ReceiptVendorSummary }) {
  const totalTransactions = vendor.months.reduce((sum, month) => sum + month.transactionCount, 0)
  const maxMonthlySpend = vendor.months.reduce((max, month) => Math.max(max, month.totalOutgoing), 0)
  const recentMonths = vendor.months.slice(-6)

  const changeTone = vendor.changePercentage > 5
    ? 'bg-rose-50 text-rose-700'
    : vendor.changePercentage < -5
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-gray-100 text-gray-600'

  return (
    <Card variant="bordered">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{vendor.vendorLabel}</h3>
            <p className="text-xs text-gray-500">{totalTransactions} transactions across {vendor.months.length} months</p>
          </div>
          <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${changeTone}`}>
            {formatChange(vendor.changePercentage)} vs prior 3 months
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Total spend" value={formatCurrency(vendor.totalOutgoing)} tone="spend" />
          <Metric label="Avg (last 3m)" value={formatCurrency(vendor.recentAverageOutgoing)} tone="neutral" />
          <Metric label="Prev avg" value={formatCurrency(vendor.previousAverageOutgoing)} tone="neutral" subtle />
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recent six months</h4>
          <div className="space-y-2">
            {recentMonths.map((month) => {
              const width = maxMonthlySpend
                ? Math.max(Math.min((month.totalOutgoing / maxMonthlySpend) * 100, 100), 4)
                : 0
              return (
                <div key={month.monthStart} className="flex items-center gap-3 text-xs text-gray-600">
                  <span className="w-16 text-gray-500">{formatMonth(month.monthStart)}</span>
                  <div className="relative h-2 flex-1 rounded bg-gray-100" title={formatCurrency(month.totalOutgoing)}>
                    <div
                      className="absolute left-0 top-0 h-2 rounded bg-emerald-500"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-gray-700 tabular-nums">{formatCurrency(month.totalOutgoing)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}

function Metric({
  label,
  value,
  tone,
  subtle,
}: {
  label: string
  value: string
  tone: 'spend' | 'neutral'
  subtle?: boolean
}) {
  const toneClasses: Record<typeof tone, string> = {
    spend: 'bg-rose-50 text-rose-700',
    neutral: subtle ? 'bg-gray-50 text-gray-500' : 'bg-gray-100 text-gray-700',
  }

  return (
    <div className={`rounded-md px-3 py-2 text-sm font-medium ${toneClasses[tone]}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg">{value}</p>
    </div>
  )
}
