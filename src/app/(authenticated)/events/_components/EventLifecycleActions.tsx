'use client'

import { useState, useTransition } from 'react'
import { Alert, Button, ConfirmDialog, toast } from '@/ds'
import {
  cancelEvent,
  getEventLifecycleImpact,
  postponeEvent,
  undoEventCancellation,
} from '@/app/actions/event-lifecycle'
import { formatDateTime12Hour } from '@/lib/dateUtils'

interface EventLifecycleActionsProps {
  eventId: string
  status: string
  /** Called after a change so the page reloads the event. */
  onChanged: () => void
}

type Pending = { action: 'cancel' | 'postpone'; lines: string[]; allowed: boolean; blockedReason: string | null }

/**
 * Cancel event and Postpone event, each behind a confirm step that shows who is affected, what is
 * refunded and what guests are told (BK-026, BK-089; owner decision D8). A cancellation waits 10
 * minutes before anything goes out, and can be undone here until then.
 */
export function EventLifecycleActions({ eventId, status, onChanged }: EventLifecycleActionsProps) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [undoUntil, setUndoUntil] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function open(action: 'cancel' | 'postpone') {
    setError(null)
    startTransition(async () => {
      const result = await getEventLifecycleImpact(eventId, action)
      if ('error' in result) { setError(result.error); return }
      setPending({ action, lines: result.data.lines, allowed: result.data.allowed, blockedReason: result.data.blockedReason })
    })
  }

  function checkUndo() {
    setError(null)
    startTransition(async () => {
      const result = await getEventLifecycleImpact(eventId, 'cancel')
      if ('error' in result) { setError(result.error); return }
      setUndoUntil(result.data.pendingCancellation?.scheduledFor ?? null)
      if (!result.data.pendingCancellation) setError('Too late to undo: refunds and messages have already started.')
    })
  }

  async function confirm() {
    if (!pending) return
    const action = pending.action
    const result = action === 'cancel'
      ? await cancelEvent(eventId, { confirmed: true })
      : await postponeEvent(eventId, { confirmed: true })
    setPending(null)
    if (result.error) { setError(result.error); return }
    if (action === 'cancel') {
      const scheduledFor = (result.data as { scheduledFor?: string } | undefined)?.scheduledFor ?? null
      setUndoUntil(scheduledFor)
      toast.success('Event cancelled. Refunds and messages start in 10 minutes.')
    } else {
      toast.success('Event postponed. Guests are being told.')
    }
    onChanged()
  }

  function undo() {
    setError(null)
    startTransition(async () => {
      const result = await undoEventCancellation(eventId)
      if (result.error) { setError(result.error); return }
      setUndoUntil(null)
      toast.success('Cancellation undone. Nobody was refunded or told.')
      onChanged()
    })
  }

  const title = pending?.action === 'cancel' ? 'Cancel Event' : 'Postpone Event'

  return (
    <div className="space-y-3">
      {status === 'cancelled' ? (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">This event is cancelled. If its refunds and messages have not started yet, you can undo the cancellation.</p>
          {undoUntil && <p className="text-sm text-text-muted">Refunds and messages start at {formatDateTime12Hour(undoUntil)}.</p>}
          <div className="flex flex-wrap gap-2">
            {undoUntil
              ? <Button type="button" variant="secondary" onClick={undo} loading={busy}>Undo Cancellation</Button>
              : <Button type="button" variant="secondary" onClick={checkUndo} loading={busy}>Check Whether It Can Be Undone</Button>}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">Cancelling refunds everyone who paid online and tells every guest. Postponing keeps every booking for the new date and tells every guest. You see who is affected before anything happens.</p>
          <div className="flex flex-wrap gap-2">
            {status !== 'postponed' && <Button type="button" variant="secondary" onClick={() => open('postpone')} loading={busy && pending === null}>Postpone Event</Button>}
            <Button type="button" variant="danger" onClick={() => open('cancel')} loading={busy && pending === null}>Cancel Event</Button>
          </div>
        </div>
      )}
      {error && <Alert tone="danger" size="sm">{error}</Alert>}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={pending?.allowed ? confirm : () => setPending(null)}
        title={title}
        message={
          <div className="space-y-2">
            {pending?.lines.map((line) => <p key={line}>{line}</p>)}
            {pending && !pending.allowed && pending.blockedReason && <Alert tone="warning" size="sm">{pending.blockedReason}</Alert>}
          </div>
        }
        confirmLabel={pending?.allowed ? (pending.action === 'cancel' ? 'Cancel Event and Refund' : 'Postpone Event') : 'Close'}
        cancelLabel="Keep Event"
        tone={pending?.action === 'cancel' && pending.allowed ? 'danger' : 'primary'}
      />
    </div>
  )
}
