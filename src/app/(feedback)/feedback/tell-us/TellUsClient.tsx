'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { StarRating } from '@/components/features/feedback/StarRating'
import {
  GUEST_CHOICE_ROW_CLASS,
  GUEST_H1_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
  GUEST_TEXTAREA_CLASS,
  GuestAlert,
  GuestButton,
  GuestCard,
  GuestField,
  guestFieldControlProps,
} from '@/components/features/guest'
import { cn } from '@/lib/utils'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface TellUsClientProps {
  src?: string | null
}

export function TellUsClient({ src }: TellUsClientProps) {
  const router = useRouter()
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const [rating, setRating] = useState(0)
  const [comments, setComments] = useState('')
  const [showContact, setShowContact] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [honeypot, setHoneypot] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')

    if (rating < 1) {
      setError('Please choose a star rating first.')
      return
    }

    if (email.trim() && !EMAIL_PATTERN.test(email.trim())) {
      setError('Please enter a valid email address.')
      return
    }

    const hasContactDetails = Boolean(name.trim() || email.trim() || phone.trim())
    if (hasContactDetails && !consent) {
      setError('Tick the box so we can contact you, or clear your details.')
      return
    }

    const payload: Record<string, unknown> = {
      rating,
      contactConsent: consent,
      honeypot,
    }
    if (comments.trim()) payload.comments = comments.trim()
    if (name.trim()) payload.customerName = name.trim()
    if (email.trim()) payload.customerEmail = email.trim()
    if (phone.trim()) payload.customerPhone = phone.trim()
    if (src) payload.src = src

    setSubmitting(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        router.push('/feedback/thanks')
        return
      }

      let message = 'Something went wrong, please try again.'
      try {
        const data = await res.json()
        if (data?.error?.message) message = data.error.message
      } catch (parseError) {
        console.error('Failed to parse feedback error response', parseError)
      }
      setError(message)
      setSubmitting(false)
    } catch (submitError) {
      console.error('Failed to submit feedback', submitError)
      setError('Something went wrong, please try again.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-[18px]">
      {/* Warm, empathetic header */}
      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>The Anchor</p>
        <h1 className={GUEST_H1_CLASS}>We&apos;re sorry it wasn&apos;t quite right</h1>
        <p className={GUEST_LEAD_CLASS}>
          Thank you for telling us. We care when something has not gone as it should, and your
          feedback helps us understand what happened and improve.
        </p>
      </div>

      {/* Honeypot, visually hidden, still submitted */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
        style={{ left: '-9999px' }}
      >
        <label htmlFor="company">Company</label>
        <input
          id="company"
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      <GuestCard variant="accent" className="flex flex-col gap-[18px]">
        {/* Star rating */}
        <div className="flex flex-col gap-2">
          <label
            id="rating-label"
            className="font-anchor-body text-[15px] font-semibold text-guest-text"
          >
            How would you rate your visit?
          </label>
          <div aria-labelledby="rating-label">
            <StarRating value={rating} onChange={setRating} />
          </div>
        </div>

        {/* Comments */}
        <div>
          <label htmlFor="comments" className="sr-only">
            Tell us what happened
          </label>
          <textarea
            id="comments"
            name="comments"
            rows={5}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Tell us what happened, what could have been better, or anything you'd like us to understand."
            className={cn(GUEST_INPUT_CLASS, GUEST_TEXTAREA_CLASS, 'min-h-[118px]')}
          />
        </div>

        {/* Optional contact details */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowContact((v) => !v)}
            aria-expanded={showContact}
            aria-controls="contact-details"
            className="self-start text-left font-anchor-body text-[14px] font-semibold text-guest-accent-text underline underline-offset-[3px] hover:no-underline"
          >
            {showContact ? 'Hide contact details' : 'Add your contact details if you\'d like us to follow up'}
          </button>

          {showContact && (
            <div id="contact-details" className="flex flex-col gap-3">
              <GuestField id="customerName" label="Name">
                <input
                  {...guestFieldControlProps({ id: 'customerName' })}
                  name="customerName"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={GUEST_INPUT_CLASS}
                />
              </GuestField>

              <GuestField id="customerEmail" label="Email">
                <input
                  {...guestFieldControlProps({ id: 'customerEmail' })}
                  name="customerEmail"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={GUEST_INPUT_CLASS}
                />
              </GuestField>

              <GuestField id="customerPhone" label="Phone">
                <input
                  {...guestFieldControlProps({ id: 'customerPhone' })}
                  name="customerPhone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={GUEST_INPUT_CLASS}
                />
              </GuestField>

              {/* The tick box is sized globally inside `.guest-theme`; the row
                  class is what keeps the tap target at 44px. */}
              <label
                htmlFor="contactConsent"
                className={cn(GUEST_CHOICE_ROW_CLASS, 'text-[13px] leading-[1.55]')}
              >
                <input
                  id="contactConsent"
                  name="contactConsent"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  Leave your details only if you&apos;re happy for us to contact you about your
                  feedback.
                </span>
              </label>
            </div>
          )}
        </div>
      </GuestCard>

      {error && (
        <GuestAlert tone="problem" role="alert">
          {error}
        </GuestAlert>
      )}

      {/* Post button */}
      <div className="flex justify-end">
        <GuestButton
          as="button"
          type="submit"
          variant="primary"
          size="md"
          disabled={submitting || rating < 1}
          className="w-full gap-2 sm:w-auto"
        >
          {submitting && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {submitting ? 'Sending…' : 'Send feedback'}
        </GuestButton>
      </div>
    </form>
  )
}
