'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Alert, Button, Spinner, toast } from '@/ds'
import { getBookingSigningState, sendBookingWaiver, type BookingSigningState } from '@/app/actions/signing-bookings'
import { SignaturePanel } from './SignaturePanel'

export interface BookingSigningPanelProps {
  bookingId: string
  /** Changes when the booking is refreshed (for example after Email Contract), to reload. */
  refreshKey?: string | null
}

/**
 * A private booking's signing records: the contract, and the self-catering waiver where one
 * applies. The contract is sent with Email Contract; this panel shows where it has got to and
 * offers the waiver on its own when that is still outstanding.
 */
export function BookingSigningPanel({ bookingId, refreshKey }: BookingSigningPanelProps): React.JSX.Element {
  const [state, setState] = useState<BookingSigningState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const load = useCallback(async (): Promise<void> => {
    const result = await getBookingSigningState(bookingId)
    if (result.error || !result.data) {
      setLoadError(result.error ?? 'The signing records could not be loaded.')
      return
    }
    setLoadError(null)
    setState(result.data)
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const sendWaiver = (): void => {
    startTransition(async () => {
      const result = await sendBookingWaiver(bookingId)
      if (result.error || !result.data) {
        toast.error(result.error ?? 'Could not send the food agreement.')
        return
      }
      const delivery = result.data.deliveries[0]
      if (delivery?.email_status === 'failed') {
        toast.error('Food agreement created, but the email failed. Use "Send New Link" or "Sign in Person".')
      } else if (delivery?.email_status === 'none') {
        toast.success('Food agreement created. There is no email address, so use "Sign in Person".')
      } else {
        toast.success('Food agreement sent to the customer to sign.')
      }
      await load()
    })
  }

  if (loadError) {
    return <Alert tone="danger" title="The signing records could not be loaded">{loadError}</Alert>
  }
  if (!state) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
        <Spinner /> Loading signing records
      </div>
    )
  }

  // Offered while the food agreement is owed and there is no request for it already out.
  const openWaiver = state.documents.some(
    (document) => document.kind === 'private_booking_waiver' && (document.status === 'sent' || document.status === 'part_signed')
  )
  const offerWaiver = state.canSend && state.waiverOutstanding && !openWaiver

  return (
    <SignaturePanel
      title="Signatures"
      documents={state.documents}
      canSend={state.canSend}
      emptyText={
        state.waiverRequired
          ? 'Nothing has been sent for signature yet. Email Contract sends the contract and the food agreement, each with its own link to sign.'
          : 'Nothing has been sent for signature yet. Email Contract sends the contract with a link to sign it online.'
      }
      sendActions={
        offerWaiver ? (
          <Button size="sm" variant="secondary" loading={pending} onClick={sendWaiver}>
            Send Food Agreement to Sign
          </Button>
        ) : undefined
      }
    />
  )
}
