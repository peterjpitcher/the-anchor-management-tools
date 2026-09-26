'use client'

import { useEffect, useState, useTransition } from 'react'
import { Alert, Modal, Button, Textarea, Select, Input, Radio, Spinner, toast } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  previewTableBookingGuests,
  messageTableBookingGuests,
  type PreviewResult,
  type SendResult,
} from '@/app/actions/table-booking-messages'
import { STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT } from '@/lib/messaging/staff-email-defaults'

type BulkChannel = 'email_first' | 'sms'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** The toast for an email-first send: what actually went, by which channel. */
function describeEmailFirstResult(res: SendResult): string {
  const parts: string[] = []
  if (res.emailed) parts.push(`Emailed ${plural(res.emailed, 'guest')}`)
  if (res.sent) parts.push(`texted ${plural(res.sent, 'guest')}`)
  if (res.scheduled) parts.push(`${res.scheduled} text${res.scheduled === 1 ? '' : 's'} scheduled for later (quiet hours)`)
  if (res.skipped) parts.push(`${res.skipped} skipped`)
  if (res.failed) parts.push(`${res.failed} failed`)
  if (res.paused) parts.push('texts paused by the SMS limit, so retry shortly')
  const text = parts.join(', ')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Nothing was sent'
}

const SMS_SEGMENT_LENGTH = 160
const SMS_SEGMENT_LENGTH_UNICODE = 70
const MAX_CHARS = 1000

// Mirrors the GSM-7 vs Unicode segment counter used in BulkMessagesClient.
function countSmsSegments(text: string): { chars: number; segments: number; isUnicode: boolean } {
  const chars = text.length
  if (chars === 0) return { chars: 0, segments: 0, isUnicode: false }
  const isUnicode = /[^\x00-\x7F £¤¥§¿Ä-ÆÉÑÖØÜßàä-éìñòöøùü]/.test(text)
  const limit = isUnicode ? SMS_SEGMENT_LENGTH_UNICODE : SMS_SEGMENT_LENGTH
  return { chars, segments: Math.ceil(chars / limit), isUnicode }
}

interface MessageGuestsModalProps {
  open: boolean
  onClose: () => void
  bookingDate: string
}

export function MessageGuestsModal({ open, onClose, bookingDate }: MessageGuestsModalProps) {
  const [time, setTime] = useState<string>('all')
  const [message, setMessage] = useState<string>('Hi {{first_name}}, ')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [isSending, startSending] = useTransition()
  // P7: only offered while the email option is switched on (the preview says so).
  const [channel, setChannel] = useState<BulkChannel>('email_first')
  const [subject, setSubject] = useState(STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT)

  // Reset transient state each time the modal opens.
  useEffect(() => {
    if (open) {
      setTime('all')
      setMessage('Hi {{first_name}}, ')
      setChannel('email_first')
      setSubject(STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT)
    }
  }, [open])

  // Load reachability counts for the current scope.
  useEffect(() => {
    if (!open || !bookingDate) return
    let cancelled = false
    setLoadingPreview(true)
    setPreview(null)
    setPreviewError(null)
    previewTableBookingGuests({ date: bookingDate, time: time === 'all' ? undefined : time })
      .then((res) => {
        if (cancelled) return
        if (res.error) {
          setPreviewError(res.error)
          return
        }
        setPreview(res.data ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, bookingDate, time])

  const { chars, segments } = countSmsSegments(message)
  const emailOption = preview?.emailOption ?? null
  const emailFirst = Boolean(emailOption) && channel === 'email_first'
  const eligible = emailFirst ? emailOption?.reachable ?? 0 : preview?.eligible ?? 0
  const canSend =
    eligible > 0 &&
    message.trim().length > 0 &&
    chars <= MAX_CHARS &&
    (!emailFirst || subject.trim().length > 0) &&
    !isSending

  function handleSend() {
    startSending(async () => {
      const res = await messageTableBookingGuests({
        date: bookingDate,
        time: time === 'all' ? undefined : time,
        message,
        ...(emailOption ? { channel, subject: subject.trim() } : {}),
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.channel === 'email_first') {
        const summary = describeEmailFirstResult(res)
        if (res.failed && !res.emailed && !res.sent && !res.scheduled) toast.error(summary)
        else toast.success(summary)
        onClose()
        return
      }
      const sent = res.sent ?? 0
      const parts = [`Sent to ${sent} guest${sent === 1 ? '' : 's'}`]
      if (res.scheduled) parts.push(`${res.scheduled} scheduled for later (quiet hours)`)
      if (res.skipped) parts.push(`${res.skipped} skipped`)
      if (res.failed) parts.push(`${res.failed} failed`)
      if (res.paused) parts.push('paused by SMS limit — retry shortly')
      toast.success(parts.join(', '))
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Message Guests"
      width="md"
      // The DS Modal panel carries data-touch-targets, so on a touch screen (the bar iPad) these
      // controls get the 44px floor (owner decision D6).
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSend} loading={isSending} disabled={!canSend}>
            {eligible > 0 ? `Send to ${eligible} Guest${eligible === 1 ? '' : 's'}` : 'Send'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          {emailOption ? 'Send a message' : 'Send a text'} to guests booked on{' '}
          <span className="font-medium text-text">
            {formatDateInLondon(bookingDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          . Only confirmed bookings are included.
        </p>

        <Select
          label="Time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          disabled={isSending}
        >
          <option value="all">All times</option>
          {(preview?.availableTimes ?? []).map((t) => (
            <option key={t.time} value={t.time}>
              {t.time} ({t.count} booking{t.count === 1 ? '' : 's'})
            </option>
          ))}
        </Select>

        {emailOption && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-text-muted">Send by</legend>
            <Radio
              name="message-guests-channel"
              value="email_first"
              label="Email where the guest has a usable address, text the rest"
              checked={channel === 'email_first'}
              onChange={() => setChannel('email_first')}
              disabled={isSending}
            />
            <Radio
              name="message-guests-channel"
              value="sms"
              label="Text only"
              checked={channel === 'sms'}
              onChange={() => setChannel('sms')}
              disabled={isSending}
            />
          </fieldset>
        )}

        {emailFirst && (
          <Input
            label="Email subject"
            value={subject}
            maxLength={200}
            onChange={(e) => setSubject(e.target.value)}
            disabled={isSending}
          />
        )}

        <Textarea
          label="Message"
          hint={`Use {{first_name}} to personalise (no-name guests are greeted as 'there'). · ${chars} character${chars === 1 ? '' : 's'} · ${segments} SMS segment${segments === 1 ? '' : 's'}`}
          rows={4}
          maxLength={MAX_CHARS}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isSending}
        />

        {loadingPreview ? (
          <Alert tone="info" role="status">
            <span className="inline-flex items-center gap-2">
              <Spinner size="sm" />
              Checking who can be reached…
            </span>
          </Alert>
        ) : previewError ? (
          <Alert tone="danger">Couldn&apos;t load guests: {previewError}</Alert>
        ) : preview && preview.total > 0 && emailFirst && emailOption ? (
          <Alert tone="info" role="status">
            <ul className="space-y-1">
              <li>
                <span className="font-semibold">{emailOption.emailable}</span> will be emailed and{' '}
                <span className="font-semibold">{emailOption.textOnly}</span> texted, of {plural(preview.total, 'guest')}.
              </li>
              {preview.total - emailOption.reachable > 0 && (
                <li>
                  {preview.total - emailOption.reachable} can&apos;t be reached (no usable email address and no mobile with SMS opt-in).
                </li>
              )}
              {emailOption.noName > 0 && (
                <li>
                  {emailOption.noName} have no name on file and will be greeted as &apos;there&apos;.
                </li>
              )}
            </ul>
          </Alert>
        ) : preview && preview.total > 0 ? (
          <Alert tone="info" role="status">
            <ul className="space-y-1">
              <li>
                <span className="font-semibold">{preview.eligible}</span> of {preview.total} guest
                {preview.total === 1 ? '' : 's'} will be texted.
              </li>
              {preview.unreachable > 0 && (
                <li>
                  {preview.unreachable} can&apos;t be reached (no mobile, opted out, or deactivated).
                </li>
              )}
              {preview.noName > 0 && (
                <li>
                  {preview.noName} have no name on file and will be greeted as &apos;there&apos;.
                </li>
              )}
            </ul>
          </Alert>
        ) : (
          <Alert tone="info" role="status">No guests found for this selection.</Alert>
        )}
      </div>
    </Modal>
  )
}
