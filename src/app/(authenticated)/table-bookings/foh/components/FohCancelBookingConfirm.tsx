'use client'

import { useState } from 'react'
import { Button } from '@/ds'
import { StaffCancelChoice } from '@/components/features/table-bookings/StaffCancelChoice'
import {
  depositHeldGbp,
  initialStaffCancelForm,
  readStaffCancelForm,
  type StaffCancelledBy,
} from '@/lib/table-bookings/staff-cancellation'
import type { FohBooking } from '../types'

/**
 * The FOH cancel confirmation: who is cancelling, and a manager's own refund amount (BK-046).
 * Kept in its own component so its form state starts fresh for each booking.
 */
export function FohCancelBookingConfirm({
  booking,
  canChooseRefund,
  busy,
  cancelling,
  onKeep,
  onConfirm,
}: {
  booking: FohBooking
  canChooseRefund: boolean
  busy: boolean
  cancelling: boolean
  onKeep: () => void
  onConfirm: (choice: { cancelledBy: StaffCancelledBy; refundAmountGbp: number | null }) => void
}): React.JSX.Element {
  const heldGbp = depositHeldGbp(booking)
  const [form, setForm] = useState(() => initialStaffCancelForm(heldGbp))
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <div className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2">
      <p className="text-xs font-semibold text-danger-fg">Confirm cancellation</p>
      <p className="mt-1 text-xs text-danger-fg">
        This will mark the booking as cancelled and remove it from active covers.
      </p>
      <div className="mt-2 rounded-default bg-surface px-3 py-2">
        <StaffCancelChoice
          name={`foh-cancelled-by-${booking.id}`}
          value={form}
          onChange={(next) => {
            setForm(next)
            setProblem(null)
          }}
          heldGbp={heldGbp}
          canChooseAmount={canChooseRefund}
          disabled={busy}
        />
      </div>
      {problem ? <p className="mt-2 text-xs font-semibold text-danger-fg" role="alert">{problem}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onKeep}
          className="min-h-touch"
        >
          Keep booking
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() => {
            const read = readStaffCancelForm(form, heldGbp)
            if (!read.ok) {
              setProblem(read.error)
              return
            }
            onConfirm(read.choice)
          }}
          className="min-h-touch"
        >
          {cancelling ? 'Cancelling...' : 'Confirm cancel'}
        </Button>
      </div>
    </div>
  )
}
