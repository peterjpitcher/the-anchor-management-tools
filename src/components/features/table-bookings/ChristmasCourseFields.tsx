'use client'

import { useEffect, useId, useState } from 'react'
import { Alert, Fieldset, Select } from '@/ds'

const COURSE_OPTIONS = [
  { value: '0', label: 'Choose courses' },
  { value: '1', label: '1 course' },
  { value: '2', label: '2 courses' },
  { value: '3', label: '3 courses' },
]

const COURSES_HELP =
  'Guests on one course have nothing to pre-order. Two or three courses need food choices by the pre-order deadline.'

interface ChristmasCourseFieldsProps {
  bookingId: string
  partySize: number
  onChange: (counts: number[] | undefined) => void
  /**
   * `foh` keeps the look these fields had before the design-system pass (a plain heading and one
   * compact "Guest N" row per seat), for the FOH kiosk's party-size dialog, which the owner keeps
   * exactly as it is. Every other caller leaves this at `default`, the DS look.
   */
  appearance?: 'default' | 'foh'
}

/** Existing bookings without a snapshot retain their original policy and show no controls. */
export function ChristmasCourseFields({ bookingId, partySize, onChange, appearance = 'default' }: ChristmasCourseFieldsProps) {
  const [counts, setCounts] = useState<number[] | null>(null)
  const [failed, setFailed] = useState(false)
  const idBase = useId()
  useEffect(() => {
    const controller = new AbortController()
    setCounts(null)
    setFailed(false)
    onChange(undefined)
    void fetch(`/api/foh/bookings/${bookingId}/christmas-courses`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Could not load courses')
        const data = await response.json()
        if (!controller.signal.aborted) setCounts(data.course_counts)
      }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [bookingId, onChange])
  useEffect(() => {
    if (!counts) return
    const next = Array.from({ length: Math.min(20, Math.max(0, partySize || 0)) }, (_, index) => counts[index] ?? 0)
    onChange(next)
  }, [counts, partySize, onChange])

  const isFoh = appearance === 'foh'

  if (failed) {
    return isFoh ? (
      <p role="alert" className="text-sm text-danger">
        Course choices could not be loaded. Refresh before changing a Christmas booking.
      </p>
    ) : (
      <Alert tone="danger">
        Course choices could not be loaded. Refresh before changing a Christmas booking.
      </Alert>
    )
  }
  if (!counts) return null
  const next = Array.from({ length: Math.min(20, Math.max(0, partySize || 0)) }, (_, index) => counts[index] ?? 0)
  const setSeat = (index: number, value: string) =>
    setCounts(next.map((current, seat) => (seat === index ? Number(value) : current)))

  if (isFoh) {
    // The pre-branch FOH markup, rebuilt from DS parts: the old raw <label> and <select> are not
    // allowed in staff code any more (tests/guards/page-contract.test.ts). Each row keeps the
    // "Guest N" text beside a compact select, and the text names the select.
    return (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Christmas courses for each guest</legend>
        <p className="text-sm">{COURSES_HELP}</p>
        {next.map((count, index) => {
          const labelId = `${idBase}-guest-${index}`
          return (
            <div key={index} className="flex items-center gap-3 text-sm">
              <span id={labelId}>Guest {index + 1}</span>
              <Select
                aria-labelledby={labelId}
                value={String(count)}
                options={COURSE_OPTIONS}
                className="h-auto w-auto min-h-touch rounded-sm border-border-strong"
                onChange={(event) => setSeat(index, event.target.value)}
              />
            </div>
          )
        })}
      </fieldset>
    )
  }

  return (
    <Fieldset legend="Christmas courses for each guest">
      <div className="space-y-3">
        <p className="text-sm text-text">{COURSES_HELP}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {next.map((count, index) => (
            <Select
              key={index}
              label={`Guest ${index + 1}`}
              value={String(count)}
              options={COURSE_OPTIONS}
              onChange={(event) => setSeat(index, event.target.value)}
            />
          ))}
        </div>
      </div>
    </Fieldset>
  )
}
