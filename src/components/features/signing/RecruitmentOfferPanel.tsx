'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Alert, Button, Input, Modal, Spinner, Textarea, toast } from '@/ds'
import { getSigningDocumentsForSubject } from '@/app/actions/signing'
import { sendJobOffer } from '@/app/actions/signing-recruitment'
import type { SigningDocumentSummary } from '@/lib/signing/service'
import { SignaturePanel } from './SignaturePanel'

export interface RecruitmentOfferPanelProps {
  applicationId: string
  candidateName: string
  /** The written offer can only be sent at the Offered stage. Later stages still show it. */
  canSendNow: boolean
  canSend: boolean
}

/**
 * The written job offer for one application: send it, and see whether the candidate has
 * accepted or declined. Loads its own records, so the recruitment screen only has to place it.
 */
export function RecruitmentOfferPanel({ applicationId, candidateName, canSendNow, canSend }: RecruitmentOfferPanelProps): React.JSX.Element {
  const [documents, setDocuments] = useState<SigningDocumentSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [jobTitle, setJobTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [payDetails, setPayDetails] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const result = await getSigningDocumentsForSubject('recruitment_application', applicationId)
    if (result.error) {
      setLoadError(result.error)
      return
    }
    setLoadError(null)
    setDocuments(result.data ?? [])
  }, [applicationId])

  useEffect(() => {
    setDocuments(null)
    void load()
  }, [load])

  const send = (): void => {
    setError(null)
    startTransition(async () => {
      const result = await sendJobOffer({ applicationId, jobTitle, startDate, payDetails })
      if (result.error || !result.data) {
        setError(result.error ?? 'Could not send the offer.')
        return
      }
      const failed = result.data.deliveries.some((delivery) => delivery.email_status === 'failed')
      if (failed) {
        toast.error('Offer created, but the email failed. Use "Send new link".')
      } else {
        toast.success(`Offer sent to ${candidateName}.`)
      }
      setOpen(false)
      await load()
    })
  }

  if (loadError) {
    return <Alert tone="danger" title="The written offer could not be loaded">{loadError}</Alert>
  }
  if (documents === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
        <Spinner /> Loading the written offer
      </div>
    )
  }

  return (
    <>
      <SignaturePanel
        title="Written Offer"
        documents={documents}
        canSend={canSend}
        emptyText="No written offer has been sent yet."
        sendActions={
          canSend && canSendNow ? (
            <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
              {documents.length > 0 ? 'Send a New Offer' : 'Send Written Offer'}
            </Button>
          ) : undefined
        }
      />

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false)
        }}
        title="Send Written Offer"
        description={`${candidateName} gets a link to read the offer and accept or decline it.`}
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} onClick={send}>
              Send Offer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Job title" placeholder="e.g. Bar and floor team member" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
          <Input label="Start date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          <Textarea
            label="Pay"
            hint="Write it as the candidate should read it: the hourly rate, and how often they are paid."
            rows={3}
            maxLength={2000}
            value={payDetails}
            onChange={(event) => setPayDetails(event.target.value)}
          />
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        </div>
      </Modal>
    </>
  )
}
