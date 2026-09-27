'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { StarRating } from '@/components/features/feedback/StarRating'
// Imported file by file rather than through the `guest` barrel, which would pull
// the guest webfont module into this client bundle. GuestShell stays on the server page.
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestCard } from '@/components/features/guest/GuestCard'
import { GuestChoice } from '@/components/features/guest/GuestChoice'
import { GuestInput, GuestTextarea } from '@/components/features/guest/GuestControls'
import { GuestField, guestFieldControlProps } from '@/components/features/guest/GuestField'
import { GuestIntro } from '@/components/features/guest/GuestIntro'

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
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-guest-lg">
      {/* Warm, empathetic header */}
      <GuestIntro
        kicker="The Anchor"
        title="We're sorry it wasn't quite right"
        lead="Thank you for telling us. We care when something has not gone as it should, and your feedback helps us understand what happened and improve."
      />

      {/* Honeypot, visually hidden, still submitted. It stays a raw label and
          input on purpose: it must look like an ordinary field to a bot. */}
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

      <GuestCard variant="accent">
        <div className="flex flex-col gap-guest-lg">
          {/* Star rating: a group of buttons, named by the question above it. */}
          <div className="flex flex-col gap-2">
            <p id="rating-label" className="font-anchor-body text-guest-lead font-semibold text-guest-text">
              How would you rate your visit?
            </p>
            <StarRating value={rating} onChange={setRating} aria-labelledby="rating-label" />
          </div>

          {/* Comments: the card says what this box is for, so its label is for screen readers. */}
          <GuestField id="comments" label="Tell us what happened" labelHidden>
            <GuestTextarea
              id="comments"
              name="comments"
              rows={5}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Tell us what happened, what could have been better, or anything you'd like us to understand."
            />
          </GuestField>

          {/* Optional contact details */}
          <div className="flex flex-col gap-3">
            <GuestButton
              variant="link"
              onClick={() => setShowContact((v) => !v)}
              aria-expanded={showContact}
              aria-controls="contact-details"
            >
              {showContact ? 'Hide contact details' : 'Add your contact details if you\'d like us to follow up'}
            </GuestButton>

            {showContact && (
              <div id="contact-details" className="flex flex-col gap-3">
                <GuestField id="customerName" label="Name">
                  <GuestInput
                    {...guestFieldControlProps({ id: 'customerName' })}
                    name="customerName"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </GuestField>

                <GuestField id="customerEmail" label="Email">
                  <GuestInput
                    {...guestFieldControlProps({ id: 'customerEmail' })}
                    name="customerEmail"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </GuestField>

                <GuestField id="customerPhone" label="Phone">
                  <GuestInput
                    {...guestFieldControlProps({ id: 'customerPhone' })}
                    name="customerPhone"
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </GuestField>

                <GuestChoice
                  type="checkbox"
                  id="contactConsent"
                  name="contactConsent"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  label="Leave your details only if you're happy for us to contact you about your feedback."
                />
              </div>
            )}
          </div>
        </div>
      </GuestCard>

      {error && (
        <GuestAlert tone="problem" role="alert">
          {error}
        </GuestAlert>
      )}

      {/* Post button: full width on a phone, label width and left-aligned from 640px,
          like the submit of every other guest form. */}
      <GuestButton
        as="button"
        type="submit"
        variant="primary"
        size="md"
        disabled={rating < 1}
        loading={submitting}
        loadingText="Sending…"
        fullWidth="mobile"
      >
        Send feedback
      </GuestButton>
    </form>
  )
}
