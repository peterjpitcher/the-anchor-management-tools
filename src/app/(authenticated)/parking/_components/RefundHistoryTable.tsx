'use client'

import { useState, useEffect } from 'react'
import { Badge, Spinner } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import { getRefundHistory } from '@/app/actions/refundActions'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

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
        <span className="ml-2 text-sm text-text-muted">Loading refund history...</span>
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-danger py-2 px-3">Failed to load refund history: {error}</p>
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
      <h4 className="text-sm font-semibold text-text px-3 pt-3">Refund History</h4>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface-hover">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-text-muted">Date</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-text-muted">Amount</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-text-muted">Method</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-text-muted">Status</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-text-muted">Reason</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-text-muted">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {refunds.map((refund) => (
              <tr
                key={refund.id}
                className={refund.status === 'failed' ? 'opacity-50' : undefined}
              >
                <td className="whitespace-nowrap px-3 py-2 text-sm text-text">
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
                <td className="whitespace-nowrap px-3 py-2 text-sm text-text">
                  {methodLabel[refund.refund_method] ?? refund.refund_method}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Badge tone={statusTone[refund.status] ?? 'neutral'}>
                    {refund.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-sm text-text-muted max-w-[200px] truncate" title={refund.reason ?? undefined}>
                  {refund.reason || '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-text-muted">
                  {refund.initiated_by_type === 'system' ? 'System' : ''}
                  {refund.paypal_refund_id ? ` ${refund.paypal_refund_id}` : refund.id.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 text-sm px-3 pb-3">
        {completedTotal > 0 && (
          <span className="text-success">
            Refunded: {formatCurrency(completedTotal)}
          </span>
        )}
        {pendingTotal > 0 && (
          <span className="text-warning">
            Pending: {formatCurrency(pendingTotal)}
          </span>
        )}
      </div>
    </div>
  )
}
