'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Card, CardBody, CardHeader, LinkButton, Modal, Textarea, toast } from '@/ds'
import { sendSigningReminder, startInPersonSigningAction, voidSigningRequest } from '@/app/actions/signing'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import { getSigningKind, signingRoleLabel } from '@/lib/signing/kinds'
import type { SigningDocumentSummary } from '@/lib/signing/service'
import { SIGNING_OPEN_STATUSES } from '@/lib/signing/types'
import {
  SIGNING_DOCUMENT_STATUS_LABEL,
  SIGNING_DOCUMENT_STATUS_TONE,
  SIGNING_METHOD_LABEL,
  SIGNING_PARTY_STATUS_LABEL,
  SIGNING_PARTY_STATUS_TONE,
} from './status-ui'

export interface SignaturePanelProps {
  /** Everything sent for signature on this record, newest first. */
  documents: SigningDocumentSummary[]
  /** May this person chase, withdraw and start in-person signing? */
  canSend: boolean
  /** The record's own "Send for signature" buttons, one per kind it offers. */
  sendActions?: React.ReactNode
  title?: string
  /** Shown when nothing has been sent yet. */
  emptyText?: string
}

function formatWhen(iso: string): string {
  return formatDateTimeInLondon(iso, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

/**
 * The one panel every record uses to show what has been sent for signature and where each
 * document has got to. Sending is the record's own business (see `sendActions`); chasing,
 * withdrawing, in-person signing and downloading are the same everywhere and live here.
 */
export function SignaturePanel({
  documents,
  canSend,
  sendActions,
  title = 'Documents for signature',
  emptyText = 'Nothing has been sent for signature yet.',
}: SignaturePanelProps): React.JSX.Element {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<SigningDocumentSummary | null>(null)
  const [voidReason, setVoidReason] = useState('')

  const run = (key: string, work: () => Promise<void>): void => {
    setBusyKey(key)
    startTransition(async () => {
      try {
        await work()
      } finally {
        setBusyKey(null)
      }
    })
  }

  const remind = (partyId: string, name: string): void =>
    run(`remind:${partyId}`, async () => {
      const result = await sendSigningReminder(partyId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`New link sent to ${name}. Their earlier link no longer works.`)
      router.refresh()
    })

  const signInPerson = (partyId: string): void =>
    run(`inperson:${partyId}`, async () => {
      const result = await startInPersonSigningAction(partyId)
      if (result.error || !result.data) {
        toast.error(result.error ?? 'Could not start in-person signing.')
        return
      }
      // A new tab, so the manager's own session stays where it was when the device comes back.
      window.open(result.data.url, '_blank', 'noopener')
      toast.success('Signing screen opened in a new tab. It works for 30 minutes, and their emailed link no longer does.')
      router.refresh()
    })

  const confirmVoid = (): void => {
    if (!voiding) return
    const target = voiding
    run(`void:${target.id}`, async () => {
      const result = await voidSigningRequest({ documentId: target.id, reason: voidReason })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Request withdrawn. The link no longer works.')
      setVoiding(null)
      setVoidReason('')
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader title={title} action={sendActions} />
      <CardBody>
        {documents.length === 0 ? (
          <p className="text-sm text-text-muted">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((document) => {
              const open = SIGNING_OPEN_STATUSES.includes(document.status)
              return (
                <li key={document.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-text-strong">{document.title}</p>
                      <p className="text-xs text-text-muted">
                        {getSigningKind(document.kind).label}, version {document.version}, sent {formatWhen(document.sent_at)}
                        {document.status === 'voided' && document.void_reason ? `. ${document.void_reason}` : ''}
                      </p>
                    </div>
                    <Badge tone={SIGNING_DOCUMENT_STATUS_TONE[document.status]}>
                      {SIGNING_DOCUMENT_STATUS_LABEL[document.status]}
                    </Badge>
                  </div>

                  <ul className="space-y-2">
                    {document.parties.map((party) => (
                      <li key={party.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <span className="text-text">{party.name}</span>{' '}
                          <span className="text-text-muted">
                            ({signingRoleLabel(party.role)}
                            {party.email ? `, ${party.email}` : ''})
                          </span>
                          <p className="text-xs text-text-muted">
                            {party.status === 'signed' && party.signed_at
                              ? `Signed ${formatWhen(party.signed_at)}${party.method ? ` ${SIGNING_METHOD_LABEL[party.method]}` : ''}`
                              : party.status === 'declined'
                                ? `Declined${party.decline_reason ? `: ${party.decline_reason}` : ''}`
                                : party.document_viewed_at
                                  ? 'Opened the document, not yet signed'
                                  : party.first_opened_at
                                    ? 'Opened the link, not yet read the document'
                                    : party.email
                                      ? 'Link sent, not yet opened'
                                      : 'No email address: sign in person'}
                            {party.identity_check !== 'none' && party.identity_check_failures >= 5 && party.status === 'pending'
                              ? '. Locked after wrong dates of birth: send a new link'
                              : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge size="sm" tone={SIGNING_PARTY_STATUS_TONE[party.status]}>
                            {SIGNING_PARTY_STATUS_LABEL[party.status]}
                          </Badge>
                          {canSend && open && party.status === 'pending' && party.role !== 'company' ? (
                            <>
                              {party.email ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={busyKey === `remind:${party.id}`}
                                  disabled={pending}
                                  onClick={() => remind(party.id, party.name)}
                                >
                                  Send new link
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={busyKey === `inperson:${party.id}`}
                                disabled={pending}
                                onClick={() => signInPerson(party.id)}
                              >
                                Sign in person
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2">
                    <LinkButton href={`/api/signing/documents/${document.id}/pdf`} size="sm" variant="secondary" download>
                      {document.status === 'completed' || document.status === 'superseded' ? 'Download signed copy' : 'Download document'}
                    </LinkButton>
                    {canSend && open ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setVoiding(document)}>
                        Withdraw
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>

      <Modal
        open={voiding !== null}
        onClose={() => {
          setVoiding(null)
          setVoidReason('')
        }}
        title="Withdraw this request"
        description="The signing link stops working straight away. Anything already signed stays on record."
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoiding(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={voiding !== null && busyKey === `void:${voiding.id}`}
              disabled={voidReason.trim().length < 3}
              onClick={confirmVoid}
            >
              Withdraw
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason"
          hint="Kept on the record. The signer is not told."
          rows={3}
          maxLength={300}
          value={voidReason}
          onChange={(event) => setVoidReason(event.target.value)}
        />
      </Modal>
    </Card>
  )
}
