'use client'

import Script from 'next/script'
import { useEffect, useMemo, useRef, useState } from 'react'
// Imported file by file rather than through the `guest` barrel, which would pull
// the guest webfont module into this client bundle. GuestShell stays on the server page.
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestCard } from '@/components/features/guest/GuestCard'
import { GuestCardHeader } from '@/components/features/guest/GuestCardHeader'
import { GuestChoice } from '@/components/features/guest/GuestChoice'
import { GuestIntro } from '@/components/features/guest/GuestIntro'
import type { GuestTone } from '@/components/features/guest/status-ui'
import { GUEST_MESSAGE_CLASS, GUEST_MUTED_CLASS } from '@/components/features/guest/styles'

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
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date)
}

function appointmentStarted(appointment: any) {
  return appointment?.scheduled_start && new Date(appointment.scheduled_start) <= new Date()
}

export default function RecruitmentBookingClient({ token, initialPreview }: Props) {
  const [preview, setPreview] = useState(initialPreview)
  const [selectedSlot, setSelectedSlot] = useState('')
  const [message, setMessage] = useState<{ tone: GuestTone; text: string } | null>(null)
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
      setMessage({ tone: 'problem', text: payload?.error?.message || 'Booking failed.' })
      return
    }
    setMessage({ tone: 'success', text: 'Booked.' })
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
      setMessage({ tone: 'problem', text: payload?.error?.message || 'Cancellation failed.' })
      return
    }
    setMessage({ tone: 'success', text: 'Cancelled.' })
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
      setMessage({ tone: 'problem', text: payload?.error?.message || 'Reschedule failed.' })
      return
    }
    setMessage({ tone: 'success', text: 'Rescheduled.' })
    await refresh()
  }

  if (!preview?.valid || !preview.application) {
    return (
      <GuestIntro
        kicker="Interview booking"
        title="Booking unavailable"
        lead="This recruitment booking link is invalid or expired."
      />
    )
  }

  // A fragment, not a wrapper: GuestShell spaces these blocks itself.
  return (
    <>
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTurnstileReady(true)}
        />
      ) : null}

      <GuestIntro
        kicker="Interview booking"
        title={preview.application.role_title}
        lead="Choose a time to come in and meet us at The Anchor."
      />

      {currentAppointment && (
        <GuestCard variant="accent">
          <GuestCardHeader title="Current booking" />
          <div className="flex flex-col gap-guest-md">
            <div>
              <p className={GUEST_MESSAGE_CLASS}>{formatDateTime(currentAppointment.scheduled_start)}</p>
              <p className={GUEST_MUTED_CLASS}>{currentAppointment.location}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <GuestButton type="button" variant="outline" size="sm" onClick={cancel} disabled={pending || readOnly || blockedByTurnstile}>
                Cancel
              </GuestButton>
              <GuestButton type="button" variant="outline" size="sm" onClick={reschedule} disabled={pending || readOnly || !selectedSlot || currentAppointment.reschedule_count >= 1 || blockedByTurnstile}>
                Reschedule
              </GuestButton>
            </div>
          </div>
        </GuestCard>
      )}

      {!readOnly && (
        <GuestCard>
          <GuestCardHeader title="Available times" />
          <div className="flex flex-col gap-guest-md">
            <div className="flex flex-col gap-2">
              {(preview.slots ?? []).map((slot: any) => (
                <GuestChoice
                  key={slot.id}
                  type="radio"
                  id={`slot-${slot.id}`}
                  name="slot"
                  value={slot.id}
                  checked={selectedSlot === slot.id}
                  onChange={() => setSelectedSlot(slot.id)}
                  boxed
                  label={
                    <>
                      <span className="block font-medium text-guest-text-strong">{formatDateTime(slot.starts_at)}</span>
                      <span className="text-guest-text-muted">{slot.location}</span>
                    </>
                  }
                />
              ))}
            </div>
            {!currentAppointment && (
              <div>
                <GuestButton type="button" variant="primary" onClick={claim} disabled={pending || !selectedSlot || blockedByTurnstile}>
                  Book
                </GuestButton>
              </div>
            )}
          </div>
        </GuestCard>
      )}

      {turnstileSiteKey ? (
        <GuestCard>
          <div ref={turnstileRef} />
        </GuestCard>
      ) : null}

      {message && <GuestAlert tone={message.tone}>{message.text}</GuestAlert>}
    </>
  )
}
