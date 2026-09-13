'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@/ds'
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
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Guest details ({seats})</h3>
      {canEdit && !editing && <Button variant="secondary" size="sm" onClick={() => { setGuests(attendees); setEditing(true) }}>Edit details</Button>}
    </div>
    {guests.map((guest, index) => <div key={guest.id} className="rounded-lg border border-border p-4 space-y-3">
      {editing ? <label className="block text-sm">Guest {index + 1} name<Input value={guest.name} maxLength={120} required onChange={event => setGuests(previous => previous.map(item => item.id === guest.id ? { ...item, name: event.target.value } : item))} /></label> : <h4 className="font-medium">{guest.name}</h4>}
      {guest.answers.map(answer => <div key={answer.question_id} className="text-sm">
        {editing ? <label className="block">{answer.label}{answer.type === 'yes_no' || (answer.type === 'choice' && answer.options) ? <select className="block w-full rounded-md border border-border p-2" value={answer.value} required={answer.required} onChange={event => changeAnswer(guest.id, answer.question_id, event.target.value)}><option value="">Choose an answer</option>{(answer.type === 'yes_no' ? ['yes', 'no'] : answer.options ?? []).map(option => <option key={option} value={option}>{option === 'yes' ? 'Yes' : option === 'no' ? 'No' : option}</option>)}</select> : <Input value={answer.value} maxLength={2000} required={answer.required} onChange={event => changeAnswer(guest.id, answer.question_id, event.target.value)} />}</label> : <><p className="text-text-muted">{answer.label}</p><p className="whitespace-pre-wrap">{answer.value === 'yes' ? 'Yes' : answer.value === 'no' ? 'No' : answer.value || 'Not provided'}</p></>}
      </div>)}
    </div>)}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {editing && <div className="flex gap-2"><Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save guest details'}</Button><Button variant="secondary" disabled={saving} onClick={() => { setGuests(attendees); setEditing(false); setError(null) }}>Cancel</Button></div>}
  </section>
}
