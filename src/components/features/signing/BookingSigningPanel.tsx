'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Alert, Button, Spinner, toast } from '@/ds'
import { getBookingSigningState, sendBookingWaiver, type BookingSigningState } from '@/app/actions/signing-bookings'
import { describeContractAcceptance } from '@/lib/signing/contract-acceptance'
import { describeContractTermsChanges, type ContractOutOfDate } from '@/lib/private-bookings/contract-terms'
import { RecordContractAcceptanceModal } from './RecordContractAcceptanceModal'
import { SignaturePanel } from './SignaturePanel'

/** What changed, and what the customer holds, in one or two plain sentences (BK-154). */
export function outOfDateText(outOfDate: ContractOutOfDate): string {
  const changed = describeContractTermsChanges(outOfDate.changes)
  const holds = outOfDate.accepted
    ? `The customer accepted version ${outOfDate.currentVersion}`
    : `The customer was sent version ${outOfDate.currentVersion}`
  return `${holds}, but ${changed} ${outOfDate.changes.length === 1 ? 'has' : 'have'} changed since. Email Contract sends version ${outOfDate.nextVersion} for them to sign.`
}

export interface BookingSigningPanelProps {
  bookingId: string
  /** Changes when the booking is refreshed (for example after Email Contract), to reload. */
  refreshKey?: string | null
}

/**
 * A private booking's signing records: the contract, and the self-catering waiver where one
 * applies. The contract is sent with Email Contract; this panel shows where it has got to and
 * offers the waiver on its own when that is still outstanding. It also says how and when the
 * contract was accepted, and lets staff record one signed on paper or confirmed in writing.
 */
export function BookingSigningPanel({ bookingId, refreshKey }: BookingSigningPanelProps): React.JSX.Element {
  const [state, setState] = useState<BookingSigningState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [recording, setRecording] = useState(false)

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

  // Offered once a contract exists and nobody has accepted it yet (the server decides).
  const offerRecord = state.canRecordAcceptance && !state.contractAcceptedAt

  return (
    <div className="space-y-3">
      {state.contractOutOfDate ? (
        <Alert tone="warning" title={`Contract out of date, send version ${state.contractOutOfDate.nextVersion}`} role="status">
          {outOfDateText(state.contractOutOfDate)}
        </Alert>
      ) : state.contractAcceptedAt ? (
        <Alert tone="success" title="Contract Accepted" role="status">
          {describeContractAcceptance(state.contractAcceptanceMethod, state.contractAcceptedAt)}.
        </Alert>
      ) : null}
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
          offerWaiver || offerRecord ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {offerRecord ? (
                <Button size="sm" variant="secondary" onClick={() => setRecording(true)}>
                  Record Acceptance Another Way
                </Button>
              ) : null}
              {offerWaiver ? (
                <Button size="sm" variant="secondary" loading={pending} onClick={sendWaiver}>
                  Send Food Agreement to Sign
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />
      <RecordContractAcceptanceModal
        bookingId={bookingId}
        open={recording}
        onClose={() => setRecording(false)}
        onRecorded={load}
      />
    </div>
  )
}
