'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, toast } from '@/ds'
import {
  listEventPaymentExceptions,
  resolveEventPaymentException,
  type EventPaymentExceptionRow,
} from '@/app/actions/event-payment-exceptions'
import { formatDateTime12Hour } from '@/lib/dateUtils'

interface PaidNeedsActionCardProps {
  eventId: string
  canManage: boolean
  /** Reload the bookings table after a booking is confirmed or refunded. */
  onResolved: () => Promise<void> | void
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

type PendingDecision = { row: EventPaymentExceptionRow; resolution: 'confirmed' | 'refunded' }

/**
 * Paid bookings that need a person (BK-018, customer bookings review of 24 October 2026): PayPal
 * took the money but the booking could not be confirmed, or a refund needs doing by hand. The
 * guest has been told staff will check. Shown only when there is something to act on.
 */
export function PaidNeedsActionCard({ eventId, canManage, onResolved }: PaidNeedsActionCardProps) {
  const [rows, setRows] = useState<EventPaymentExceptionRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingDecision | null>(null)

  const load = useCallback(async () => {
    const result = await listEventPaymentExceptions({ eventId })
    if (result.error) {
      setLoadError(result.error)
      return
    }
    setLoadError(null)
    setRows(result.data ?? [])
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  const handleConfirm = async (): Promise<void> => {
    if (!pending) return
    const result = await resolveEventPaymentException({ exceptionId: pending.row.id, resolution: pending.resolution })
    if (result.error) throw new Error(result.error)
    if (result.data?.resolution === 'refunded') {
      toast.success(`Refund of ${formatCurrency(result.data.refundAmount ?? 0)} sent and the booking cancelled.`)
    } else {
      toast.success('Booking confirmed. The guest has been told.')
    }
    setPending(null)
    await load()
    await onResolved()
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader title="Paid, needs action" />
        <CardBody>
          <p className="text-sm text-text-muted">{loadError}</p>
        </CardBody>
      </Card>
    )
  }

  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="Paid, needs action"
        action={<Badge tone="danger">{rows.length}</Badge>}
      />
      <CardBody>
        <p className="mb-3 text-sm text-text-muted">
          PayPal took payment for these bookings but they could not be confirmed. The guest has been
          told staff will check. Confirm each one anyway, or refund what was paid.
        </p>
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-default border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">
                  {row.guestName ?? 'Guest'} · {row.seats} {row.seats === 1 ? 'ticket' : 'tickets'} · {formatCurrency(row.amountPaid)} paid
                </p>
                <p className="text-sm text-text-muted">
                  {row.reasonText} · {formatDateTime12Hour(row.createdAt)}
                </p>
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPending({ row, resolution: 'confirmed' })}>
                    Confirm anyway
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setPending({ row, resolution: 'refunded' })}>
                    Refund
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardBody>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={handleConfirm}
        title={pending?.resolution === 'refunded' ? 'Refund and cancel' : 'Confirm anyway'}
        message={
          pending?.resolution === 'refunded'
            ? `Refund ${formatCurrency(pending.row.amountPaid)} to the guest through PayPal and cancel the booking. The guest is emailed.`
            : `Confirm this booking for ${pending?.row.seats ?? 0} even though it could not be confirmed automatically. Make room for them on the night. The guest is told it is confirmed.`
        }
        confirmLabel={pending?.resolution === 'refunded' ? 'Refund and cancel' : 'Confirm booking'}
        tone={pending?.resolution === 'refunded' ? 'danger' : 'primary'}
      />
    </Card>
  )
}
