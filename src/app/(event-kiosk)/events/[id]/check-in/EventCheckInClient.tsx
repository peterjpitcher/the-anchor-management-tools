'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { Alert, Button, Input } from '@/ds'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'
import {
  lookupEventGuest,
  registerKnownGuest,
  registerNewGuest,
  type EventCategoryAttendanceSummary,
  type KnownEventGuest,
} from '@/app/actions/event-check-in'

type EventRecord = {
  id: string
  name: string
  date: string
  time: string
  category?: {
    name: string
    color: string | null
  } | null
}

type FlowStep = 'lookup' | 'known' | 'unknown' | 'already' | 'success'

export default function EventCheckInClient({ event }: { event: EventRecord }) {
  const [step, setStep] = useState<FlowStep>('lookup')
  const [phoneInput, setPhoneInput] = useState('')
  const [normalizedPhone, setNormalizedPhone] = useState<string | null>(null)
  const [knownGuest, setKnownGuest] = useState<KnownEventGuest | null>(null)
  const [newGuestDetails, setNewGuestDetails] = useState({ firstName: '', lastName: '', email: '' })
  const [message, setMessage] = useState<string | null>(null)
  const [attendanceSummary, setAttendanceSummary] = useState<EventCategoryAttendanceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const phoneInputRef = useRef<HTMLInputElement>(null)
  const isCompleteStep = step === 'already' || step === 'success'

  const eventDate = useMemo(() => {
    return formatDateInLondon(event.date, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }, [event.date])

  useEffect(() => {
    if (step === 'lookup') {
      phoneInputRef.current?.focus()
    }
  }, [step])

  const resetFlow = () => {
    setStep('lookup')
    setPhoneInput('')
    setNormalizedPhone(null)
    setKnownGuest(null)
    setNewGuestDetails({ firstName: '', lastName: '', email: '' })
    setMessage(null)
    setAttendanceSummary(null)
    setError(null)
  }

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)

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
      setAttendanceSummary(result.data.attendance ?? null)

      if (result.data.alreadyCheckedIn) {
        const name = [result.data.customer.first_name, result.data.customer.last_name].filter(Boolean).join(' ') || 'there'
        setMessage(`Hello ${name}. You are already checked in for ${event.name}.`)
        setStep('already')
        return
      }

      setAttendanceSummary(null)
      setStep('known')
    })
  }

  const handleKnownCheckIn = () => {
    if (!knownGuest || !normalizedPhone) return
    setError(null)
    setMessage(null)

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

      setAttendanceSummary(result.data.attendance)
      setMessage(`Hello ${result.data.customerName || 'there'}. You are checked in for ${event.name}.`)
      setStep('success')
    })
  }

  const handleNewCheckIn = (e: React.FormEvent) => {
    e.preventDefault()
    if (!normalizedPhone) return
    setError(null)
    setMessage(null)

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

      setAttendanceSummary(result.data.attendance)
      setMessage(`Hello ${result.data.customerName || newGuestDetails.firstName || 'there'}. You are checked in for ${event.name}.`)
      setStep('success')
    })
  }

  const renderLookup = () => (
    <form onSubmit={handleLookup} className="space-y-5">
      <Input
        ref={phoneInputRef}
        label="Guest mobile number"
        value={phoneInput}
        onChange={(e) => setPhoneInput(e.target.value)}
        placeholder="07700 900123"
        inputMode="tel"
        autoComplete="tel"
        required
        className="h-14 text-center text-xl font-semibold tracking-wide"
      />
      <Button type="submit" variant="primary" size="lg" loading={isPending} fullWidth className="h-14 text-base">
        Check In
      </Button>
    </form>
  )

  const renderKnown = () => {
    if (!knownGuest) return null
    const name = [knownGuest.customer.first_name, knownGuest.customer.last_name].filter(Boolean).join(' ') || 'there'
    const seats = knownGuest.booking?.seats ?? 1

    return (
      <div className="space-y-5">
        <div className="rounded-[8px] border border-brand-200 bg-brand-50 p-4 text-center">
          <p className="text-lg font-semibold text-brand-900">Hello {name}</p>
          <p className="mt-2 text-sm text-brand-800">
            {knownGuest.booking
              ? `We have you down for ${seats} ticket${seats === 1 ? '' : 's'}.`
              : 'We could not see an active booking, so we will add one now.'}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Button type="button" variant="primary" size="lg" loading={isPending} fullWidth className="h-14 text-base" onClick={handleKnownCheckIn}>
            Yes, Check Me In
          </Button>
          <Button type="button" variant="secondary" size="lg" fullWidth className="h-12" onClick={() => setStep('lookup')}>
            Search Again
          </Button>
        </div>
      </div>
    )
  }

  const renderUnknown = () => (
    <form onSubmit={handleNewCheckIn} className="space-y-4">
      <Alert tone="info" title="Guest not found">
        Add their name to check in {normalizedPhone}.
      </Alert>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="First name"
          value={newGuestDetails.firstName}
          onChange={(e) => setNewGuestDetails((current) => ({ ...current, firstName: e.target.value }))}
          autoComplete="given-name"
          required
        />
        <Input
          label="Last name"
          value={newGuestDetails.lastName}
          onChange={(e) => setNewGuestDetails((current) => ({ ...current, lastName: e.target.value }))}
          autoComplete="family-name"
          required
        />
      </div>
      <Input
        label="Email"
        type="email"
        value={newGuestDetails.email}
        onChange={(e) => setNewGuestDetails((current) => ({ ...current, email: e.target.value }))}
        autoComplete="email"
        placeholder="Optional"
      />
      <div className="flex flex-col gap-3">
        <Button type="submit" variant="primary" size="lg" loading={isPending} fullWidth className="h-14 text-base">
          Add And Check In
        </Button>
        <Button type="button" variant="secondary" size="lg" fullWidth className="h-12" onClick={() => setStep('lookup')}>
          Search Again
        </Button>
      </div>
    </form>
  )

  const renderAttendanceMessage = () => {
    if (!attendanceSummary) {
      return null
    }

    const categoryName = attendanceSummary.categoryName || 'this category'
    const previousCount = attendanceSummary.previousAttendanceCount
    const previousLabel = previousCount === 1 ? 'event' : 'events'

    if (attendanceSummary.snowball?.eligible) {
      return (
        <div className="rounded-[8px] border border-amber-300 bg-amber-50 p-5 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-700">Snowball eligible</p>
          <h3 className="mt-2 text-2xl font-bold text-amber-950">Congratulations</h3>
          <p className="mt-3 text-sm leading-6 text-amber-900">
            You have been to the last 3 Cash Bingo events, so you are eligible for tonight&apos;s snowball.
          </p>
          <p className="mt-4 rounded-[8px] bg-white px-4 py-3 text-base font-semibold text-amber-950">
            Please hand this phone back to the team. We&apos;ve marked you as snowball eligible.
          </p>
        </div>
      )
    }

    if (attendanceSummary.isCashBingo && attendanceSummary.snowball) {
      return (
        <div className="rounded-[8px] border border-brand-200 bg-brand-50 p-5 text-center">
          <p className="text-lg font-semibold text-brand-900">
            You&apos;ve attended {previousCount} previous Cash Bingo {previousLabel}.
          </p>
          <p className="mt-3 text-sm leading-6 text-brand-800">
            To be snowball eligible, you need to have been to the last 3 Cash Bingo events.
            Keep coming along and we&apos;ll track it for you.
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">
            Last 3 attended: {attendanceSummary.snowball.checkedLastThreeCount} of 3
          </p>
        </div>
      )
    }

    return (
      <div className="rounded-[8px] border border-brand-200 bg-brand-50 p-4 text-center">
        <p className="text-sm font-semibold text-brand-900">
          You&apos;ve attended {previousCount} previous {categoryName} {previousLabel}.
        </p>
      </div>
    )
  }

  const renderCompletion = () => (
    <div className="space-y-4">
      {message && (
        <div className="rounded-[8px] border border-brand-200 bg-brand-50 p-4 text-center">
          <p className="text-lg font-semibold text-brand-900">{message}</p>
        </div>
      )}
      {renderAttendanceMessage()}
      <Button type="button" variant="primary" size="lg" fullWidth className="h-14 text-base" onClick={resetFlow}>
        Check In Another Guest
      </Button>
    </div>
  )

  return (
    <main className="min-h-screen bg-brand-700 px-4 py-6 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-xl flex-col justify-center">
        <header className="mb-6 text-center">
          <div className="mx-auto mb-5 w-40 sm:w-52">
            <Image
              src="/logo.png"
              alt="The Anchor"
              width={256}
              height={256}
              priority
              className="h-auto w-full"
            />
          </div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-100">
            {eventDate} · {formatTime12Hour(event.time)}
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight text-white sm:text-4xl">{event.name}</h1>
        </header>

        <section className="rounded-[8px] bg-white p-5 text-text-strong shadow-lg sm:p-6">
          <div className="mb-5 text-center">
            <h2 className="text-xl font-semibold">
              {step === 'lookup'
                ? 'Enter Mobile Number'
                : step === 'known'
                  ? 'Confirm Your Check-In'
                  : step === 'unknown'
                    ? 'Add Your Details'
                    : 'Checked In'}
            </h2>
            {step === 'lookup' && (
              <p className="mt-2 text-sm text-text-muted">Please enter your mobile number to sign in for this event.</p>
            )}
          </div>

          <div className="space-y-4">
            {error && <Alert tone="danger" title="Check-in failed">{error}</Alert>}
            {!isCompleteStep && message && <Alert tone="success" title="Done">{message}</Alert>}

            {step === 'lookup' && renderLookup()}
            {step === 'known' && renderKnown()}
            {step === 'unknown' && renderUnknown()}
            {isCompleteStep && renderCompletion()}
          </div>
        </section>
      </div>
    </main>
  )
}
