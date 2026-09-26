'use client'

import { useState, useEffect } from 'react'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  PageLoading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { formatCurrency } from '@/lib/format'
import { formatDateInLondon } from '@/lib/dateUtils'
import { getRefundHistory } from '@/app/actions/refundActions'

type SourceType = 'private_booking' | 'table_booking' | 'parking'
type RefundStatusTone = 'success' | 'warning' | 'danger' | 'neutral'

export interface RefundHistoryTableProps {
  sourceType: SourceType
  sourceId: string
  /**
   * 'card' (the default) draws its own Card titled "Refund History", for a caller that drops it
   * into a panel body (private bookings, table bookings). 'bare' is just the table and totals, for
   * a caller that already frames it in a titled Card with a padding-free body (parking).
   */
  variant?: 'card' | 'bare'
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

/**
 * How a refund's status looks, wherever refunds are listed (parking, private bookings, table
 * bookings). Parking and the booking screens each had their own copy of this map until
 * September 2026.
 */
export const REFUND_STATUS_TONE: Record<RefundRow['status'], RefundStatusTone> = {
  completed: 'success',
  pending: 'warning',
  failed: 'danger',
}

const REFUND_STATUS_LABEL: Record<RefundRow['status'], string> = {
  completed: 'Completed',
  pending: 'Pending',
  failed: 'Failed',
}

const methodLabel: Record<string, string> = {
  paypal: 'PayPal',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
}

export function RefundHistoryTable({ sourceType, sourceId, variant = 'card' }: RefundHistoryTableProps) {
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
    return <PageLoading inline label="Loading refund history" />
  }

  if (error) {
    return (
      <Alert tone="danger" className={variant === 'bare' ? 'm-pad-card' : undefined}>
        Failed to load refund history: {error}
      </Alert>
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

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Reference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {refunds.map((refund) => (
          <TableRow key={refund.id} className={refund.status === 'failed' ? 'opacity-50' : undefined}>
            <TableCell>
              {formatDateInLondon(refund.created_at, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </TableCell>
            <TableCell className="font-medium">{formatCurrency(Number(refund.amount))}</TableCell>
            <TableCell>{methodLabel[refund.refund_method] ?? refund.refund_method}</TableCell>
            <TableCell>
              <Badge tone={REFUND_STATUS_TONE[refund.status] ?? 'neutral'}>
                {REFUND_STATUS_LABEL[refund.status] ?? refund.status}
              </Badge>
            </TableCell>
            <TableCell className="max-w-[200px] truncate text-text-muted">
              <span title={refund.reason ?? undefined}>{refund.reason || '-'}</span>
            </TableCell>
            <TableCell className="text-xs text-text-soft">
              {refund.initiated_by_type === 'system' ? 'System' : ''}
              {refund.paypal_refund_id ? ` ${refund.paypal_refund_id}` : refund.id.slice(0, 8)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  const totals =
    completedTotal > 0 || pendingTotal > 0 ? (
      <div className="flex gap-4 border-t border-border px-pad-card py-3 text-sm">
        {completedTotal > 0 && (
          <span className="text-success-fg">Refunded: {formatCurrency(completedTotal)}</span>
        )}
        {pendingTotal > 0 && (
          <span className="text-warning-fg">Pending: {formatCurrency(pendingTotal)}</span>
        )}
      </div>
    ) : null

  if (variant === 'bare') {
    return (
      <>
        {table}
        {totals}
      </>
    )
  }

  return (
    <Card>
      <CardHeader title="Refund History" />
      {table}
      {totals}
    </Card>
  )
}
