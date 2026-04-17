'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { CalendarDaysIcon, LockClosedIcon, TruckIcon } from '@heroicons/react/20/solid'
import {
  ScheduleCalendar,
  eventToEntry,
  privateBookingToEntry,
  calendarNoteToEntry,
  parkingToEntry,
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

type DashboardEventSummary = {
  id: string
  name: string
  date: string | null
  time: string | null
  bookedSeatsCount?: number
}

type DashboardCalendarNoteSummary = {
  id: string
  note_date: string
  end_date: string
  title: string
  notes: string | null
  source: string
  start_time: string | null
  end_time: string | null
  color: string
}

type DashboardPrivateBookingSummary = {
  id: string
  customer_name: string | null
  event_date: string | null
  start_time: string | null
  end_time: string | null
  end_time_next_day: boolean | null
  guest_count: number | null
  status: string | null
  hold_expiry: string | null
  deposit_status: 'Paid' | 'Required' | 'Not Required' | null
  balance_due_date: string | null
  days_until_event: number | null
}

type DashboardParkingBookingSummary = {
  id: string
  reference: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  vehicle_registration: string | null
  start_at: string | null
  end_at: string | null
  status: string | null
  payment_status: string | null
}

function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function UpcomingScheduleCalendar({
  events,
  calendarNotes,
  privateBookings,
  parkingBookings,
  canCreateCalendarNote,
}: {
  events: DashboardEventSummary[]
  calendarNotes: DashboardCalendarNoteSummary[]
  privateBookings: DashboardPrivateBookingSummary[]
  parkingBookings: DashboardParkingBookingSummary[]
  canCreateCalendarNote?: boolean
}) {
  const router = useRouter()
  const [view, setView] = useState<ScheduleCalendarView>('month')
  const [newNoteDate, setNewNoteDate] = useState<string | null>(null)
  const [newNoteForm, setNewNoteForm] = useState({ title: '', notes: '', color: '#0EA5E9', end_date: '' })
  const [isSaving, startSaving] = useTransition()

  const entries = useMemo<CalendarEntry[]>(() => {
    const out: CalendarEntry[] = []

    for (const event of events) {
      if (!event.date) continue
      // Shape-adapt dashboard EventSummary into the subset of EventOverview
      // that eventToEntry actually reads (id/name/date/time/bookedSeatsCount/
      // eventStatus/category). Other EventOverview fields are unused by the
      // adapter so we pass an adapter-scoped input.
      out.push(
        eventToEntry({
          id: event.id,
          name: event.name,
          date: event.date,
          time: event.time ?? '',
          daysUntil: 0,
          bookedSeatsCount: event.bookedSeatsCount ?? 0,
          category: null,
          heroImageUrl: null,
          posterImageUrl: null,
          eventStatus: null,
          bookingUrl: null,
          checklist: {
            completed: 0,
            total: 0,
            overdueCount: 0,
            dueTodayCount: 0,
            nextTask: null,
            outstanding: [],
          },
          statusBadge: { label: '', tone: 'neutral' },
        }),
      )
    }

    for (const booking of privateBookings) {
      if (!booking.event_date) continue
      out.push(
        privateBookingToEntry({
          id: booking.id,
          customer_name: booking.customer_name ?? 'Guest',
          event_date: booking.event_date,
          start_time: booking.start_time ?? '',
          end_time: booking.end_time,
          end_time_next_day: booking.end_time_next_day,
          // PrivateBookingCalendarOverview.status is a BookingStatus — the
          // adapter only reads it to derive a display status via string
          // compare, so a cast through unknown is safe for runtime strings.
          status: (booking.status ?? 'confirmed') as PrivateBookingCalendarInput['status'],
          event_type: null,
          guest_count: booking.guest_count,
        }),
      )
    }

    for (const note of calendarNotes) {
      if (!note.note_date) continue
      out.push(calendarNoteToEntry(note))
    }

    for (const booking of parkingBookings) {
      if (!booking.start_at) continue
      out.push(parkingToEntry(booking))
    }

    return out
  }, [calendarNotes, events, parkingBookings, privateBookings])

  const legendKinds = useMemo<CalendarEntryKind[]>(() => {
    const kinds: CalendarEntryKind[] = []
    if (calendarNotes.length > 0) kinds.push('calendar_note')
    if (privateBookings.length > 0) kinds.push('private_booking')
    if (parkingBookings.length > 0) kinds.push('parking')
    kinds.push('event')
    return kinds
  }, [calendarNotes.length, parkingBookings.length, privateBookings.length])

  const hiddenCount = useMemo(() => {
    const hiddenEvents = events.filter((event) => !event.date).length
    const hiddenNotes = calendarNotes.filter((note) => !note.note_date).length
    const hiddenBookings = privateBookings.filter((booking) => !booking.event_date).length
    const hiddenParking = parkingBookings.filter((booking) => !booking.start_at).length
    return hiddenEvents + hiddenNotes + hiddenBookings + hiddenParking
  }, [calendarNotes, events, parkingBookings, privateBookings])

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
    if (entry.tooltipData.kind === 'event') {
      const td = entry.tooltipData
      return (
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <CalendarDaysIcon className="h-3.5 w-3.5" />
            <span>Event</span>
          </div>
          <div className="whitespace-pre-wrap">{td.name}</div>
          <div>
            {format(entry.start, 'EEE d MMM yyyy')}
            {td.time ? ` • ${td.time}` : ''}
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

    if (entry.tooltipData.kind === 'calendar_note') {
      const td = entry.tooltipData
      return (
        <div className="space-y-1 text-xs">
          <div className="font-medium">Calendar note</div>
          <div className="whitespace-pre-wrap">{td.title}</div>
          <div>{td.dateRange}</div>
          {td.notes && <div className="whitespace-pre-wrap">{td.notes}</div>}
          <div>{td.source === 'ai' ? 'AI generated' : 'Manual note'}</div>
        </div>
      )
    }

    if (entry.tooltipData.kind === 'private_booking') {
      const td = entry.tooltipData
      return (
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <LockClosedIcon className="h-3.5 w-3.5" />
            <span>Private booking{entry.statusLabel ? ` • ${entry.statusLabel}` : ''}</span>
          </div>
          <div className="whitespace-pre-wrap">{td.customerName}</div>
          <div>
            {format(entry.start, 'EEE d MMM yyyy')}
            {td.timeRange ? ` • ${td.timeRange}` : ''}
          </div>
          {td.guestCount !== null && (
            <div>
              <span className="font-medium">Guests:</span> {td.guestCount}
            </div>
          )}
          {td.endsNextDay && <div>Ends next day</div>}
        </div>
      )
    }

    // parking
    const td = entry.tooltipData
    return (
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          <TruckIcon className="h-3.5 w-3.5" />
          <span>Parking</span>
        </div>
        {td.reference && (
          <div>
            <span className="font-medium">Ref:</span> {td.reference}
          </div>
        )}
        {td.vehicleReg && (
          <div>
            <span className="font-medium">Vehicle:</span> {td.vehicleReg}
          </div>
        )}
        <div>
          {format(entry.start, 'EEE d MMM yyyy')} • {td.timeRange}
        </div>
        <div>
          <span className="font-medium">Customer:</span> {td.customerName}
        </div>
        {td.status && (
          <div>
            <span className="font-medium">Status:</span> {td.status}
          </div>
        )}
      </div>
    )
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

      <ScheduleCalendar
        entries={entries}
        view={view}
        onViewChange={setView}
        canCreateCalendarNote={canCreateCalendarNote}
        onEmptyDayClick={canCreateCalendarNote ? openNewNoteModal : undefined}
        onEntryClick={(entry) => {
          if (entry.onClickHref) router.push(entry.onClickHref)
        }}
        renderTooltip={renderTooltip}
        legendKinds={legendKinds}
        firstDayOfWeek={1}
      />

      {hiddenCount > 0 && (
        <p className="text-xs text-gray-500">{hiddenCount} without a date (not shown)</p>
      )}
    </div>
  )
}

// Local alias for the private-booking adapter's input shape. Its `status`
// field is a BookingStatus union in events-command-center; we mirror the
// structural shape here so the cast stays narrow and explicit.
type PrivateBookingCalendarInput = Parameters<typeof privateBookingToEntry>[0]
