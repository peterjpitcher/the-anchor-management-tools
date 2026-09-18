'use client'

import { useState, useEffect } from 'react'
import { Badge, Spinner } from '@/ds'
import { formatCurrency } from '@/lib/format'
import { formatDateInLondon } from '@/lib/dateUtils'
import { getRefundHistory } from '@/app/actions/refundActions'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

export interface RefundHistoryTableProps {
  sourceType: SourceType
  sourceId: string
}

interface RefundRow {
  id: string
  amount: number
  refund_method: string
  status: 'completed' | 'pending' | 'failed'
  reason: string | null
  paypal_refund_id: string | null
  initiated_by_type: string | null
  created_at: string
  completed_at: string | null
  failure_message: string | null
}

const statusTone: Record<string, 'success' | 'warning' | 'danger'> = {
  completed: 'success',
  pending: 'warning',
  failed: 'danger',
}

const methodLabel: Record<string, string> = {
  paypal: 'PayPal',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
}

export function RefundHistoryTable({ sourceType, sourceId }: RefundHistoryTableProps) {
  const [refunds, setRefunds] = useState<RefundRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const result = await getRefundHistory(sourceType, sourceId)
      if (cancelled) return

      if (result.error) {
        setError(result.error)
      } else {
        setRefunds((result.data ?? []) as RefundRow[])
      }
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [sourceType, sourceId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size="sm" />
        <span className="ml-2 text-sm text-gray-500">Loading refund history...</span>
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-danger py-2">Failed to load refund history: {error}</p>
    )
  }

  if (refunds.length === 0) {
    return null
  }

  const completedTotal = refunds
    .filter((r) => r.status === 'completed')
    .reduce((sum, r) => sum + Number(r.amount), 0)

  const pendingTotal = refunds
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + Number(r.amount), 0)

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-text">Refund History</h4>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Date</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Amount</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Method</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Reason</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {refunds.map((refund) => (
              <tr
                key={refund.id}
                className={refund.status === 'failed' ? 'opacity-50' : undefined}
              >
                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                  {formatDateInLondon(refund.created_at, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-sm font-medium text-text">
                  {formatCurrency(Number(refund.amount))}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                  {methodLabel[refund.refund_method] ?? refund.refund_method}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Badge
                    tone={statusTone[refund.status] ?? 'neutral'}
                  >
                    {refund.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-sm text-gray-500 max-w-[200px] truncate" title={refund.reason ?? undefined}>
                  {refund.reason || '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-400">
                  {refund.initiated_by_type === 'system' ? 'System' : ''}
                  {refund.paypal_refund_id ? ` ${refund.paypal_refund_id}` : refund.id.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="flex gap-4 text-sm">
        {completedTotal > 0 && (
          <span className="text-green-700">
            Refunded: {formatCurrency(completedTotal)}
          </span>
        )}
        {pendingTotal > 0 && (
          <span className="text-warning-fg">
            Pending: {formatCurrency(pendingTotal)}
          </span>
        )}
      </div>
    </div>
  )
}
