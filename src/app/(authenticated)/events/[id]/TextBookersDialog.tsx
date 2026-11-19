'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Modal, PageLoading, Textarea, toast } from '@/ds'
import {
  previewEventBookerText,
  sendEventBookerText,
  type EventBookerTextPreview,
  type EventBookerTextResult,
} from '@/app/actions/event-booker-texts'
import { EVENT_BOOKER_TEXT_MAX_LENGTH } from '@/lib/events/booker-texts'
import { countSmsSegments, normaliseToGsm7 } from '@/lib/sms/gsm7'

interface TextBookersDialogProps {
  open: boolean
  eventId: string
  eventName: string
  onClose: () => void
}

/**
 * Staff write one service text to everyone booked into this event (owner decision,
 * 19 November 2026). The server works out who receives it from the live bookings; this dialog
 * only shows that list, and who will not get it and why.
 */
export function TextBookersDialog({ open, eventId, eventName, onClose }: TextBookersDialogProps) {
  const [includePending, setIncludePending] = useState(false)
  const [preview, setPreview] = useState<EventBookerTextPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<EventBookerTextResult | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setPreviewError(null)
    previewEventBookerText({ eventId, includePendingPayment: includePending })
      .then((response) => {
        if (cancelled) return
        if (response.error || !response.data) {
          setPreview(null)
          setPreviewError(response.error ?? 'Could not load the bookers for this event.')
        } else {
          setPreview(response.data)
        }
      })
      .catch(() => {
        if (!cancelled) setPreviewError('Could not load the bookers for this event.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, eventId, includePending])

  function handleClose() {
    if (sending) return
    setMessage('')
    setResult(null)
    setIncludePending(false)
    onClose()
  }

  async function handleSend() {
    setSending(true)
    try {
      const response = await sendEventBookerText({ eventId, includePendingPayment: includePending, message })
      setResult(response)
      if (response.success && (response.sent ?? 0) + (response.held ?? 0) === 0) {
        toast.success('Everyone already had this message')
      } else if (response.success) {
        toast.success(`Texted ${(response.sent ?? 0) + (response.held ?? 0)} ${(response.sent ?? 0) + (response.held ?? 0) === 1 ? 'booker' : 'bookers'}`)
      } else {
        toast.error(response.error ?? 'The texts could not be sent')
      }
    } catch {
      const failure = { success: false, error: 'The texts could not be sent. Check the messages page before trying again.' }
      setResult(failure)
      toast.error(failure.error)
    } finally {
      setSending(false)
    }
  }

  const trimmed = message.trim()
  const segments = trimmed ? countSmsSegments(normaliseToGsm7(trimmed)) : 0
  const recipientCount = preview?.recipients.length ?? 0
  const tooLong = trimmed.length > EVENT_BOOKER_TEXT_MAX_LENGTH
  const done = result?.success === true || result?.stoppedEarly === true
  const canSend = !loading && !sending && !done && recipientCount > 0 && trimmed.length > 0 && !tooLong

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Text bookers"
      description={`A service text to everyone booked into ${eventName}, about this event.`}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={sending}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          {!done && (
            <Button variant="primary" onClick={handleSend} disabled={!canSend} loading={sending}>
              {`Send to ${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}`}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {result && <SendResult result={result} />}

        {!done && (
          <>
            <Checkbox
              label="Include bookings waiting for payment"
              checked={includePending}
              onChange={setIncludePending}
              disabled={sending}
            />

            {loading ? (
              <PageLoading />
            ) : previewError ? (
              <Alert tone="danger" title="Could not load the bookers">{previewError}</Alert>
            ) : preview ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium text-text">
                    {recipientCount === 0
                      ? 'Nobody booked into this event can be texted.'
                      : `Will text ${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}`}
                  </p>
                  {recipientCount > 0 && (
                    <p className="text-text-muted">
                      {preview.recipients
                        .map((r) => (r.pendingPayment ? `${r.name} (awaiting payment)` : r.name))
                        .join(', ')}
                    </p>
                  )}
                </div>
                {preview.excluded.length > 0 && (
                  <Alert tone="warning" title={`${preview.excluded.length} will not get this text`}>
                    <ul className="list-disc space-y-1 pl-5">
                      {preview.excluded.map((x) => (
                        <li key={x.customerId}>
                          {x.name} ({x.seats} {x.seats === 1 ? 'seat' : 'seats'}): {x.reason}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                )}
              </div>
            ) : null}

            <Textarea
              label="Message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              disabled={sending}
              placeholder="Hi {{first_name}}, a quick note about tomorrow night..."
              error={tooLong ? `Keep it to ${EVENT_BOOKER_TEXT_MAX_LENGTH} characters or fewer` : undefined}
              hint={`${trimmed.length} characters, ${segments} SMS ${segments === 1 ? 'segment' : 'segments'} each. {{first_name}} becomes each booker's first name.`}
            />
            <p className="text-xs text-text-muted">
              Texts written between 9pm and 9am are held and sent from 9am. These go to every booker who accepts texts,
              whether or not they have agreed to marketing, so keep them about this event.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

function SendResult({ result }: { result: EventBookerTextResult }) {
  if (!result.success) {
    return (
      <Alert tone="danger" title="Not sent">
        <p>{result.error}</p>
        {result.stoppedEarly && <p>Check the messages page before trying again, so nobody is texted twice.</p>}
      </Alert>
    )
  }
  const sent = result.sent ?? 0
  const held = result.held ?? 0
  const failed = result.failed ?? 0
  return (
    <Alert tone={failed > 0 ? 'warning' : 'success'} title={failed > 0 ? 'Sent, with some failures' : 'Sent'}>
      <ul className="list-disc space-y-1 pl-5">
        {sent > 0 && <li>{sent} sent now</li>}
        {held > 0 && <li>{held} held by quiet hours, going out from 9am</li>}
        {(result.alreadySent ?? 0) > 0 && <li>{result.alreadySent} already had this exact message, so were not texted again</li>}
        {failed > 0 && <li>{failed} not sent</li>}
        {result.failures?.map((f) => (
          <li key={`${f.name}:${f.error}`}>
            {f.name}: {f.error}
          </li>
        ))}
      </ul>
      {result.stoppedEarly && <p>Sending stopped on a safety check. Check the messages page before sending again.</p>}
    </Alert>
  )
}
