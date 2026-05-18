'use client'

import { useState } from 'react'
import { Button, Field, Input, Textarea } from '@/ds'

type BookingStep = 'details' | 'time' | 'confirm'

const STEPS: { key: BookingStep; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'time', label: 'Time' },
  { key: 'confirm', label: 'Confirm' },
]

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, '10+']

export default function PublicBookingClient() {
  const [currentStep, setCurrentStep] = useState<BookingStep>('details')
  const [partySize, setPartySize] = useState<number | string | null>(null)
  const [notes, setNotes] = useState('')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep)

  // Generate sample dates (next 7 days)
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return {
      iso: d.toISOString().split('T')[0],
      day: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      num: d.getDate(),
    }
  })

  // Sample time slots
  const slots = ['12:00', '12:30', '13:00', '13:30', '14:00', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']

  return (
    <div className="public">
      <div className="public__hero">
        <div className="public__hero-bg" />
        <div className="public__hero-inner">
          <div className="public__brand-mini">The Anchor</div>
          <h1 className="public__hero-title">Book a Table</h1>
          <p className="public__hero-sub">Reserve your table at The Anchor, Staines-upon-Thames</p>
        </div>
      </div>

      <div className="public__main">
        {/* Step indicators */}
        <div className="public__steps">
          {STEPS.map((step, i) => (
            <span key={step.key}>
              {i > 0 && <span className="public__step-sep" />}
              <span className={`public__step ${i === currentStepIndex ? 'active' : ''} ${i < currentStepIndex ? 'done' : ''}`}>
                {step.label}
              </span>
            </span>
          ))}
        </div>

        {/* Step 1: Details */}
        {currentStep === 'details' && (
          <div>
            <h2 className="public__h2">How many guests?</h2>
            <div className="public__party">
              {PARTY_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`public__chip ${partySize === size ? 'active' : ''}`}
                  onClick={() => setPartySize(size)}
                >
                  {size}
                </button>
              ))}
            </div>

            <div className="mt-6">
              <Field label="Special requests or notes">
                <Textarea
                  placeholder="Any dietary requirements, occasion, or special requests..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </Field>
            </div>

            <div className="public__summary">
              <span className="text-sm text-text-muted">
                {partySize ? `${partySize} ${partySize === 1 ? 'guest' : 'guests'}` : 'Select party size'}
              </span>
              <Button
                variant="primary"
                disabled={!partySize}
                onClick={() => setCurrentStep('time')}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Time */}
        {currentStep === 'time' && (
          <div>
            <h2 className="public__h2">Choose a date</h2>
            <div className="public__dates">
              {dates.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  className={`public__date ${selectedDate === d.iso ? 'active' : ''}`}
                  onClick={() => setSelectedDate(d.iso)}
                >
                  <div className="public__date-day">{d.day}</div>
                  <div className="public__date-num">{d.num}</div>
                </button>
              ))}
            </div>

            {selectedDate && (
              <>
                <h2 className="public__h2 mt-6">Select a time</h2>
                <div className="public__slots">
                  {slots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={`public__slot ${selectedSlot === slot ? 'active' : ''}`}
                      onClick={() => setSelectedSlot(slot)}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="public__summary">
              <span className="text-sm text-text-muted">
                {selectedDate && selectedSlot ? `${selectedDate} at ${selectedSlot}` : 'Select date and time'}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setCurrentStep('details')}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  disabled={!selectedDate || !selectedSlot}
                  onClick={() => setCurrentStep('confirm')}
                >
                  Continue
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {currentStep === 'confirm' && (
          <div>
            <h2 className="public__h2">Confirm your booking</h2>

            <div className="public__card mb-4">
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-text-muted">Party size</span>
                  <span className="font-medium">{partySize} {partySize === 1 ? 'guest' : 'guests'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Date</span>
                  <span className="font-medium">{selectedDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Time</span>
                  <span className="font-medium">{selectedSlot}</span>
                </div>
                {notes && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Notes</span>
                    <span className="font-medium text-right max-w-[200px]">{notes}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <Field label="Full name" required>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                />
              </Field>
              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  required
                />
              </Field>
              <Field label="Phone number" required>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07700 900000"
                  required
                />
              </Field>
            </div>

            <div className="public__summary">
              <Button variant="secondary" onClick={() => setCurrentStep('time')}>
                Back
              </Button>
              <Button
                variant="primary"
                disabled={!name || !email || !phone}
              >
                Confirm Booking
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="public__footer">
        <span>&copy; {new Date().getFullYear()} The Anchor, Staines-upon-Thames</span>
        <div>
          <a href="/privacy" className="public__link">Privacy Policy</a>
        </div>
      </div>
    </div>
  )
}
