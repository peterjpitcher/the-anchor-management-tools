'use client'

import { useEffect, useState } from 'react'
import { Alert, Select } from '@/ds'

const COURSE_OPTIONS = [
  { value: '0', label: 'Choose courses' },
  { value: '1', label: '1 course' },
  { value: '2', label: '2 courses' },
  { value: '3', label: '3 courses' },
]

interface ChristmasCourseFieldsProps {
  bookingId: string
  partySize: number
  onChange: (counts: number[] | undefined) => void
}

/** Existing bookings without a snapshot retain their original policy and show no controls. */
export function ChristmasCourseFields({ bookingId, partySize, onChange }: ChristmasCourseFieldsProps) {
  const [counts, setCounts] = useState<number[] | null>(null)
  const [failed, setFailed] = useState(false)
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
  if (failed) {
    return (
      <Alert tone="danger">
        Course choices could not be loaded. Refresh before changing a Christmas booking.
      </Alert>
    )
  }
  if (!counts) return null
  const next = Array.from({ length: Math.min(20, Math.max(0, partySize || 0)) }, (_, index) => counts[index] ?? 0)
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-text-muted">
        Christmas courses for each guest
      </legend>
      <p className="text-sm text-text">
        Guests on one course have nothing to pre-order. Two or three courses need food choices by the pre-order deadline.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {next.map((count, index) => (
          <Select
            key={index}
            label={`Guest ${index + 1}`}
            value={String(count)}
            options={COURSE_OPTIONS}
            onChange={(event) => setCounts(next.map((value, seat) => (seat === index ? Number(event.target.value) : value)))}
          />
        ))}
      </div>
    </fieldset>
  )
}
