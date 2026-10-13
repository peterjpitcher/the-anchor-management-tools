'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, LinkButton, Modal, Textarea, toast } from '@/ds'
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
  title = 'Documents for Signature',
  emptyText = 'Nothing has been sent for signature yet.',
}: SignaturePanelProps): React.JSX.Element {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<SigningDocumentSummary | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [inPerson, setInPerson] = useState<{ url: string; qr: string | null } | null>(null)

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
      // Never opened here: this browser is signed in as the manager, and a device handed over
      // with it would give the signer everything the manager can see. The link is shown as a
      // code to scan on the signer's own phone or a signed-out tablet.
      try {
        const QRCode = (await import('qrcode')).default
        setInPerson({ url: result.data.url, qr: await QRCode.toDataURL(result.data.url, { margin: 1, width: 240 }) })
      } catch {
        setInPerson({ url: result.data.url, qr: null })
      }
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
                        <div className="min-w-0 break-words">
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
                            {party.identity_check !== 'none' && !party.identity_checked_at && party.identity_check_failures >= 5 && party.status === 'pending'
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
                                  aria-label={`Send New Link to ${party.name}`}
                                >
                                  Send New Link
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={busyKey === `inperson:${party.id}`}
                                disabled={pending}
                                onClick={() => signInPerson(party.id)}
                                aria-label={`Sign in Person: ${party.name}`}
                              >
                                Sign in Person
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2">
                    <LinkButton href={`/api/signing/documents/${document.id}/pdf`} size="sm" variant="secondary" download>
                      {document.status === 'completed' || document.status === 'superseded' ? 'Download Signed Copy' : 'Download Document'}
                      <span className="sr-only">: {document.title}, version {document.version}</span>
                    </LinkButton>
                    {canSend && open ? (
                      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setVoiding(document)} aria-label={`Withdraw ${document.title}, version ${document.version}`}>
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
        open={inPerson !== null}
        onClose={() => setInPerson(null)}
        title="Sign In Person"
        description="Scan this with the phone or tablet they will sign on. It works for 30 minutes, and their emailed link no longer works."
        footer={
          <Button type="button" variant="primary" onClick={() => setInPerson(null)}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <Alert tone="warning">
            Do not hand over a device that is signed in to this app. Use their own phone, or a tablet that is signed out.
          </Alert>
          {inPerson?.qr ? (
            <Image src={inPerson.qr} alt="Code to scan to open the signing screen" width={240} height={240} unoptimized className="mx-auto" />
          ) : null}
          <Input
            label="Or type this address into the other device"
            readOnly
            value={inPerson?.url ?? ''}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      </Modal>

      <Modal
        open={voiding !== null}
        onClose={() => {
          setVoiding(null)
          setVoidReason('')
        }}
        title="Withdraw This Request"
        description="The signing link stops working straight away. Anything already signed stays on record."
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setVoiding(null)
                setVoidReason('')
              }}
            >
              Keep It
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
