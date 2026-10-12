'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Alert, Button, Dropdown, DropdownItem, Input, Modal, Spinner, Textarea, toast } from '@/ds'
import { getSigningDocumentsForSubject } from '@/app/actions/signing'
import {
  getBookingSupplierState,
  sendClientAgreement,
  sendQuoteForAcceptance,
  sendSupplierConfirmation,
  type BookingSupplier,
  type BookingSupplierState,
  type SendResult,
} from '@/app/actions/signing-commercial'
import type { SigningDocumentSummary } from '@/lib/signing/service'
import type { SigningSubjectType } from '@/lib/signing/types'
import { SignaturePanel } from './SignaturePanel'

/**
 * Signing panels for the commercial documents: quote acceptance, Orange Jelly client agreements
 * and supplier confirmations for a booking. Each loads its own records, so the host page only
 * has to place it.
 */

function reportSent(result: SendResult, sentMessage: string): void {
  const failed = result.deliveries.some((delivery) => delivery.email_status === 'failed')
  if (failed) {
    toast.error('Created, but the email failed. Use "Send new link" or "Sign in person".')
  } else {
    toast.success(sentMessage)
  }
}

function useSubjectDocuments(subjectType: SigningSubjectType, subjectId: string): {
  documents: SigningDocumentSummary[] | null
  loadError: string | null
  reload: () => Promise<void>
} {
  const [documents, setDocuments] = useState<SigningDocumentSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const reload = useCallback(async (): Promise<void> => {
    const result = await getSigningDocumentsForSubject(subjectType, subjectId)
    if (result.error) {
      setLoadError(result.error)
      return
    }
    setLoadError(null)
    setDocuments(result.data ?? [])
  }, [subjectType, subjectId])
  useEffect(() => {
    setDocuments(null)
    void reload()
  }, [reload])
  return { documents, loadError, reload }
}

function Loading({ what }: { what: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
      <Spinner /> Loading {what}
    </div>
  )
}

function SignerFields(props: {
  name: string
  email: string
  onName: (value: string) => void
  onEmail: (value: string) => void
}): React.JSX.Element {
  return (
    <>
      <Input label="Who will sign" hint="The full name of the person signing." autoComplete="off" value={props.name} onChange={(event) => props.onName(event.target.value)} />
      <Input label="Their email address" type="email" autoComplete="off" value={props.email} onChange={(event) => props.onEmail(event.target.value)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export interface QuoteSigningPanelProps {
  quoteId: string
  quoteNumber: string
  /** Draft and sent quotes can be sent for acceptance; the action explains the rest. */
  canSendNow: boolean
  canSend: boolean
  defaultSignerName?: string | null
  defaultSignerEmail?: string | null
  /** Called after a send, so the page can refresh the quote's own status. */
  onChanged?: () => void
}

export function QuoteSigningPanel(props: QuoteSigningPanelProps): React.JSX.Element {
  const { documents, loadError, reload } = useSubjectDocuments('quote', props.quoteId)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(props.defaultSignerName ?? '')
  const [email, setEmail] = useState(props.defaultSignerEmail ?? '')

  const send = (): void => {
    setError(null)
    startTransition(async () => {
      const result = await sendQuoteForAcceptance({ quoteId: props.quoteId, signerName: name, signerEmail: email })
      if (result.error || !result.data) {
        setError(result.error ?? 'Could not send the quote.')
        return
      }
      reportSent(result.data, `Quote ${props.quoteNumber} sent for acceptance.`)
      setOpen(false)
      await reload()
      props.onChanged?.()
    })
  }

  if (loadError) return <Alert tone="danger" title="The acceptance records could not be loaded">{loadError}</Alert>
  if (documents === null) return <Loading what="acceptance records" />

  return (
    <>
      <SignaturePanel
        title="Client acceptance"
        documents={documents}
        canSend={props.canSend}
        emptyText="This quote has not been sent for the client to accept online."
        sendActions={
          props.canSend && props.canSendNow ? (
            <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
              Send for acceptance
            </Button>
          ) : undefined
        }
      />
      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false)
        }}
        title={`Send quote ${props.quoteNumber} for acceptance`}
        description="The client gets a link to read the quote and accept it. Accepting marks the quote Accepted."
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={send}>Send for acceptance</Button>
          </>
        }
      >
        <div className="space-y-4">
          <SignerFields name={name} email={email} onName={setName} onEmail={setEmail} />
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        </div>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// Client agreements
// ---------------------------------------------------------------------------

export interface ClientAgreementPanelProps {
  vendorId: string
  clientName: string
  canSend: boolean
  defaultSignerName?: string | null
  defaultSignerEmail?: string | null
}

export function ClientAgreementPanel(props: ClientAgreementPanelProps): React.JSX.Element {
  const { documents, loadError, reload } = useSubjectDocuments('invoice_vendor', props.vendorId)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(props.defaultSignerName ?? '')
  const [email, setEmail] = useState(props.defaultSignerEmail ?? '')
  const [services, setServices] = useState('')
  const [fees, setFees] = useState('')
  const [startDate, setStartDate] = useState('')

  const send = (): void => {
    setError(null)
    startTransition(async () => {
      const result = await sendClientAgreement({
        vendorId: props.vendorId,
        signerName: name,
        signerEmail: email,
        servicesSummary: services,
        feesSummary: fees,
        startDate,
      })
      if (result.error || !result.data) {
        setError(result.error ?? 'Could not send the agreement.')
        return
      }
      reportSent(result.data, `Agreement sent to ${props.clientName}.`)
      setOpen(false)
      await reload()
    })
  }

  if (loadError) return <Alert tone="danger" title="The agreements could not be loaded">{loadError}</Alert>
  if (documents === null) return <Loading what="agreements" />

  return (
    <>
      <SignaturePanel
        title="Agreements"
        documents={documents}
        canSend={props.canSend}
        emptyText="No agreement has been sent to this client for signature."
        sendActions={
          props.canSend ? (
            <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
              {documents.length > 0 ? 'Send a new agreement' : 'Send agreement'}
            </Button>
          ) : undefined
        }
      />
      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false)
        }}
        title={`Send an agreement to ${props.clientName}`}
        description="The client gets a link to read the agreement and sign it. You sign for Orange Jelly as you send it."
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={send}>Send agreement</Button>
          </>
        }
      >
        <div className="space-y-4">
          <SignerFields name={name} email={email} onName={setName} onEmail={setEmail} />
          <Textarea label="What we will do" hint="The work, as the client should read it." rows={5} maxLength={6000} value={services} onChange={(event) => setServices(event.target.value)} />
          <Textarea label="Fees" hint="Rates, retainers and any recurring charges." rows={4} maxLength={4000} value={fees} onChange={(event) => setFees(event.target.value)} />
          <Input label="Starts on" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        </div>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// Suppliers on a booking
// ---------------------------------------------------------------------------

export function BookingSuppliersPanel({ bookingId }: { bookingId: string }): React.JSX.Element | null {
  const [state, setState] = useState<BookingSupplierState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [supplier, setSupplier] = useState<BookingSupplier | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [service, setService] = useState('')
  const [when, setWhen] = useState('')
  const [fee, setFee] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const result = await getBookingSupplierState(bookingId)
    if (result.error || !result.data) {
      setLoadError(result.error ?? 'The supplier confirmations could not be loaded.')
      return
    }
    setLoadError(null)
    setState(result.data)
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load])

  const choose = (chosen: BookingSupplier): void => {
    setSupplier(chosen)
    setError(null)
    setName(chosen.contactName ?? '')
    setEmail(chosen.contactEmail ?? '')
    setService(chosen.services.join('\n'))
    setWhen(state?.eventDate ?? '')
    setFee('')
  }

  const send = (): void => {
    if (!supplier) return
    setError(null)
    startTransition(async () => {
      const result = await sendSupplierConfirmation({
        bookingId,
        vendorId: supplier.vendorId,
        signerName: name,
        signerEmail: email,
        serviceSummary: service,
        eventDate: when,
        feeSummary: fee,
      })
      if (result.error || !result.data) {
        setError(result.error ?? 'Could not send the confirmation.')
        return
      }
      reportSent(result.data, `Confirmation sent to ${supplier.name}.`)
      setSupplier(null)
      await load()
    })
  }

  if (loadError) return <Alert tone="danger" title="The supplier confirmations could not be loaded">{loadError}</Alert>
  if (!state) return <Loading what="supplier confirmations" />
  // A booking with no suppliers and nothing ever sent has nothing to show.
  if (state.suppliers.length === 0 && state.documents.length === 0) return null

  return (
    <>
      <SignaturePanel
        title="Supplier confirmations"
        documents={state.documents}
        canSend={state.canSend}
        emptyText="No supplier has been asked to confirm this booking yet."
        sendActions={
          state.canSend && state.suppliers.length > 0 ? (
            state.suppliers.length === 1 ? (
              <Button size="sm" variant="secondary" onClick={() => choose(state.suppliers[0])}>
                Ask {state.suppliers[0].name} to confirm
              </Button>
            ) : (
              <Dropdown
                width="auto"
                align="right"
                trigger={<Button type="button" size="sm" variant="secondary">Ask a supplier to confirm</Button>}
              >
                {state.suppliers.map((option) => (
                  <DropdownItem key={option.vendorId} onClick={() => choose(option)}>
                    {option.name}
                  </DropdownItem>
                ))}
              </Dropdown>
            )
          ) : undefined
        }
      />
      <Modal
        open={supplier !== null}
        onClose={() => {
          if (!pending) setSupplier(null)
        }}
        title={supplier ? `Ask ${supplier.name} to confirm` : undefined}
        description="They get a link to read the booking details and confirm them."
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSupplier(null)} disabled={pending}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={send}>Send confirmation</Button>
          </>
        }
      >
        <div className="space-y-4">
          <SignerFields name={name} email={email} onName={setName} onEmail={setEmail} />
          <Textarea label="What they are providing" rows={4} maxLength={4000} value={service} onChange={(event) => setService(event.target.value)} />
          <Input label="When" hint="The date, and the times they are needed from and to." value={when} onChange={(event) => setWhen(event.target.value)} />
          <Textarea label="Fee" hint="The amount, whether it includes VAT, and when it is paid." rows={2} maxLength={2000} value={fee} onChange={(event) => setFee(event.target.value)} />
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        </div>
      </Modal>
    </>
  )
}
