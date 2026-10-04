'use client'

import { useEffect, useId, useState } from 'react'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Empty, Spinner } from '@/ds'
import { getInvoiceEmailHistory } from '@/app/actions/invoice-reminders'
import type { InvoiceEmailHistory, InvoiceEmailHistoryEntry } from '@/lib/invoices/email-history'

interface InvoiceEmailsPanelProps {
  invoiceId: string
  /** Changes whenever the invoice does (a send, a hold, a payment), so the panel reads again. */
  reloadKey?: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; history: InvoiceEmailHistory | null }

function copiesText(copies: string[] | null): string {
  // Emails sent before copies were saved with them: not recorded is not the same as none.
  if (copies === null) return 'Copies not recorded'
  return copies.length === 0 ? 'No copies' : `Copied to ${copies.join(', ')}`
}

function EmailEntry({ email }: { email: InvoiceEmailHistoryEntry }) {
  const [open, setOpen] = useState(false)
  const wordingId = useId()

  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{email.kindLabel}</Badge>
        <Badge tone={email.outcomeTone}>{email.outcome}</Badge>
        {email.kindInferred && <span className="text-xs text-text-muted">Kind worked out from the subject</span>}
      </div>
      <p className="break-words text-sm font-medium">{email.subject}</p>
      <p className="break-words text-sm text-text-muted">{email.sentAtLabel}</p>
      <p className="break-words text-sm text-text-muted">To {email.to}</p>
      <p className="break-words text-sm text-text-muted">{copiesText(email.copies)}</p>
      <Button
        type="button"
        variant="link"
        size="sm"
        aria-expanded={open}
        aria-controls={wordingId}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? 'Hide wording' : 'Show wording'}
      </Button>
      {open && (
        // Plain text, escaped by React, with its line breaks kept by CSS. Never rendered as
        // HTML: it is whatever was typed into an email, and may carry a payment link.
        <div id={wordingId} className="whitespace-pre-wrap break-words rounded-default bg-surface-2 p-3 text-sm">
          {email.body ?? 'The wording of this email was not recorded.'}
        </div>
      )}
    </li>
  )
}

/**
 * The "Emails" card on the invoice page: what the reminder job will do next, the invoice's own
 * record of what was sent, and every customer email about the invoice.
 */
export function InvoiceEmailsPanel({ invoiceId, reloadKey }: InvoiceEmailsPanelProps) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setState({ phase: 'loading' })

    getInvoiceEmailHistory(invoiceId)
      .then((result) => {
        if (!current) return
        setState(
          result.error
            ? { phase: 'error', message: result.error }
            : { phase: 'ready', history: result.history ?? null }
        )
      })
      .catch(() => {
        if (current) setState({ phase: 'error', message: 'The email history could not be loaded' })
      })

    return () => {
      current = false
    }
  }, [invoiceId, reloadKey, attempt])

  const history = state.phase === 'ready' ? state.history : null

  return (
    <Card>
      <CardHeader
        title="Emails"
        subtitle="Every email sent to the customer about this invoice, newest first."
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
            disabled={state.phase === 'loading'}
          >
            Refresh
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {state.phase === 'loading' && (
          <div role="status" className="flex items-center gap-2 text-sm text-text-muted">
            <Spinner size="sm" />
            <span>Loading emails</span>
          </div>
        )}

        {state.phase === 'error' && <Alert tone="danger">{state.message}</Alert>}

        {state.phase === 'ready' && !history && (
          <Empty size="sm" title="No email history" description="There is nothing recorded for this invoice." />
        )}

        {history && (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">{history.nextReminder.line}</p>
              {history.nextReminder.detail && (
                <p className="text-sm text-text-muted">{history.nextReminder.detail}</p>
              )}
            </div>

            <div className="space-y-1 border-t border-border pt-4">
              <dl className="space-y-1 text-sm">
                {history.crossCheck.map((item) => (
                  <div key={item.label} className="flex flex-wrap justify-between gap-x-4">
                    <dt className="text-text-muted">{item.label}</dt>
                    <dd className="font-medium">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-text-muted">
                From the invoice&apos;s own record. A date here with no email below means the email went but its
                record was not saved.
              </p>
            </div>

            {history.earlierEmailsNotRecorded && (
              <Alert tone="info" role="status">
                Emails sent before 25 June 2026 are not recorded here.
              </Alert>
            )}

            <div className="border-t border-border pt-4">
              {history.emails.length === 0 ? (
                <Empty size="sm" title="No emails recorded" description="Nothing has been saved against this invoice yet." />
              ) : (
                <ul className="divide-y divide-border">
                  {history.emails.map((email) => (
                    <EmailEntry key={email.id} email={email} />
                  ))}
                </ul>
              )}
              {history.truncated && (
                <p className="pt-3 text-xs text-text-muted">Only the latest 100 emails are shown.</p>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}
