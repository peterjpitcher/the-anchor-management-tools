'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, FormFooter, Input, Select } from '@/ds'
import { updateEventAttendees } from '@/app/actions/event-attendees'
import type { StoredEventAttendee } from '@/lib/events/booking-questions'

export function EventAttendeesEditor({ bookingId, seats, attendees, canEdit }: {
  bookingId: string; seats: number; attendees: StoredEventAttendee[]; canEdit: boolean
}): React.ReactElement {
  const router = useRouter()
  const [guests, setGuests] = useState(attendees)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  function changeAnswer(guestId: string, questionId: string, value: string): void {
    setGuests(previous => previous.map(guest => guest.id === guestId ? { ...guest, answers: guest.answers.map(answer => answer.question_id === questionId ? { ...answer, value } : answer) } : guest))
  }
  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const result = await updateEventAttendees({ bookingId, attendees: guests.map(guest => ({ id: guest.id, name: guest.name, answers: Object.fromEntries(guest.answers.map(answer => [answer.question_id, answer.value])) })) })
      if (result.error) { setError(result.error); return }
      setEditing(false)
      router.refresh()
    } catch { setError('Guest details could not be saved. Please try again.') }
    finally { setSaving(false) }
  }
  return <section className="space-y-4" aria-label="Guest details">
    <div className="flex items-center justify-between gap-3"><p className="font-semibold text-text-strong">Guest details ({seats})</p>
      {canEdit && !editing && <Button variant="secondary" size="sm" onClick={() => { setGuests(attendees); setEditing(true) }}>Edit Details</Button>}
    </div>
    {guests.map((guest, index) => <div key={guest.id} className="rounded-default border border-border p-4 space-y-3">
      {editing ? <Input label={`Guest ${index + 1} name`} value={guest.name} maxLength={120} required onChange={event => setGuests(previous => previous.map(item => item.id === guest.id ? { ...item, name: event.target.value } : item))} /> : <p className="font-medium text-text">{guest.name}</p>}
      {guest.answers.map(answer => <div key={answer.question_id} className="text-sm">
        {editing ? (answer.type === 'yes_no' || (answer.type === 'choice' && answer.options) ? <Select label={answer.label} value={answer.value} required={answer.required} onChange={event => changeAnswer(guest.id, answer.question_id, event.target.value)}><option value="">Choose an answer</option>{(answer.type === 'yes_no' ? ['yes', 'no'] : answer.options ?? []).map(option => <option key={option} value={option}>{option === 'yes' ? 'Yes' : option === 'no' ? 'No' : option}</option>)}</Select> : <Input label={answer.label} value={answer.value} maxLength={2000} required={answer.required} onChange={event => changeAnswer(guest.id, answer.question_id, event.target.value)} />) : <><p className="text-text-muted">{answer.label}</p><p className="whitespace-pre-wrap">{answer.value === 'yes' ? 'Yes' : answer.value === 'no' ? 'No' : answer.value || 'Not provided'}</p></>}
      </div>)}
    </div>)}
    {error && <Alert tone="danger" size="sm">{error}</Alert>}
    {editing && <FormFooter>
      <Button variant="secondary" disabled={saving} onClick={() => { setGuests(attendees); setEditing(false); setError(null) }}>Cancel</Button>
      <Button variant="primary" onClick={save} loading={saving}>Save Guest Details</Button>
    </FormFooter>}
  </section>
}
