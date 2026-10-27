'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@/ds'

/**
 * "Find booking": opens a table booking from its reference on any date (BK-180), so staff need not
 * load the right day, week or month first while a guest waits on the phone.
 */
export function FindBookingByReference(): React.JSX.Element {
  const router = useRouter()
  const [reference, setReference] = useState('')
  const [searching, setSearching] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function find(event: React.FormEvent) {
    event.preventDefault()
    if (!reference.trim()) return
    setSearching(true)
    setProblem(null)
    try {
      const response = await fetch(`/api/boh/table-bookings/lookup?reference=${encodeURIComponent(reference.trim())}`, {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
      const id = payload?.data?.id
      if (response.ok && typeof id === 'string') {
        router.push(`/table-bookings/${id}`)
        return
      }
      setProblem(typeof payload?.error === 'string' ? payload.error : 'Could not search for that booking. Try again.')
    } catch {
      setProblem('Could not search for that booking. Try again.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <form onSubmit={(event) => void find(event)} className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
      <div className="flex items-end gap-2">
        <Input
          id="boh-find-reference"
          aria-label="Find booking by reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Find by reference, any date (TB-...)"
        />
        <Button type="submit" variant="secondary" size="sm" loading={searching}>
          Find
        </Button>
      </div>
      {problem ? (
        <p className="text-sm text-danger-fg" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  )
}
