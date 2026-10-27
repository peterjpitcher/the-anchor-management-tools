'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, FormFooter, Input, Select, SubHeading } from '@/ds'
import { updateEventAttendees } from '@/app/actions/event-attendees'
import type { BookingQuestion, StoredEventAttendee } from '@/lib/events/booking-questions'
import { guestDetailsForEditing } from '@/lib/events/guest-details-edit'

interface EventAttendeesEditorProps {
  bookingId: string
  seats: number
  attendees: StoredEventAttendee[]
  /** The event's current questions: a booking made before one was added is asked it here. */
  questions: BookingQuestion[]
  canEdit: boolean
  /** Opens straight into editing, for adding details to a booking that has none. */
  startInEdit?: boolean
  /** Names staff typed before guest details existed, used to start a booking that has none. */
  prefillNames?: string[] | null
  onSaved?: () => void
  onCancel?: () => void
}

/**
 * Each ticket's name and answers on a booking (BK-016). Staff can add them to a booking that has
 * none, and answer a question the booking was made before. Saving goes through
 * updateEventAttendees, which applies the same rules as the booker's manage link.
 */
export function EventAttendeesEditor({ bookingId, seats, attendees, questions, canEdit, startInEdit = false, prefillNames, onSaved, onCancel }: EventAttendeesEditorProps): React.ReactElement {
  const router = useRouter()
  const startingRows = useMemo(() => {
    const rows = guestDetailsForEditing({ current: attendees, questions, seats, newId: () => crypto.randomUUID() })
    if (attendees.length > 0 || !prefillNames?.length) return rows
    return rows.map((row, index) => ({ ...row, name: prefillNames[index]?.trim() ?? '' }))
  }, [attendees, questions, seats, prefillNames])
  const [guests, setGuests] = useState(startingRows)
  const [editing, setEditing] = useState(startInEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const askedAtBooking = useMemo(() => new Map(attendees.map(guest => [guest.id, new Set((guest.answers ?? []).map(answer => answer.question_id))])), [attendees])

  function changeAnswer(guestId: string, questionId: string, value: string): void {
    setGuests(previous => previous.map(guest => guest.id === guestId ? { ...guest, answers: guest.answers.map(answer => answer.question_id === questionId ? { ...answer, value } : answer) } : guest))
  }
  function cancel(): void {
    setGuests(startingRows)
    setEditing(false)
    setError(null)
    onCancel?.()
  }
  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const result = await updateEventAttendees({ bookingId, attendees: guests.map(guest => ({ id: guest.id, name: guest.name, answers: Object.fromEntries(guest.answers.map(answer => [answer.question_id, answer.value])) })) })
      if (result.error) { setError(result.error); return }
      setEditing(false)
      onSaved?.()
      router.refresh()
    } catch { setError('Guest details could not be saved. Please try again.') }
    finally { setSaving(false) }
  }
  return <section className="space-y-4" aria-label="Guest details">
    <div className="flex items-center justify-between gap-3"><SubHeading>Guest Details ({seats})</SubHeading>
      {canEdit && !editing && <Button variant="secondary" size="sm" onClick={() => { setGuests(startingRows); setEditing(true) }}>Edit Details</Button>}
    </div>
    {guests.map((guest, index) => <div key={guest.id} className="rounded-default border border-border p-4 space-y-3">
      {editing ? <Input label={`Guest ${index + 1} name`} value={guest.name} maxLength={120} required onChange={event => setGuests(previous => previous.map(item => item.id === guest.id ? { ...item, name: event.target.value } : item))} /> : <SubHeading>{guest.name || `Guest ${index + 1}`}</SubHeading>}
      {guest.answers.map(answer => {
        const addedLater = attendees.length > 0 && !askedAtBooking.get(guest.id)?.has(answer.question_id)
        const label = addedLater ? `${answer.label} (added after booking)` : answer.label
        return <div key={answer.question_id} className="text-sm">
          {editing ? (answer.type === 'yes_no' || (answer.type === 'choice' && answer.options?.length) ? <Select label={label} value={answer.value} onChange={event => changeAnswer(guest.id, answer.question_id, event.target.value)}><option value="">Choose an answer</option>{(answer.type === 'yes_no' ? ['yes', 'no'] : answer.options ?? []).map(option => <option key={option} value={option}>{option === 'yes' ? 'Yes' : option === 'no' ? 'No' : option}</option>)}</Select> : <Input label={label} value={answer.value} maxLength={2000} onChange={event => changeAnswer(guest.id, answer.question_id, event.target.value)} />) : <><p className="text-text-muted">{label}</p><p className="whitespace-pre-wrap">{answer.value === 'yes' ? 'Yes' : answer.value === 'no' ? 'No' : answer.value || 'Not provided'}</p></>}
        </div>
      })}
    </div>)}
    {error && <Alert tone="danger" size="sm">{error}</Alert>}
    {editing && <FormFooter>
      <Button variant="secondary" disabled={saving} onClick={cancel}>Cancel</Button>
      <Button variant="primary" onClick={save} loading={saving}>Save Guest Details</Button>
    </FormFooter>}
  </section>
}
