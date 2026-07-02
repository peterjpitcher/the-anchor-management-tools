'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { StarRating } from '@/components/features/feedback/StarRating'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function TellUsClient() {
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

    const payload: Record<string, unknown> = {
      rating,
      contactConsent: consent,
      honeypot,
    }
    if (comments.trim()) payload.comments = comments.trim()
    if (name.trim()) payload.customerName = name.trim()
    if (email.trim()) payload.customerEmail = email.trim()
    if (phone.trim()) payload.customerPhone = phone.trim()

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
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:py-12">
      <form
        onSubmit={handleSubmit}
        className="mx-auto w-full max-w-[600px] rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
      >
        {/* Identity row — neutral, no Google marks */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-200 text-lg font-semibold text-gray-600"
            aria-hidden="true"
          >
            A
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-gray-900">The Anchor</p>
            <p className="text-[13px] text-gray-500">Rate your visit</p>
          </div>
        </div>

        {/* Honeypot — visually hidden, still submitted */}
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

        {/* Star rating */}
        <div className="mt-5">
          <span id="rating-label" className="sr-only">
            Choose a star rating
          </span>
          <div aria-labelledby="rating-label">
            <StarRating value={rating} onChange={setRating} />
          </div>
        </div>

        {/* Comments */}
        <div className="mt-4">
          <label htmlFor="comments" className="sr-only">
            Share details of your own experience at this place
          </label>
          <textarea
            id="comments"
            name="comments"
            rows={5}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Share details of your own experience at this place"
            className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-[15px] text-gray-900 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {/* Optional contact details */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowContact((v) => !v)}
            aria-expanded={showContact}
            aria-controls="contact-details"
            className="text-[14px] font-medium text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
          >
            {showContact ? 'Hide contact details' : 'Add your contact details (optional)'}
          </button>

          {showContact && (
            <div id="contact-details" className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col">
                <label htmlFor="customerName" className="mb-1 text-[13px] font-medium text-gray-700">
                  Name
                </label>
                <input
                  id="customerName"
                  name="customerName"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div className="flex flex-col">
                <label htmlFor="customerEmail" className="mb-1 text-[13px] font-medium text-gray-700">
                  Email
                </label>
                <input
                  id="customerEmail"
                  name="customerEmail"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div className="flex flex-col">
                <label htmlFor="customerPhone" className="mb-1 text-[13px] font-medium text-gray-700">
                  Phone
                </label>
                <input
                  id="customerPhone"
                  name="customerPhone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="contactConsent"
                  name="contactConsent"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500/40"
                />
                <label htmlFor="contactConsent" className="text-[13px] text-gray-700">
                  Leave your details only if you&apos;re happy for us to contact you about your feedback.
                </label>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-4 text-[13px] text-red-600" role="alert">
            {error}
          </p>
        )}

        {/* Post button */}
        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={submitting || rating < 1}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-blue-600 px-6 py-2 text-[15px] font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && (
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </main>
  )
}
