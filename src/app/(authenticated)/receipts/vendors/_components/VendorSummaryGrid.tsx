'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  getReceiptVendorMonthTransactions,
  type ReceiptVendorSummary,
  type ReceiptVendorMonthTransaction,
} from '@/app/actions/receipts'
import { Card } from '@/components/ui-v2/layout/Card'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { ChevronDownIcon } from '@heroicons/react/20/solid'

function formatCurrency(value: number | null | undefined) {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
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

function formatDate(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

const statusLabels: Record<ReceiptVendorMonthTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
  cant_find: "Can't find",
}

const statusTone: Record<ReceiptVendorMonthTransaction['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  auto_completed: 'bg-blue-100 text-blue-700',
  no_receipt_required: 'bg-gray-200 text-gray-700',
  cant_find: 'bg-rose-100 text-rose-700',
}

type VendorSummaryGridProps = {
  vendors: ReceiptVendorSummary[]
}

export default function VendorSummaryGrid({ vendors }: VendorSummaryGridProps) {
  if (!vendors.length) return null

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {vendors.map((vendor) => (
        <VendorCard key={vendor.vendorLabel} vendor={vendor} />
      ))}
    </div>
  )
}

function VendorCard({ vendor }: { vendor: ReceiptVendorSummary }) {
  const totalTransactions = useMemo(
    () => vendor.months.reduce((sum, month) => sum + month.transactionCount, 0),
    [vendor.months],
  )
  const maxMonthlySpend = useMemo(
    () => vendor.months.reduce((max, month) => Math.max(max, month.totalOutgoing), 0),
    [vendor.months],
  )
  const recentMonths = useMemo(() => vendor.months.slice(-6), [vendor.months])

  const changeTone = vendor.changePercentage > 5
    ? 'bg-rose-50 text-rose-700'
    : vendor.changePercentage < -5
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-gray-100 text-gray-600'

  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null)
  const [monthTransactions, setMonthTransactions] = useState<Record<string, ReceiptVendorMonthTransaction[]>>({})
  const [monthErrors, setMonthErrors] = useState<Record<string, string | undefined>>({})
  const [isPending, startTransition] = useTransition()

  function toggleMonth(monthStart: string) {
    if (expandedMonth === monthStart) {
      setExpandedMonth(null)
      return
    }

    setExpandedMonth(monthStart)

    if (monthTransactions[monthStart] || loadingMonth === monthStart) {
      return
    }

    setLoadingMonth(monthStart)
    setMonthErrors((prev) => ({ ...prev, [monthStart]: undefined }))

    startTransition(async () => {
      try {
        const result = await getReceiptVendorMonthTransactions({
          vendorLabel: vendor.vendorLabel,
          monthStart,
        })
        if (result.error) {
          setMonthErrors((prev) => ({ ...prev, [monthStart]: result.error }))
        } else {
          setMonthTransactions((prev) => ({ ...prev, [monthStart]: result.transactions }))
          setMonthErrors((prev) => ({ ...prev, [monthStart]: undefined }))
        }
      } catch (error) {
        console.error('Failed to load vendor month details', error)
        setMonthErrors((prev) => ({ ...prev, [monthStart]: 'Something went wrong loading transactions.' }))
      } finally {
        setLoadingMonth(null)
      }
    })
  }

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
              const isActive = expandedMonth === month.monthStart
              const hasError = monthErrors[month.monthStart]
              const transactions = monthTransactions[month.monthStart] ?? []

              return (
                <div key={month.monthStart}>
                  <button
                    type="button"
                    onClick={() => toggleMonth(month.monthStart)}
                    className={`flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left text-xs text-gray-600 transition hover:border-emerald-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-300 ${isActive ? 'border-emerald-300 bg-emerald-50' : ''}`}
                    aria-expanded={isActive}
                  >
                    <ChevronDownIcon
                      className={`h-4 w-4 shrink-0 transition-transform ${isActive ? 'rotate-180 text-emerald-600' : 'text-gray-400'}`}
                    />
                    <span className="w-20 text-gray-500">{formatMonth(month.monthStart)}</span>
                    <div className="relative h-2 flex-1 rounded bg-gray-100" title={formatCurrency(month.totalOutgoing)}>
                      <div
                        className="absolute left-0 top-0 h-2 rounded bg-emerald-500"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-gray-700 tabular-nums">{formatCurrency(month.totalOutgoing)}</span>
                  </button>

                  {isActive && (
                    <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 p-3">
                      {loadingMonth === month.monthStart || isPending ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Spinner className="h-4 w-4" />
                          Loading transactions…
                        </div>
                      ) : hasError ? (
                        <p className="text-sm text-rose-600">{hasError}</p>
                      ) : (
                        <TransactionTable transactions={transactions} />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}

function TransactionTable({ transactions }: { transactions: ReceiptVendorMonthTransaction[] }) {
  if (!transactions.length) {
    return <p className="text-sm text-gray-500">No individual transactions matched this vendor during the selected month.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-100 text-left font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-2 py-2">Date</th>
            <th className="px-2 py-2">Details</th>
            <th className="px-2 py-2">Type</th>
            <th className="px-2 py-2 text-right">Out</th>
            <th className="px-2 py-2 text-right">In</th>
            <th className="px-2 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-700">
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td className="px-2 py-2 whitespace-nowrap text-gray-600">{formatDate(transaction.transaction_date)}</td>
              <td className="px-2 py-2 max-w-[14rem] truncate text-gray-900" title={transaction.details ?? undefined}>
                {transaction.details || '—'}
              </td>
              <td className="px-2 py-2 text-gray-500">{transaction.transaction_type || '—'}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">{formatCurrency(transaction.amount_out)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">{formatCurrency(transaction.amount_in)}</td>
              <td className="px-2 py-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${statusTone[transaction.status]}`}>
                  {statusLabels[transaction.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
