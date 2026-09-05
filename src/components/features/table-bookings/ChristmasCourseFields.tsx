'use client'

import { useEffect, useState } from 'react'

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
  if (failed) return <p role="alert">Course choices could not be loaded. Refresh before changing a Christmas booking.</p>
  if (!counts) return null
  const next = Array.from({ length: Math.min(20, Math.max(0, partySize || 0)) }, (_, index) => counts[index] ?? 0)
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">Christmas courses for each guest</legend>
    <p className="text-sm">One course needs no pre-order. Two or three courses need food choices by the pre-order deadline.</p>
    {next.map((count, index) => <label key={index} className="flex items-center gap-3 text-sm">
      Guest {index + 1}
      <select value={count} className="rounded-md border border-gray-300 p-2"
        onChange={event => setCounts(next.map((value, seat) => seat === index ? Number(event.target.value) : value))}>
        <option value={0}>Choose courses</option><option value={1}>1 course</option><option value={2}>2 courses</option><option value={3}>3 courses</option>
      </select>
    </label>)}
  </fieldset>
}
