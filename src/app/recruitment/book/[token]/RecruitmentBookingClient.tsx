'use client'

import Script from 'next/script'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/ds'

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
  const [message, setMessage] = useState<string | null>(null)
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
      setMessage(payload?.error?.message || 'Booking failed.')
      return
    }
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
      setMessage(payload?.error?.message || 'Cancellation failed.')
      return
    }
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
      setMessage(payload?.error?.message || 'Reschedule failed.')
      return
    }
    setMessage('Rescheduled.')
    await refresh()
  }

  if (!preview?.valid || !preview.application) {
    return (
      <main className="min-h-screen bg-bg px-4 py-10">
        <div className="mx-auto max-w-xl rounded-lg border border-border bg-surface p-6">
          <h1 className="text-xl font-semibold text-text-strong">Booking unavailable</h1>
          <p className="mt-2 text-sm text-text-muted">This recruitment booking link is invalid or expired.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-bg px-4 py-10">
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTurnstileReady(true)}
        />
      ) : null}
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-text-strong">The Anchor</h1>
          <p className="text-sm text-text-muted">{preview.application.role_title}</p>
        </div>

        {currentAppointment && (
          <section className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-text-strong">Current booking</h2>
            <p className="mt-2 text-sm text-text">{formatDateTime(currentAppointment.scheduled_start)}</p>
            <p className="text-sm text-text-muted">{currentAppointment.location}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={cancel} disabled={pending || readOnly || blockedByTurnstile}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={reschedule} disabled={pending || readOnly || !selectedSlot || currentAppointment.reschedule_count >= 1 || blockedByTurnstile}>
                Reschedule
              </Button>
            </div>
          </section>
        )}

        {!readOnly && (
          <section className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-text-strong">Available times</h2>
            <div className="mt-3 space-y-2">
              {(preview.slots ?? []).map((slot: any) => (
                <label key={slot.id} className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
                  <input
                    type="radio"
                    name="slot"
                    value={slot.id}
                    checked={selectedSlot === slot.id}
                    onChange={() => setSelectedSlot(slot.id)}
                  />
                  <span>
                    <span className="block font-medium text-text-strong">{formatDateTime(slot.starts_at)}</span>
                    <span className="text-text-muted">{slot.location}</span>
                  </span>
                </label>
              ))}
            </div>
            {!currentAppointment && (
              <Button type="button" variant="primary" className="mt-4" onClick={claim} disabled={pending || !selectedSlot || blockedByTurnstile}>
                Book
              </Button>
            )}
          </section>
        )}

        {turnstileSiteKey ? (
          <div className="rounded-lg border border-border bg-surface p-4">
            <div ref={turnstileRef} />
          </div>
        ) : null}

        {message && (
          <p className="text-sm text-text-muted">{message}</p>
        )}
      </div>
    </main>
  )
}
