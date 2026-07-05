'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { CalendarDaysIcon } from '@heroicons/react/20/solid'
import { VenueCalendar } from '@/components/schedule-calendar'
import type {
  VenueCalendarEvent,
  VenueCalendarBooking,
  VenueCalendarBalanceDue,
  VenueCalendarEmployeeBirthday,
  VenueCalendarNote,
  VenueCalendarParking,
  VenueCalendarSpecialHours,
  ScheduleDailyOps,
} from '@/components/schedule-calendar'
import { Modal } from '@/ds'
import { Button } from '@/ds'
import { FormGroup } from '@/ds'
import { Input } from '@/ds'
import { Textarea } from '@/ds'
import { toast } from '@/ds'
import { createCalendarNote } from '@/app/actions/calendar-notes'

function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function UpcomingScheduleCalendar({
  events,
  calendarNotes,
  privateBookings,
  balanceDueDates,
  employeeBirthdays,
  specialHours,
  parkingBookings,
  canCreateCalendarNote,
  dailyOps,
}: {
  events: VenueCalendarEvent[]
  calendarNotes: VenueCalendarNote[]
  privateBookings: VenueCalendarBooking[]
  balanceDueDates: VenueCalendarBalanceDue[]
  employeeBirthdays: VenueCalendarEmployeeBirthday[]
  specialHours: VenueCalendarSpecialHours[]
  parkingBookings: VenueCalendarParking[]
  canCreateCalendarNote?: boolean
  dailyOps?: ScheduleDailyOps
}) {
  const router = useRouter()
  const [newNoteDate, setNewNoteDate] = useState<string | null>(null)
  const [newNoteForm, setNewNoteForm] = useState({ title: '', notes: '', color: '#0EA5E9', end_date: '' })
  const [isSaving, startSaving] = useTransition()

  function openNewNoteModal(date: Date) {
    const iso = toLocalIsoDate(date)
    setNewNoteDate(iso)
    setNewNoteForm({ title: '', notes: '', color: '#0EA5E9', end_date: iso })
  }

  function closeNewNoteModal() {
    setNewNoteDate(null)
  }

  function handleNewNoteSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!newNoteDate || !newNoteForm.title.trim()) return
    startSaving(async () => {
      const result = await createCalendarNote({
        note_date: newNoteDate,
        end_date: newNoteForm.end_date || newNoteDate,
        title: newNoteForm.title.trim(),
        notes: newNoteForm.notes.trim() || null,
        color: newNoteForm.color,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Calendar note added.')
      closeNewNoteModal()
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {canCreateCalendarNote && newNoteDate && (
        <Modal
          open={Boolean(newNoteDate)}
          onClose={closeNewNoteModal}
          title="Add calendar note"
          description={`Adding a note for ${format(new Date(newNoteDate + 'T00:00:00'), 'EEE d MMM yyyy')}`}
        >
          <form onSubmit={handleNewNoteSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormGroup label="Start date" required>
                <Input
                  type="date"
                  value={newNoteDate}
                  onChange={(e) => {
                    const d = e.target.value
                    setNewNoteDate(d)
                    setNewNoteForm((f) => ({ ...f, end_date: f.end_date < d ? d : f.end_date }))
                  }}
                  required
                />
              </FormGroup>
              <FormGroup label="End date" required>
                <Input
                  type="date"
                  value={newNoteForm.end_date}
                  min={newNoteDate}
                  onChange={(e) => setNewNoteForm((f) => ({ ...f, end_date: e.target.value }))}
                  required
                />
              </FormGroup>
            </div>
            <FormGroup label="Title" required>
              <Input
                type="text"
                placeholder="e.g. St Patrick's Day"
                value={newNoteForm.title}
                onChange={(e) => setNewNoteForm((f) => ({ ...f, title: e.target.value }))}
                maxLength={160}
                required
                autoFocus
              />
            </FormGroup>
            <FormGroup label="Color">
              <Input
                type="color"
                value={newNoteForm.color}
                onChange={(e) => setNewNoteForm((f) => ({ ...f, color: e.target.value }))}
              />
            </FormGroup>
            <FormGroup label="Notes">
              <Textarea
                rows={3}
                placeholder="Optional detail."
                value={newNoteForm.notes}
                onChange={(e) => setNewNoteForm((f) => ({ ...f, notes: e.target.value }))}
                maxLength={4000}
              />
            </FormGroup>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={closeNewNoteModal} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" loading={isSaving} leftIcon={<CalendarDaysIcon className="h-4 w-4" />}>
                Add note
              </Button>
            </div>
          </form>
        </Modal>
      )}

      <VenueCalendar
        events={events}
        calendarNotes={calendarNotes}
        privateBookings={privateBookings}
        balanceDueDates={balanceDueDates}
        employeeBirthdays={employeeBirthdays}
        specialHours={specialHours}
        parkingBookings={parkingBookings}
        canCreateCalendarNote={canCreateCalendarNote}
        onEmptyDayClick={canCreateCalendarNote ? openNewNoteModal : undefined}
        dailyOps={dailyOps}
      />
    </div>
  )
}
