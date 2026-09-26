'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Alert, Button, Card, CardBody, CardHeader, Input, SubHeading } from '@/ds'
import { KioskShell } from '@/components/shells/KioskShell'
import { cn } from '@/lib/utils'
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

const STEP_TITLE: Record<FlowStep, string> = {
  lookup: 'Enter Mobile Number',
  known: 'Confirm Your Check-In',
  unknown: 'Add Your Details',
  already: 'Checked In',
  success: 'Checked In',
}

/**
 * The message panels on the check-in card. A greeting or an attendance count is the soft primary
 * highlight; being eligible for the Cash Bingo snowball is the one thing staff must notice, so it
 * is the warning tone.
 */
const CHECK_IN_PANEL_CLASSES = {
  greeting: 'rounded-default bg-primary-soft text-center text-primary-soft-fg',
  snowball: 'rounded-default border border-warning-border bg-warning-soft text-center text-warning-fg',
} as const

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
        <div className={cn(CHECK_IN_PANEL_CLASSES.greeting, 'p-4')}>
          <p className="text-lg font-semibold text-text-strong">Hello {name}</p>
          <p className="mt-2 text-sm">
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
      {/* min-h-touch: 44px fields on an iPad in landscape too (owner decision D6). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="First name"
          value={newGuestDetails.firstName}
          onChange={(e) => setNewGuestDetails((current) => ({ ...current, firstName: e.target.value }))}
          autoComplete="given-name"
          required
          className="min-h-touch"
        />
        <Input
          label="Last name (optional)"
          value={newGuestDetails.lastName}
          onChange={(e) => setNewGuestDetails((current) => ({ ...current, lastName: e.target.value }))}
          autoComplete="family-name"
          className="min-h-touch"
        />
      </div>
      <Input
        label="Email"
        type="email"
        value={newGuestDetails.email}
        onChange={(e) => setNewGuestDetails((current) => ({ ...current, email: e.target.value }))}
        autoComplete="email"
        placeholder="Optional"
        className="min-h-touch"
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
        <div className={cn(CHECK_IN_PANEL_CLASSES.snowball, 'p-5')}>
          <p className="text-sm font-semibold uppercase tracking-[0.16em]">Snowball eligible</p>
          {/* A real heading (h4 under the card's title), as it was before the redesign, drawn at
              the panel's display size and in the panel's colour so the news still stands out. */}
          <SubHeading className="mt-2 text-2xl font-bold text-inherit">Congratulations</SubHeading>
          <p className="mt-3 text-sm leading-6">
            You have been to the last 3 Cash Bingo events, so you are eligible for tonight&apos;s snowball.
          </p>
          <p className="mt-4 rounded-default bg-surface px-4 py-3 text-base font-semibold">
            Please hand this phone back to the team. We&apos;ve marked you as snowball eligible.
          </p>
        </div>
      )
    }

    if (attendanceSummary.isCashBingo && attendanceSummary.snowball) {
      return (
        <div className={cn(CHECK_IN_PANEL_CLASSES.greeting, 'p-5')}>
          <p className="text-lg font-semibold text-text-strong">
            You&apos;ve attended {previousCount} previous Cash Bingo {previousLabel}.
          </p>
          <p className="mt-3 text-sm leading-6">
            To be snowball eligible, you need to have been to the last 3 Cash Bingo events.
            Keep coming along and we&apos;ll track it for you.
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em]">
            Last 3 attended: {attendanceSummary.snowball.checkedLastThreeCount} of 3
          </p>
        </div>
      )
    }

    return (
      <div className={cn(CHECK_IN_PANEL_CLASSES.greeting, 'p-4')}>
        <p className="text-sm font-semibold text-text-strong">
          You&apos;ve attended {previousCount} previous {categoryName} {previousLabel}.
        </p>
      </div>
    )
  }

  const renderCompletion = () => (
    <div className="space-y-4">
      {message && (
        <div className={cn(CHECK_IN_PANEL_CLASSES.greeting, 'p-4')}>
          <p className="text-lg font-semibold text-text-strong">{message}</p>
        </div>
      )}
      {renderAttendanceMessage()}
      <Button type="button" variant="primary" size="lg" fullWidth className="h-14 text-base" onClick={resetFlow}>
        Check In Another Guest
      </Button>
    </div>
  )

  return (
    <KioskShell
      title={event.name}
      eyebrow={`${eventDate} · ${formatTime12Hour(event.time)}`}
      width="narrow"
    >
      <Card>
        <CardHeader title={STEP_TITLE[step]} />
        <CardBody className="space-y-4">
          {step === 'lookup' && (
            <p className="text-sm text-text-muted">Please enter your mobile number to sign in for this event.</p>
          )}
          {error && <Alert tone="danger" title="Check-in failed">{error}</Alert>}
          {!isCompleteStep && message && <Alert tone="success" title="Done">{message}</Alert>}

          {step === 'lookup' && renderLookup()}
          {step === 'known' && renderKnown()}
          {step === 'unknown' && renderUnknown()}
          {isCompleteStep && renderCompletion()}
        </CardBody>
      </Card>
    </KioskShell>
  )
}
