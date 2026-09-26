'use client'

import Script from 'next/script'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GuestAlert,
  GuestButton,
  GuestCard,
  GUEST_CHOICE_ROW_CLASS,
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
} from '@/components/features/guest'
import { formatDateTimeInLondon } from '@/lib/dateUtils'

type Props = {
  token: string
  initialPreview: any
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string
          callback?: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
        }
      ) => string
      reset?: (widgetId?: string) => void
    }
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatDateTimeInLondon(date, {
    dateStyle: 'full',
    timeStyle: 'short',
  })
}

function appointmentStarted(appointment: any) {
  return appointment?.scheduled_start && new Date(appointment.scheduled_start) <= new Date()
}

export default function RecruitmentBookingClient({ token, initialPreview }: Props) {
  const [preview, setPreview] = useState(initialPreview)
  const [selectedSlot, setSelectedSlot] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [messageIsError, setMessageIsError] = useState(false)
  const [pending, setPending] = useState(false)
  const [turnstileReady, setTurnstileReady] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<HTMLDivElement | null>(null)
  const turnstileWidgetId = useRef<string | null>(null)
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  const currentAppointment = preview?.currentAppointment
  const readOnly = useMemo(() => appointmentStarted(currentAppointment), [currentAppointment])
  const needsTurnstile = Boolean(turnstileSiteKey)
  const blockedByTurnstile = needsTurnstile && !turnstileToken

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileReady || !turnstileRef.current || turnstileWidgetId.current || !window.turnstile) {
      return
    }

    turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      callback: setTurnstileToken,
      'expired-callback': () => setTurnstileToken(null),
      'error-callback': () => setTurnstileToken(null),
    })
  }, [turnstileReady, turnstileSiteKey])

  function turnstileHeaders(): Record<string, string> {
    return turnstileToken ? { 'X-Turnstile-Token': turnstileToken } : {}
  }

  function resetTurnstile() {
    if (turnstileWidgetId.current && window.turnstile?.reset) {
      window.turnstile.reset(turnstileWidgetId.current)
    }
    setTurnstileToken(null)
  }

  async function refresh() {
    const response = await fetch(`/api/recruitment/booking/${encodeURIComponent(token)}`)
    const payload = await response.json()
    if (payload.success) {
      setPreview({
        valid: true,
        application: payload.data.application,
        slots: payload.data.slots,
        alreadyBooked: payload.data.already_booked,
        currentAppointment: payload.data.current_appointment,
      })
    }
  }

  async function claim() {
    if (!selectedSlot) return
    setPending(true)
    setMessage(null)
    const response = await fetch(`/api/recruitment/booking/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...turnstileHeaders() },
      body: JSON.stringify({ slot_id: selectedSlot, turnstile_token: turnstileToken }),
    })
    const payload = await response.json()
    resetTurnstile()
    setPending(false)
    if (!response.ok || !payload.success) {
      setMessageIsError(true)
      setMessage(payload?.error?.message || 'Booking failed.')
      return
    }
    setMessageIsError(false)
    setMessage('Booked.')
    await refresh()
  }

  async function cancel() {
    setPending(true)
    setMessage(null)
    const response = await fetch(`/api/recruitment/booking/${encodeURIComponent(token)}/cancel`, {
      method: 'POST',
      headers: turnstileHeaders(),
    })
    const payload = await response.json()
    resetTurnstile()
    setPending(false)
    if (!response.ok || !payload.success) {
      setMessageIsError(true)
      setMessage(payload?.error?.message || 'Cancellation failed.')
      return
    }
    setMessageIsError(false)
    setMessage('Cancelled.')
    await refresh()
  }

  async function reschedule() {
    if (!selectedSlot) return
    setPending(true)
    setMessage(null)
    const response = await fetch(`/api/recruitment/booking/${encodeURIComponent(token)}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...turnstileHeaders() },
      body: JSON.stringify({ slot_id: selectedSlot, turnstile_token: turnstileToken }),
    })
    const payload = await response.json()
    resetTurnstile()
    setPending(false)
    if (!response.ok || !payload.success) {
      setMessageIsError(true)
      setMessage(payload?.error?.message || 'Reschedule failed.')
      return
    }
    setMessageIsError(false)
    setMessage('Rescheduled.')
    await refresh()
  }

  if (!preview?.valid || !preview.application) {
    return (
      <section className="flex flex-col gap-6">
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>Interview booking</p>
          <h1 className={GUEST_H1_CLASS}>Booking unavailable</h1>
          <p className={GUEST_LEAD_CLASS}>This recruitment booking link is invalid or expired.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTurnstileReady(true)}
        />
      ) : null}

      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>Interview booking</p>
        <h1 className={GUEST_H1_CLASS}>{preview.application.role_title}</h1>
        <p className={GUEST_LEAD_CLASS}>Choose a time to come in and meet us at The Anchor.</p>
      </div>

      {currentAppointment && (
        <GuestCard variant="accent">
          <h2 className="font-anchor-body text-sm font-semibold text-guest-text-strong">Current booking</h2>
          <p className="mt-2 font-anchor-body text-base text-guest-text">{formatDateTime(currentAppointment.scheduled_start)}</p>
          <p className="font-anchor-body text-sm text-guest-text-muted">{currentAppointment.location}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <GuestButton type="button" variant="outline" size="sm" onClick={cancel} disabled={pending || readOnly || blockedByTurnstile}>
              Cancel
            </GuestButton>
            <GuestButton type="button" variant="outline" size="sm" onClick={reschedule} disabled={pending || readOnly || !selectedSlot || currentAppointment.reschedule_count >= 1 || blockedByTurnstile}>
              Reschedule
            </GuestButton>
          </div>
        </GuestCard>
      )}

      {!readOnly && (
        <GuestCard>
          <h2 className="font-anchor-body text-sm font-semibold text-guest-text-strong">Available times</h2>
          <div className="mt-3 flex flex-col gap-2">
            {(preview.slots ?? []).map((slot: any) => (
              <label key={slot.id} className={`${GUEST_CHOICE_ROW_CLASS} rounded-guest-field border border-guest-border px-3 py-2`}>
                <input
                  type="radio"
                  name="slot"
                  value={slot.id}
                  checked={selectedSlot === slot.id}
                  onChange={() => setSelectedSlot(slot.id)}
                />
                <span>
                  <span className="block font-medium text-guest-text-strong">{formatDateTime(slot.starts_at)}</span>
                  <span className="text-guest-text-muted">{slot.location}</span>
                </span>
              </label>
            ))}
          </div>
          {!currentAppointment && (
            <GuestButton type="button" variant="primary" className="mt-4" onClick={claim} disabled={pending || !selectedSlot || blockedByTurnstile}>
              Book
            </GuestButton>
          )}
        </GuestCard>
      )}

      {turnstileSiteKey ? (
        <GuestCard>
          <div ref={turnstileRef} />
        </GuestCard>
      ) : null}

      {message && (
        <GuestAlert tone={messageIsError ? 'problem' : 'success'}>{message}</GuestAlert>
      )}
    </section>
  )
}
