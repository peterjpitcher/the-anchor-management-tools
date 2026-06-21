'use client'

import { useEffect, useState, useTransition } from 'react'
import { Modal, Button, Textarea, Select, toast } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  previewTableBookingGuests,
  messageTableBookingGuests,
  type PreviewResult,
} from '@/app/actions/table-booking-messages'

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

  // Reset transient state each time the modal opens.
  useEffect(() => {
    if (open) {
      setTime('all')
      setMessage('Hi {{first_name}}, ')
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
  const eligible = preview?.eligible ?? 0
  const canSend = eligible > 0 && message.trim().length > 0 && chars <= MAX_CHARS && !isSending

  function handleSend() {
    startSending(async () => {
      const res = await messageTableBookingGuests({
        date: bookingDate,
        time: time === 'all' ? undefined : time,
        message,
      })
      if (res.error) {
        toast.error(res.error)
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
      title="Message guests"
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSend} loading={isSending} disabled={!canSend}>
            {eligible > 0 ? `Send to ${eligible} guest${eligible === 1 ? '' : 's'}` : 'Send'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          Send a text to guests booked on{' '}
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

        <Textarea
          label="Message"
          hint={`Use {{first_name}} to personalise (no-name guests are greeted as 'there'). · ${chars} character${chars === 1 ? '' : 's'} · ${segments} SMS segment${segments === 1 ? '' : 's'}`}
          rows={4}
          maxLength={MAX_CHARS}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isSending}
        />

        <div className="rounded-default bg-surface-2 border border-border p-3 text-sm">
          {loadingPreview ? (
            <span className="text-text-subtle">Checking who can be reached…</span>
          ) : previewError ? (
            <span className="text-danger">Couldn&apos;t load guests: {previewError}</span>
          ) : preview && preview.total > 0 ? (
            <ul className="space-y-1 text-text-muted">
              <li>
                <span className="font-medium text-text">{preview.eligible}</span> of {preview.total} guest
                {preview.total === 1 ? '' : 's'} will be texted.
              </li>
              {preview.unreachable > 0 && (
                <li className="text-text-subtle">
                  {preview.unreachable} can&apos;t be reached (no mobile, opted out, or deactivated).
                </li>
              )}
              {preview.noName > 0 && (
                <li className="text-text-subtle">
                  {preview.noName} have no name on file and will be greeted as &apos;there&apos;.
                </li>
              )}
            </ul>
          ) : (
            <span className="text-text-subtle">No guests found for this selection.</span>
          )}
        </div>
      </div>
    </Modal>
  )
}
