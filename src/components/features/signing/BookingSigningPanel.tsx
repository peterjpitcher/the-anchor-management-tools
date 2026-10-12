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
        toast.error(result.error ?? 'Could not send the waiver.')
        return
      }
      const delivery = result.data.deliveries[0]
      if (delivery?.email_status === 'failed') {
        toast.error('Waiver created, but the email failed. Use "Send new link" or "Sign in person".')
      } else if (delivery?.email_status === 'none') {
        toast.success('Waiver created. There is no email address, so use "Sign in person".')
      } else {
        toast.success('Waiver sent to the customer to sign.')
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

  const openContract = state.documents.some(
    (document) => document.kind === 'private_booking_contract' && (document.status === 'sent' || document.status === 'part_signed')
  )
  // A contract out for signature carries the waiver with it, so a second request would only confuse.
  const offerWaiver = state.canSend && state.waiverRequired && state.waiverStatus !== 'signed' && !openContract

  return (
    <SignaturePanel
      title="Signatures"
      documents={state.documents}
      canSend={state.canSend}
      emptyText="Nothing has been sent for signature yet. Email Contract sends the contract with a link to sign it online."
      sendActions={
        offerWaiver ? (
          <Button size="sm" variant="secondary" loading={pending} onClick={sendWaiver}>
            Send waiver to sign
          </Button>
        ) : undefined
      }
    />
  )
}
