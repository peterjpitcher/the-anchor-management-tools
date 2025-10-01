'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { formatDate } from '@/lib/dateUtils'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { CheckCircleIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import { lookupEventGuest, registerKnownGuest, registerNewGuest } from '@/app/actions/event-check-in'

interface EventRecord {
  id: string
  name: string
  date: string
  time: string
  category?: {
    name: string
    color: string
  } | null
}

interface EventCheckInClientProps {
  event: EventRecord
  reviewLink: string
}

type FlowStep = 'lookup' | 'known' | 'unknown' | 'already' | 'success'

type KnownGuest = {
  customer: {
    id: string
    first_name: string
    last_name: string | null
    mobile_number: string
    email?: string | null
  }
  booking?: {
    id: string
    seats: number | null
  }
  alreadyCheckedIn: boolean
}

export default function EventCheckInClient({ event, reviewLink }: EventCheckInClientProps) {
  const [step, setStep] = useState<FlowStep>('lookup')
  const [phoneInput, setPhoneInput] = useState('')
  const [normalizedPhone, setNormalizedPhone] = useState<string | null>(null)
  const [knownGuest, setKnownGuest] = useState<KnownGuest | null>(null)
  const [newGuestDetails, setNewGuestDetails] = useState({ firstName: '', lastName: '', email: '' })
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const phoneInputRef = useRef<HTMLInputElement>(null)

  const eventDate = useMemo(() => {
    try {
      return formatDate(new Date(event.date))
    } catch {
      return event.date
    }
  }, [event.date])

  useEffect(() => {
    if (step === 'lookup' && phoneInputRef.current) {
      phoneInputRef.current.focus()
    }
  }, [step])

  const resetFlow = () => {
    setStep('lookup')
    setNormalizedPhone(null)
    setKnownGuest(null)
    setStatusMessage(null)
    setError(null)
    setNewGuestDetails({ firstName: '', lastName: '', email: '' })
    setPhoneInput('')
  }

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setStatusMessage(null)

    startTransition(async () => {
      const result = await lookupEventGuest({ eventId: event.id, phone: phoneInput })

      if (!result.success) {
        setError(result.error)
        return
      }

      setNormalizedPhone(result.normalizedPhone)

      if (result.status === 'unknown') {
        setStep('unknown')
        return
      }

      setKnownGuest(result.data)

      if (result.data.alreadyCheckedIn) {
        const displayName = `${result.data.customer.first_name} ${result.data.customer.last_name ?? ''}`.trim() || 'there'
        setStep('already')
        setStatusMessage(`Hello ${displayName}! You're already checked in for ${event.name}. Enjoy the evening!`)
        return
      }

      setStep('known')
    })
  }

  const handleKnownCheckIn = () => {
    if (!knownGuest || !normalizedPhone) return
    setError(null)
    setStatusMessage(null)

    startTransition(async () => {
      const result = await registerKnownGuest({
        eventId: event.id,
        phone: normalizedPhone,
        customerId: knownGuest.customer.id,
      })

      if (!result.success) {
        setError(result.error)
        return
      }

      const displayName =
        result.data.customerName || `${knownGuest.customer.first_name} ${knownGuest.customer.last_name ?? ''}`.trim() || 'there'

      setStatusMessage(`Hello ${displayName}! Welcome to ${event.name}. Thank you for checking in.`)
      setStep('success')
    })
  }

  const handleNewCheckIn = (e: React.FormEvent) => {
    e.preventDefault()
    if (!normalizedPhone) return
    setError(null)
    setStatusMessage(null)

    startTransition(async () => {
      const result = await registerNewGuest({
        eventId: event.id,
        phone: normalizedPhone,
        firstName: newGuestDetails.firstName,
        lastName: newGuestDetails.lastName,
        email: newGuestDetails.email || undefined,
      })

      if (!result.success) {
        setError(result.error)
        return
      }

      const displayName = result.data.customerName || newGuestDetails.firstName || 'there'
      setStatusMessage(`Hello ${displayName}! Welcome to ${event.name}. Thank you for checking in.`)
      setStep('success')
    })
  }

  const renderLookupForm = () => (
    <form onSubmit={handleLookup} className="space-y-4">
      <div className="space-y-3">
        <label htmlFor="phone" className="block text-lg font-semibold text-gray-900">
          Welcome! Pop your mobile number in to check in for tonight’s event
        </label>
        <Input
          id="phone"
          ref={phoneInputRef}
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          placeholder="e.g. 07700 900123"
          inputMode="tel"
          autoComplete="tel"
          required
          className="text-lg"
        />
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Button type="submit" variant="primary" disabled={isPending} className="sm:w-auto text-base px-6 py-3">
          {isPending ? 'Checking…' : 'Check In'}
        </Button>
      </div>
    </form>
  )

  const renderKnownGuest = () => {
    if (!knownGuest) return null

    const fullName = `${knownGuest.customer.first_name} ${knownGuest.customer.last_name ?? ''}`.trim()
    const greetingName = fullName || 'there'

    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-5 text-gray-900">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">Great news</p>
          <p className="text-2xl font-semibold mt-2">Hello {greetingName}!</p>
          <p className="text-base mt-3">
            {knownGuest.booking
              ? `We have you down for ${knownGuest.booking.seats ?? 1} seat${(knownGuest.booking.seats ?? 1) > 1 ? 's' : ''}. Tap below and we’ll mark you as arrived.`
              : 'We could not see a booking, so we will pop you on the list now and mark you as arrived.'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Button
            type="button"
            variant="primary"
            onClick={handleKnownCheckIn}
            disabled={isPending}
            className="sm:w-auto text-base px-6 py-3"
          >
            {isPending ? 'Checking in…' : `Yes, check me in`}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setStep('lookup')}
            className="sm:w-auto text-base px-6 py-3"
          >
            <ArrowLeftIcon className="h-5 w-5 mr-2" />
            Search again
          </Button>
        </div>
      </div>
    )
  }

  const renderUnknownGuest = () => (
    <form onSubmit={handleNewCheckIn} className="space-y-5">
      <div className="rounded-2xl bg-gray-50 border border-gray-200 p-5 text-gray-900">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">Let’s get you on the list</p>
        <p className="text-base mt-3">
          We could not find a match for {normalizedPhone}. Add your name so we can welcome you properly this evening.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="first-name" className="block text-lg font-semibold text-gray-900">
            First name
          </label>
          <Input
            id="first-name"
            value={newGuestDetails.firstName}
            onChange={(e) => setNewGuestDetails((prev) => ({ ...prev, firstName: e.target.value }))}
            required
            className="text-lg"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="last-name" className="block text-lg font-semibold text-gray-900">
            Last name
          </label>
          <Input
            id="last-name"
            value={newGuestDetails.lastName}
            onChange={(e) => setNewGuestDetails((prev) => ({ ...prev, lastName: e.target.value }))}
            required
            className="text-lg"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <label htmlFor="email" className="block text-lg font-semibold text-gray-900">
            Email (optional)
          </label>
          <Input
            id="email"
            type="email"
            value={newGuestDetails.email}
            onChange={(e) => setNewGuestDetails((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="name@example.com"
            className="text-lg"
          />
          <p className="text-sm text-gray-500">
            Email is optional but helps us share highlights or offers if you fancy.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button type="submit" variant="primary" disabled={isPending} className="sm:w-auto text-base px-6 py-3">
          {isPending ? 'Checking in…' : 'All set – check me in'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setStep('lookup')} className="sm:w-auto text-base px-6 py-3">
          <ArrowLeftIcon className="h-5 w-5 mr-2" />
          Search again
        </Button>
      </div>
    </form>
  )

  const renderAlreadyCheckedIn = () => (
    <div className="space-y-5">
      {statusMessage && (
        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-5 text-gray-900">
          <p className="text-base font-semibold">{statusMessage}</p>
          <p className="text-sm mt-2 text-gray-600">
            If you pop back later just say hello again and we’ll double-check for you.
          </p>
        </div>
      )}
      <Button type="button" variant="primary" onClick={resetFlow} className="sm:w-auto text-base px-6 py-3">
        Next guest
      </Button>
    </div>
  )

  const renderSuccess = () => (
    <div className="space-y-5 text-center text-gray-900">
      <div className="flex flex-col items-center space-y-3">
        <CheckCircleIcon className="h-12 w-12 text-emerald-500" aria-hidden />
        <p className="text-2xl font-semibold">You’re all checked in!</p>
        {statusMessage && <p className="text-base text-gray-700">{statusMessage}</p>}
        <p className="text-sm text-gray-500 max-w-sm">
          We’ll send a friendly thank-you text tomorrow with a quick link to share a review: {reviewLink}
        </p>
      </div>
      <Button type="button" variant="primary" onClick={resetFlow} className="sm:w-auto text-base px-6 py-3">
        Check in next guest
      </Button>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] bg-white/95 shadow-2xl px-6 py-6 sm:px-8 sm:py-8 text-gray-900">
        <header className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">Now checking in</p>
            <h2 className="text-3xl sm:text-4xl font-semibold text-gray-900 mt-2">{event.name}</h2>
            <p className="text-sm text-gray-600 mt-1">
              {eventDate} · {event.time}
            </p>
          </div>
        </header>

        <div className="mt-4 space-y-5">
          {error && <Alert variant="error" title="Unable to continue" description={error} />}

          {step === 'lookup' && renderLookupForm()}
          {step === 'known' && renderKnownGuest()}
          {step === 'unknown' && renderUnknownGuest()}
          {step === 'already' && renderAlreadyCheckedIn()}
          {step === 'success' && renderSuccess()}
        </div>
      </div>

      <p className="text-center text-sm text-emerald-100/80">
      </p>
    </div>
  )
}
