'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addHours, format } from 'date-fns'
import { CalendarDaysIcon, LockClosedIcon } from '@heroicons/react/20/solid'
import type {
  EventOverview,
  CalendarNoteCalendarOverview,
  PrivateBookingCalendarOverview,
} from '@/app/(authenticated)/events/get-events-command-center'
import { EventCalendar, type CalendarEvent } from '@/components/ui-v2/display/Calendar'
import { Tooltip } from '@/components/ui-v2/overlay/Tooltip'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { createCalendarNote } from '@/app/actions/calendar-notes'

type CalendarViewMode = 'month' | 'week' | 'day'

function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim()
  if (!trimmed.startsWith('#')) return null

  const hex = trimmed.slice(1)
  if (hex.length === 3) {
    const [r, g, b] = hex.split('')
    if (!r || !g || !b) return null
    return `#${r}${r}${g}${g}${b}${b}`
  }

  if (hex.length === 6) return `#${hex}`
  if (hex.length === 8) return `#${hex.slice(0, 6)}`

  return null
}

function getReadableTextColor(backgroundColor: string): string | undefined {
  const normalized = normalizeHexColor(backgroundColor)
  if (!normalized) return undefined

  const r = parseInt(normalized.slice(1, 3), 16)
  const g = parseInt(normalized.slice(3, 5), 16)
  const b = parseInt(normalized.slice(5, 7), 16)
  if ([r, g, b].some(Number.isNaN)) return undefined

  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness >= 160 ? '#111827' : 'white'
}

function getEventColor(event: EventOverview): string {
  if (event.eventStatus === 'cancelled') return '#ef4444'
  if (event.eventStatus === 'postponed') return '#f59e0b'
  if (event.eventStatus === 'draft') return '#6b7280'

  if (event.category?.color) return event.category.color

  switch (event.statusBadge.tone) {
    case 'success':
      return '#22c55e'
    case 'warning':
      return '#f59e0b'
    case 'error':
      return '#ef4444'
    case 'info':
      return '#3b82f6'
    case 'neutral':
    default:
      return '#6b7280'
  }
}

function getEventStartDate(event: EventOverview): Date {
  const [yearStr, monthStr, dayStr] = event.date.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  const day = Number(dayStr)

  const [hourStr, minuteStr] = (event.time || '00:00').split(':').slice(0, 2)
  const hours = Number(hourStr)
  const minutes = Number(minuteStr)

  return new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(monthIndex) ? monthIndex : new Date().getMonth(),
    Number.isFinite(day) ? day : new Date().getDate(),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0
  )
}

const PRIVATE_BOOKING_ID_PREFIX = 'pb:'
const CALENDAR_NOTE_ID_PREFIX = 'note:'

function getPrivateBookingStartDate(booking: PrivateBookingCalendarOverview): Date {
  const [yearStr, monthStr, dayStr] = booking.event_date.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  const day = Number(dayStr)

  const [hourStr, minuteStr] = (booking.start_time || '00:00').split(':').slice(0, 2)
  const hours = Number(hourStr)
  const minutes = Number(minuteStr)

  return new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(monthIndex) ? monthIndex : new Date().getMonth(),
    Number.isFinite(day) ? day : new Date().getDate(),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0
  )
}

function getPrivateBookingEndDate(
  booking: PrivateBookingCalendarOverview,
  start: Date
): Date {
  if (!booking.end_time) {
    return addHours(start, 2)
  }

  const [endHourStr, endMinuteStr] = booking.end_time.split(':').slice(0, 2)
  const endHours = Number(endHourStr)
  const endMinutes = Number(endMinuteStr)

  const base = new Date(start)
  if (booking.end_time_next_day) {
    base.setDate(base.getDate() + 1)
  }

  base.setHours(Number.isFinite(endHours) ? endHours : 0)
  base.setMinutes(Number.isFinite(endMinutes) ? endMinutes : 0)
  base.setSeconds(0)
  base.setMilliseconds(0)
  return base
}

function getPrivateBookingColor(booking: PrivateBookingCalendarOverview): string {
  switch (booking.status) {
    case 'cancelled':
      return '#ef4444'
    case 'completed':
      return '#6366f1'
    case 'draft':
      return '#a78bfa'
    case 'confirmed':
    default:
      return '#8b5cf6'
  }
}

function getCalendarNoteStartDate(note: CalendarNoteCalendarOverview): Date {
  const [yearStr, monthStr, dayStr] = note.note_date.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  const day = Number(dayStr)

  return new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(monthIndex) ? monthIndex : new Date().getMonth(),
    Number.isFinite(day) ? day : new Date().getDate(),
    0,
    0
  )
}

function getCalendarNoteEndDate(note: CalendarNoteCalendarOverview): Date {
  const endDateIso = note.end_date || note.note_date
  const [yearStr, monthStr, dayStr] = endDateIso.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  const day = Number(dayStr)

  return new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(monthIndex) ? monthIndex : new Date().getMonth(),
    Number.isFinite(day) ? day : new Date().getDate(),
    0,
    0
  )
}

function getCalendarNoteDateLabel(note: CalendarNoteCalendarOverview): string {
  if (note.note_date === note.end_date) return format(getCalendarNoteStartDate(note), 'EEE d MMM yyyy')
  return `${format(getCalendarNoteStartDate(note), 'EEE d MMM yyyy')} to ${format(getCalendarNoteEndDate(note), 'EEE d MMM yyyy')}`
}

export default function EventCalendarView({
  events,
  privateBookings,
  calendarNotes,
  canCreateCalendarNote,
}: {
  events: EventOverview[]
  privateBookings?: PrivateBookingCalendarOverview[]
  calendarNotes?: CalendarNoteCalendarOverview[]
  canCreateCalendarNote?: boolean
}) {
  const router = useRouter()
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('month')
  const [newNoteDate, setNewNoteDate] = useState<string | null>(null)
  const [newNoteForm, setNewNoteForm] = useState({ title: '', notes: '', color: '#0EA5E9', end_date: '' })
  const [isSaving, startSaving] = useTransition()

  const privateBookingsById = useMemo(() => {
    const map = new Map<string, PrivateBookingCalendarOverview>()
    for (const booking of privateBookings ?? []) {
      map.set(booking.id, booking)
    }
    return map
  }, [privateBookings])

  const calendarNotesById = useMemo(() => {
    const map = new Map<string, CalendarNoteCalendarOverview>()
    for (const note of calendarNotes ?? []) {
      map.set(note.id, note)
    }
    return map
  }, [calendarNotes])

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const eventEntries = events.map((event) => {
      const start = getEventStartDate(event)
      const end = addHours(start, 2)
      const color = getEventColor(event)

      return {
        id: event.id,
        title: event.name,
        start,
        end,
        color,
        textColor: getReadableTextColor(color),
      }
    })

    const privateBookingEntries = (privateBookings ?? []).map((booking) => {
      const start = getPrivateBookingStartDate(booking)
      const end = getPrivateBookingEndDate(booking, start)
      const color = getPrivateBookingColor(booking)

      const titleParts = [booking.customer_name]
      if (booking.event_type) titleParts.push(booking.event_type)
      if (booking.guest_count !== null && booking.guest_count !== undefined) {
        titleParts.push(`${booking.guest_count} guests`)
      }

      const title = titleParts.join(' • ')

      return {
        id: `${PRIVATE_BOOKING_ID_PREFIX}${booking.id}`,
        title,
        start,
        end,
        showOnStartDayOnly: true,
        color,
        textColor: getReadableTextColor(color),
      }
    })

    const noteEntries = (calendarNotes ?? []).map((note) => {
      const start = getCalendarNoteStartDate(note)
      const endRaw = getCalendarNoteEndDate(note)
      const end = endRaw.getTime() < start.getTime() ? start : endRaw
      const color = normalizeHexColor(note.color) ?? '#0EA5E9'

      return {
        id: `${CALENDAR_NOTE_ID_PREFIX}${note.id}`,
        title: note.title,
        start,
        end,
        allDay: true,
        color,
        textColor: getReadableTextColor(color),
      }
    })

    return [...eventEntries, ...privateBookingEntries, ...noteEntries].sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [calendarNotes, events, privateBookings])

  const hasPrivateBookings = (privateBookings ?? []).length > 0
  const hasCalendarNotes = (calendarNotes ?? []).length > 0

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
    <div className="space-y-4">
      {events.length === 0 && !hasPrivateBookings && !hasCalendarNotes && (
        <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-sm text-gray-500">No events found matching your criteria.</p>
        </div>
      )}

      {(hasPrivateBookings || hasCalendarNotes) && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          {hasCalendarNotes && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-sky-500" />
              <CalendarDaysIcon className="h-4 w-4 text-sky-600" />
              Calendar notes
            </span>
          )}
          {hasPrivateBookings && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-violet-500" />
              <LockClosedIcon className="h-4 w-4 text-violet-600" />
              Private bookings
            </span>
          )}
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

      <EventCalendar
        events={calendarEvents}
        view={calendarView}
        onViewChange={setCalendarView}
        firstDayOfWeek={1}
        onDateClick={canCreateCalendarNote ? openNewNoteModal : undefined}
        renderEvent={(event) => {
          if (event.id.startsWith(CALENDAR_NOTE_ID_PREFIX)) {
            const noteId = event.id.slice(CALENDAR_NOTE_ID_PREFIX.length)
            const note = calendarNotesById.get(noteId)
            const tooltipContent = note ? (
              <div className="space-y-1 text-xs">
                <div className="font-medium">Calendar note</div>
                <div className="whitespace-pre-wrap">{note.title}</div>
                <div>
                  {getCalendarNoteDateLabel(note)}
                </div>
                {note.notes && <div className="whitespace-pre-wrap">{note.notes}</div>}
                <div className="text-gray-300">{note.source === 'ai' ? 'AI generated' : 'Manual note'}</div>
              </div>
            ) : (
              <div className="text-xs whitespace-pre-wrap">{event.title}</div>
            )

            return (
              <Tooltip content={tooltipContent} placement="top" delay={250} maxWidth={360}>
                <span className="inline-flex min-w-0 items-center gap-1">
                  <CalendarDaysIcon className="h-3 w-3 flex-none" />
                  <span className="truncate">{event.title}</span>
                </span>
              </Tooltip>
            )
          }

          const isPrivateBooking = event.id.startsWith(PRIVATE_BOOKING_ID_PREFIX)

          if (!isPrivateBooking) {
            return <span className="truncate">{event.title}</span>
          }

          const bookingId = event.id.slice(PRIVATE_BOOKING_ID_PREFIX.length)
          const booking = privateBookingsById.get(bookingId)

          const tooltipContent = booking ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <LockClosedIcon className="h-4 w-4 text-violet-200" />
                <span>Private booking</span>
              </div>
              <div className="space-y-1 text-xs">
                <div>
                  <span className="font-medium">Customer:</span> {booking.customer_name}
                </div>
                {booking.event_type && (
                  <div>
                    <span className="font-medium">Type:</span> {booking.event_type}
                  </div>
                )}
                {booking.guest_count !== null && booking.guest_count !== undefined && (
                  <div>
                    <span className="font-medium">Guests:</span> {booking.guest_count}
                  </div>
                )}
                <div>
                  <span className="font-medium">When:</span>{' '}
                  {format(event.start, 'EEE d MMM yyyy')} {format(event.start, 'HH:mm')}–{format(event.end, 'HH:mm')}
                  {event.end.toDateString() !== event.start.toDateString() ? ' (+1 day)' : ''}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs whitespace-pre-wrap">{event.title}</div>
          )

          return (
            <Tooltip content={tooltipContent} placement="top" delay={250} maxWidth={360}>
              <span className="inline-flex min-w-0 items-center gap-1">
                <LockClosedIcon className="h-3 w-3 flex-none" />
                <span className="truncate">{event.title}</span>
              </span>
            </Tooltip>
          )
        }}
        onEventClick={(event) => {
          if (event.id.startsWith(CALENDAR_NOTE_ID_PREFIX)) {
            return
          }

          if (event.id.startsWith(PRIVATE_BOOKING_ID_PREFIX)) {
            router.push(`/private-bookings/${event.id.slice(PRIVATE_BOOKING_ID_PREFIX.length)}`)
            return
          }

          router.push(`/events/${event.id}`)
        }}
      />
    </div>
  )
}
