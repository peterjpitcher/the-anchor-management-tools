'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { CalendarDaysIcon, LockClosedIcon } from '@heroicons/react/20/solid'
import type {
  EventOverview,
  CalendarNoteCalendarOverview,
  PrivateBookingCalendarOverview,
} from '@/app/(authenticated)/events/get-events-command-center'
import {
  ScheduleCalendar,
  eventToEntry,
  privateBookingToEntry,
  calendarNoteToEntry,
} from '@/components/schedule-calendar'
import type {
  CalendarEntry,
  CalendarEntryKind,
  ScheduleCalendarView,
} from '@/components/schedule-calendar'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { createCalendarNote } from '@/app/actions/calendar-notes'

function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

interface EventCalendarViewProps {
  events: EventOverview[]
  privateBookings?: PrivateBookingCalendarOverview[]
  calendarNotes?: CalendarNoteCalendarOverview[]
  canCreateCalendarNote?: boolean
  view: ScheduleCalendarView
  onViewChange: (view: ScheduleCalendarView) => void
}

export default function EventCalendarView({
  events,
  privateBookings,
  calendarNotes,
  canCreateCalendarNote,
  view,
  onViewChange,
}: EventCalendarViewProps) {
  const router = useRouter()
  const [newNoteDate, setNewNoteDate] = useState<string | null>(null)
  const [newNoteForm, setNewNoteForm] = useState({ title: '', notes: '', color: '#0EA5E9', end_date: '' })
  const [isSaving, startSaving] = useTransition()

  const entries = useMemo<CalendarEntry[]>(() => {
    return [
      ...events.map(eventToEntry),
      ...(privateBookings ?? []).map(privateBookingToEntry),
      ...(calendarNotes ?? []).map(calendarNoteToEntry),
    ]
  }, [events, privateBookings, calendarNotes])

  const hasPrivateBookings = (privateBookings ?? []).length > 0
  const hasCalendarNotes = (calendarNotes ?? []).length > 0

  const legendKinds = useMemo<CalendarEntryKind[]>(() => {
    const kinds: CalendarEntryKind[] = []
    if (hasCalendarNotes) kinds.push('calendar_note')
    if (hasPrivateBookings) kinds.push('private_booking')
    kinds.push('event')
    return kinds
  }, [hasCalendarNotes, hasPrivateBookings])

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

  function renderTooltip(entry: CalendarEntry) {
    if (entry.tooltipData.kind === 'calendar_note') {
      const td = entry.tooltipData
      return (
        <div className="space-y-1 text-xs">
          <div className="font-medium">Calendar note</div>
          <div className="whitespace-pre-wrap">{td.title}</div>
          <div>{td.dateRange}</div>
          {td.notes && <div className="whitespace-pre-wrap">{td.notes}</div>}
          <div className="text-gray-300">{td.source === 'ai' ? 'AI generated' : 'Manual note'}</div>
        </div>
      )
    }

    if (entry.tooltipData.kind === 'private_booking') {
      const td = entry.tooltipData
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <LockClosedIcon className="h-4 w-4 text-violet-200" />
            <span>Private booking</span>
          </div>
          <div className="space-y-1 text-xs">
            <div>
              <span className="font-medium">Customer:</span> {td.customerName}
            </div>
            {td.eventType && (
              <div>
                <span className="font-medium">Type:</span> {td.eventType}
              </div>
            )}
            {td.guestCount !== null && (
              <div>
                <span className="font-medium">Guests:</span> {td.guestCount}
              </div>
            )}
            <div>
              <span className="font-medium">When:</span>{' '}
              {format(entry.start, 'EEE d MMM yyyy')} {td.timeRange}
            </div>
          </div>
        </div>
      )
    }

    if (entry.tooltipData.kind === 'event') {
      const td = entry.tooltipData
      return (
        <div className="space-y-1 text-xs">
          <div className="font-medium">{td.name}</div>
          <div>
            <span className="font-medium">Time:</span> {td.time}
          </div>
          <div>
            <span className="font-medium">Booked:</span> {td.bookedSeats}
          </div>
          {td.category && (
            <div>
              <span className="font-medium">Category:</span> {td.category}
            </div>
          )}
        </div>
      )
    }

    return <div className="text-xs whitespace-pre-wrap">{entry.title}</div>
  }

  return (
    <div className="space-y-4">
      {events.length === 0 && !hasPrivateBookings && !hasCalendarNotes && (
        <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-sm text-gray-500">No events found matching your criteria.</p>
        </div>
      )}

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

      <ScheduleCalendar
        entries={entries}
        view={view}
        onViewChange={onViewChange}
        canCreateCalendarNote={canCreateCalendarNote}
        onEmptyDayClick={openNewNoteModal}
        onEntryClick={(entry) => {
          if (entry.onClickHref) router.push(entry.onClickHref)
        }}
        renderTooltip={renderTooltip}
        legendKinds={legendKinds}
      />
    </div>
  )
}
