'use client'

import { useCallback, useMemo, useState, useTransition, type FormEvent, type ReactNode } from 'react'
import { CalendarFilterBar } from './CalendarFilterBar'
import { applyCalendarFilters, EMPTY_CALENDAR_FILTERS, type CalendarFilters } from './filters'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { formatDateInLondon } from '@/lib/dateUtils'
import { cn } from '@/lib/utils'
import { CalendarDaysIcon, EnvelopeIcon, LockClosedIcon, TruckIcon } from '@heroicons/react/20/solid'
import { Modal, Button, FormGroup, Input, Textarea, toast } from '@/ds'
import { createCalendarNote, updateCalendarNote, deleteCalendarNote } from '@/app/actions/calendar-notes'
import { ScheduleCalendar } from './ScheduleCalendar'
import {
  eventToEntry,
  privateBookingToEntry,
  balanceDueToEntry,
  employeeBirthdayToEntry,
  specialHoursToEntry,
  calendarNoteToEntry,
  parkingToEntry,
  marketingSendToEntry,
} from './adapters'
import type {
  CalendarEntry,
  CalendarEntryKind,
  ScheduleCalendarView,
  ScheduleDailyOps,
} from './types'
import { CALENDAR_COLOUR_OPTIONS, kindColor } from './appearance'
import { entryGaps, type CalendarContentGap } from './filters'
import {
  CAL_MONTH_PARAM,
  CAL_VIEW_PARAM,
  calendarFiltersToParams,
  formatCalendarMonth,
  parseCalendarFilters,
  parseCalendarMonth,
  parseCalendarView,
  withCalendarParams,
} from './url-state'

function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export interface VenueCalendarEvent {
  id: string
  name: string
  date: string | null
  time: string | null
  bookedSeatsCount?: number
  eventStatus?: string | null
  /** Any artwork at all: hero, poster or thumbnail. Drives the "needs artwork" filter. */
  hasImage?: boolean
  /** A non-empty brief. Drives the "needs brief" filter. */
  hasBrief?: boolean
  /** A short or long description, used for listings and social copy. */
  hasDescription?: boolean
}

export interface VenueCalendarBooking {
  id: string
  customer_name: string | null
  event_date: string | null
  start_time: string | null
  end_time: string | null
  end_time_next_day: boolean | null
  guest_count: number | null
  status: string | null
  event_type?: string | null
}

export interface VenueCalendarBalanceDue {
  id: string
  customer_name: string | null
  balance_due_date: string
  event_date: string | null
  status: string | null
  total_amount: number | null
}

export interface VenueCalendarEmployeeBirthday {
  employee_id: string
  employee_name: string
  occurrence_date: string
  turning_age: number | null
  job_title: string | null
}

export interface VenueCalendarNote {
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

export interface VenueCalendarParking {
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

export interface VenueCalendarSpecialHours {
  id: string
  date: string
  opens: string | null
  closes: string | null
  is_closed: boolean
  is_kitchen_closed: boolean
  note: string | null
}

/**
 * A B2B or guest marketing email campaign, placed on the day it goes out.
 *
 * `send_at` is resolved server-side (started, else scheduled) so the dashboard
 * and /events cannot disagree about which day a send belongs to.
 */
export interface VenueCalendarMarketingSend {
  id: string
  name: string
  subject: string
  audience_type: string
  status: string
  send_at: string | null
  recipient_count: number | null
}

export interface VenueCalendarProps {
  events: VenueCalendarEvent[]
  privateBookings: VenueCalendarBooking[]
  balanceDueDates?: VenueCalendarBalanceDue[]
  employeeBirthdays?: VenueCalendarEmployeeBirthday[]
  specialHours?: VenueCalendarSpecialHours[]
  calendarNotes: VenueCalendarNote[]
  parkingBookings: VenueCalendarParking[]
  /** Marketing email sends. Permission-gated at source, so an empty array is normal. */
  marketingSends?: VenueCalendarMarketingSend[]
  /** Create, edit and delete calendar notes from the calendar itself. */
  canManageCalendarNotes?: boolean
  onEmptyDayClick?: (date: Date) => void
  /** Called after a calendar note is created, edited or deleted. When omitted,
   * VenueCalendar falls back to router.refresh() (correct when notes are passed
   * straight from a server component). Client components that hold notes in
   * local state should pass their own refetch here. */
  onNotesChanged?: () => void
  /**
   * Per-dataset problems to show above the calendar, e.g. "notes could not be
   * loaded". One failed dataset must not look like an empty one.
   */
  datasetWarnings?: string[]
  dailyOps?: ScheduleDailyOps
  header?: ReactNode
  /**
   * Show the filter bar above the calendar. Off by default: the dashboard
   * calendar is a glance-at-today widget and does not want it.
   */
  showFilters?: boolean
  className?: string
}

interface NoteEditorState {
  mode: 'create' | 'edit'
  noteId: string | null
  note_date: string
  end_date: string
  title: string
  notes: string
  color: string
  /**
   * The row the editor was opened from. Held so hidden columns the calendar does
   * not render (start_time, end_time) survive a save.
   */
  original: VenueCalendarNote | null
}

type PrivateBookingAdapterInput = Parameters<typeof privateBookingToEntry>[0]

function buildEntries(
  events: VenueCalendarEvent[],
  privateBookings: VenueCalendarBooking[],
  balanceDueDates: VenueCalendarBalanceDue[],
  employeeBirthdays: VenueCalendarEmployeeBirthday[],
  specialHours: VenueCalendarSpecialHours[],
  calendarNotes: VenueCalendarNote[],
  parkingBookings: VenueCalendarParking[],
  marketingSends: VenueCalendarMarketingSend[],
): { entries: CalendarEntry[]; skipped: number } {
  const out: CalendarEntry[] = []

  for (const event of events) {
    if (!event.date) continue
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
        // Pass readiness through UNCHANGED. Coercing undefined to false here is
        // what made every dashboard event claim it needed artwork, a brief and a
        // description: the dashboard never loads those columns.
        hasImage: event.hasImage,
        hasBrief: event.hasBrief,
        hasDescription: event.hasDescription,
        eventStatus: event.eventStatus ?? null,
        bookingUrl: null,
        checklist: { completed: 0, total: 0, overdueCount: 0, dueTodayCount: 0, nextTask: null, outstanding: [] },
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
        status: (booking.status ?? 'confirmed') as PrivateBookingAdapterInput['status'],
        event_type: booking.event_type ?? null,
        guest_count: booking.guest_count,
      }),
    )
  }

  for (const booking of balanceDueDates) {
    if (!booking.balance_due_date) continue
    out.push(balanceDueToEntry(booking))
  }

  for (const birthday of employeeBirthdays) {
    if (!birthday.occurrence_date) continue
    out.push(employeeBirthdayToEntry(birthday))
  }

  for (const special of specialHours) {
    if (!special.date) continue
    out.push(specialHoursToEntry(special))
  }

  for (const note of calendarNotes) {
    if (!note.note_date) continue
    out.push(calendarNoteToEntry(note))
  }

  for (const booking of parkingBookings) {
    if (!booking.start_at) continue
    const entry = parkingToEntry(booking)
    if (entry) out.push(entry)
  }

  for (const send of marketingSends) {
    if (!send.send_at) continue
    const entry = marketingSendToEntry(send)
    if (entry) out.push(entry)
  }

  // Containment: a single unparseable row must not take the calendar down.
  // date-fns v4 format() throws on an Invalid Date, so drop those entries here
  // and report the count rather than rendering or crashing.
  const usable = out.filter(
    (entry) => !Number.isNaN(entry.start.getTime()) && !Number.isNaN(entry.end.getTime()),
  )
  return { entries: usable, skipped: out.length - usable.length }
}

function renderTooltip(entry: CalendarEntry): ReactNode {
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
          {td.time ? ` · ${td.time}` : ''}
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
        {td.notes && <div className="whitespace-pre-wrap line-clamp-2">{td.notes}</div>}
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
          <span>Private booking{entry.statusLabel ? ` · ${entry.statusLabel}` : ''}</span>
        </div>
        <div className="whitespace-pre-wrap">{td.customerName}</div>
        <div>
          {format(entry.start, 'EEE d MMM yyyy')}
          {td.timeRange ? ` · ${td.timeRange}` : ''}
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

  if (entry.tooltipData.kind === 'balance_due') {
    const td = entry.tooltipData
    return (
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          <LockClosedIcon className="h-3.5 w-3.5" />
          <span>Private booking balance due</span>
        </div>
        <div className="whitespace-pre-wrap">{td.customerName}</div>
        <div>{format(entry.start, 'EEE d MMM yyyy')}</div>
        {td.amount !== null && (
          <div>
            <span className="font-medium">Amount:</span> {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(td.amount)}
          </div>
        )}
        {td.eventDate && (
          <div>
            <span className="font-medium">Event date:</span>{' '}
            {formatDateInLondon(td.eventDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>
    )
  }

  if (entry.tooltipData.kind === 'birthday') {
    const td = entry.tooltipData
    return (
      <div className="space-y-1 text-xs">
        <div className="font-medium">Employee birthday</div>
        <div className="whitespace-pre-wrap">{td.employeeName}</div>
        <div>{format(entry.start, 'EEE d MMM yyyy')}</div>
        {td.turningAge !== null && (
          <div>
            <span className="font-medium">Turning:</span> {td.turningAge}
          </div>
        )}
        {td.jobTitle && <div>{td.jobTitle}</div>}
      </div>
    )
  }

  if (entry.tooltipData.kind === 'special_hours') {
    const td = entry.tooltipData
    return (
      <div className="space-y-1 text-xs">
        <div className="font-medium">Special hours</div>
        <div className="whitespace-pre-wrap">{td.title}</div>
        <div>{td.date}</div>
        {td.timeRange && <div>{td.timeRange}</div>}
        {td.isClosed && <div>Venue closed</div>}
        {!td.isClosed && td.isKitchenClosed && <div>Kitchen closed</div>}
        {td.note && td.note !== td.title && (
          <div>
            <span className="font-medium">Note:</span> {td.note}
          </div>
        )}
      </div>
    )
  }

  if (entry.tooltipData.kind === 'parking') {
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
          {format(entry.start, 'EEE d MMM yyyy')} · {td.timeRange}
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

  if (entry.tooltipData.kind === 'marketing_email') {
    const td = entry.tooltipData
    return (
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          <EnvelopeIcon className="h-3.5 w-3.5" />
          <span>Marketing email · {td.statusLabel}</span>
        </div>
        <div className="whitespace-pre-wrap">{td.name}</div>
        <div>
          {format(entry.start, 'EEE d MMM yyyy')} · {td.time}
        </div>
        <div className="whitespace-pre-wrap">
          <span className="font-medium">Subject:</span> {td.subject}
        </div>
        <div>
          <span className="font-medium">Audience:</span> {td.audience}
        </div>
        {td.recipientCount !== null && (
          <div>
            <span className="font-medium">Recipients:</span>{' '}
            {td.recipientCount.toLocaleString('en-GB')}
          </div>
        )}
      </div>
    )
  }

  return null
}

export function VenueCalendar({
  events,
  privateBookings,
  balanceDueDates = [],
  employeeBirthdays = [],
  specialHours = [],
  calendarNotes,
  parkingBookings,
  marketingSends = [],
  canManageCalendarNotes,
  showFilters = false,
  onEmptyDayClick,
  onNotesChanged,
  datasetWarnings = [],
  dailyOps,
  header,
  className,
}: VenueCalendarProps): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // View, month and filters live in the URL so they survive a tab switch (which
  // unmounts this component on /events), a refresh, and being pasted into a
  // message. Namespaced `cal*` so they cannot collide with the events page's own
  // list/calendar/board `view`.
  const view = parseCalendarView(searchParams.get(CAL_VIEW_PARAM)) ?? 'month'
  const anchor = useMemo(
    () => parseCalendarMonth(searchParams.get(CAL_MONTH_PARAM)) ?? new Date(),
    [searchParams],
  )
  const filters = useMemo(
    () => parseCalendarFilters(new URLSearchParams(searchParams.toString()), EMPTY_CALENDAR_FILTERS),
    [searchParams],
  )

  const applyParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = withCalendarParams(new URLSearchParams(searchParams.toString()), updates)
      const query = next.toString()
      // replace, not push: paging months should not fill the back button.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const setView = useCallback(
    (next: ScheduleCalendarView) => applyParams({ [CAL_VIEW_PARAM]: next }),
    [applyParams],
  )
  const setAnchor = useCallback(
    (next: Date) => applyParams({ [CAL_MONTH_PARAM]: formatCalendarMonth(next) }),
    [applyParams],
  )
  const setFilters = useCallback(
    (next: CalendarFilters) => applyParams(calendarFiltersToParams(next)),
    [applyParams],
  )

  // Note editor, shared by every surface that renders the full calendar.
  // `mode` distinguishes creating from editing an existing note; `editing`
  // carries the ORIGINAL note row, never a CalendarEntry, because an entry does
  // not carry end_date, start_time or end_time and seeding from one would
  // silently wipe them on save.
  const [noteEditor, setNoteEditor] = useState<NoteEditorState | null>(null)
  const [isSavingNote, startSavingNote] = useTransition()
  const [isDeletingNote, startDeletingNote] = useTransition()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  function openNewNoteModal(date: Date) {
    const iso = toLocalIsoDate(date)
    setConfirmingDelete(false)
    setNoteEditor({
      mode: 'create',
      noteId: null,
      note_date: iso,
      end_date: iso,
      title: '',
      notes: '',
      color: kindColor('calendar_note'),
      original: null,
    })
  }

  function openEditNoteModal(note: VenueCalendarNote) {
    setConfirmingDelete(false)
    setNoteEditor({
      mode: 'edit',
      noteId: note.id,
      note_date: note.note_date,
      end_date: note.end_date || note.note_date,
      title: note.title,
      notes: note.notes ?? '',
      // Keep whatever colour is stored, including values outside the palette.
      // Forcing a palette choice would silently recolour older notes.
      color: note.color || kindColor('calendar_note'),
      original: note,
    })
  }

  function closeNoteModal() {
    setNoteEditor(null)
    setConfirmingDelete(false)
  }

  function afterNotesChanged() {
    if (onNotesChanged) {
      onNotesChanged()
    } else {
      router.refresh()
    }
  }

  function handleNoteSubmit(e: FormEvent) {
    e.preventDefault()
    if (!noteEditor || !noteEditor.title.trim()) return
    const editor = noteEditor
    startSavingNote(async () => {
      // Always send BOTH dates. The action re-validates the merged row, so a
      // start date moved past a stale end date is rejected unless the end date
      // travels with it.
      const payload = {
        note_date: editor.note_date,
        end_date: editor.end_date || editor.note_date,
        title: editor.title.trim(),
        notes: editor.notes.trim() || null,
        color: editor.color,
      }
      const result =
        editor.mode === 'edit' && editor.noteId
          ? await updateCalendarNote(editor.noteId, {
              ...payload,
              // Preserve hidden times the calendar never exposes. Omitting them
              // would clear them on an unrelated title edit.
              start_time: editor.original?.start_time ?? null,
              end_time: editor.original?.end_time ?? null,
            })
          : await createCalendarNote(payload)

      if (result.error) {
        // Keep the modal open so the draft survives.
        toast.error(result.error)
        return
      }
      toast.success(editor.mode === 'edit' ? 'Calendar note updated.' : 'Calendar note added.')
      closeNoteModal()
      afterNotesChanged()
    })
  }

  function handleNoteDelete() {
    if (!noteEditor?.noteId) return
    const noteId = noteEditor.noteId
    startDeletingNote(async () => {
      const result = await deleteCalendarNote(noteId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Calendar note deleted.')
      closeNoteModal()
      afterNotesChanged()
    })
  }

  const handleEmptyDayClick = canManageCalendarNotes ? (onEmptyDayClick ?? openNewNoteModal) : undefined

  const notesById = useMemo(() => {
    const map = new Map<string, VenueCalendarNote>()
    for (const note of calendarNotes) map.set(note.id, note)
    return map
  }, [calendarNotes])

  const built = useMemo(
    () => buildEntries(events, privateBookings, balanceDueDates, employeeBirthdays, specialHours, calendarNotes, parkingBookings, marketingSends),
    [events, privateBookings, balanceDueDates, employeeBirthdays, specialHours, calendarNotes, parkingBookings, marketingSends],
  )
  const entries = built.entries
  const skippedCount = built.skipped

  // One filter model drives both the month grid and the list, so the two can
  // never disagree about what is being shown.
  const visibleEntries = useMemo(() => applyCalendarFilters(entries, filters), [entries, filters])

  const legendKinds = useMemo<CalendarEntryKind[]>(() => {
    const kinds: CalendarEntryKind[] = []
    if (calendarNotes.length > 0) kinds.push('calendar_note')
    if (specialHours.length > 0) kinds.push('special_hours')
    if (employeeBirthdays.length > 0) kinds.push('birthday')
    if (balanceDueDates.length > 0) kinds.push('balance_due')
    if (privateBookings.length > 0) kinds.push('private_booking')
    if (parkingBookings.length > 0) kinds.push('parking')
    if (marketingSends.length > 0) kinds.push('marketing_email')
    // Only offer Events when there are some. This used to be pushed
    // unconditionally, so a user with no events permission still saw an Events
    // swatch and an Events filter chip that could never match anything.
    if (events.length > 0) kinds.push('event')
    return kinds
  }, [calendarNotes.length, specialHours.length, employeeBirthdays.length, balanceDueDates.length, privateBookings.length, parkingBookings.length, marketingSends.length, events.length])

  // Rows we could not place on a day: either no date at all, or a date we could
  // not parse. Every source column is NOT NULL in production, so the old
  // version of this counter could never fire; malformed data is the real case.
  /**
   * Entries the counts describe.
   *
   * Scoped to what the user is actually looking at: the anchored month in month
   * view, the whole loaded range in list view (which has no month control). The
   * label says which, because "Showing 130 of 130" while four things are on
   * screen tells nobody anything.
   */
  const countScopeLabel = view === 'month' ? format(anchor, 'MMMM yyyy') : 'the loaded range'
  const countableEntries = useMemo(() => {
    if (view !== 'month') return entries
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999)
    // Intersects, not starts-in: a booking that began last month and runs into
    // this one is on screen, so it counts.
    return entries.filter((entry) => entry.start <= monthEnd && entry.end >= monthStart)
  }, [entries, view, anchor])

  const kindCounts = useMemo(() => {
    const counts: Partial<Record<CalendarEntryKind, number>> = {}
    for (const entry of countableEntries) {
      counts[entry.kind] = (counts[entry.kind] ?? 0) + 1
    }
    return counts
  }, [countableEntries])

  const gapCounts = useMemo(() => {
    const counts: Record<CalendarContentGap, number> = { image: 0, brief: 0, description: 0 }
    for (const entry of countableEntries) {
      for (const gap of entryGaps(entry)) counts[gap] += 1
    }
    return counts
  }, [countableEntries])

  const visibleInScope = useMemo(
    () => applyCalendarFilters(countableEntries, filters),
    [countableEntries, filters],
  )

  const hiddenCount = useMemo(() => {
    const missingDate =
      events.filter((e) => !e.date).length +
      calendarNotes.filter((n) => !n.note_date).length +
      privateBookings.filter((b) => !b.event_date).length +
      balanceDueDates.filter((b) => !b.balance_due_date).length +
      employeeBirthdays.filter((b) => !b.occurrence_date).length +
      specialHours.filter((h) => !h.date).length +
      parkingBookings.filter((p) => !p.start_at).length +
      marketingSends.filter((s) => !s.send_at).length
    return missingDate + skippedCount
  }, [events, calendarNotes, privateBookings, balanceDueDates, employeeBirthdays, specialHours, parkingBookings, marketingSends, skippedCount])

  return (
    <div className={className}>
      {header}

      {showFilters && (
        <CalendarFilterBar
          className="mb-3"
          filters={filters}
          onChange={setFilters}
          availableKinds={legendKinds}
          shownCount={visibleInScope.length}
          totalCount={countableEntries.length}
          kindCounts={kindCounts}
          gapCounts={gapCounts}
          countScopeLabel={countScopeLabel}
        />
      )}

      <ScheduleCalendar
        entries={visibleEntries}
        view={view}
        onViewChange={setView}
        anchor={anchor}
        onAnchorChange={setAnchor}
        closureEntries={entries}
        canCreateCalendarNote={canManageCalendarNotes}
        onEmptyDayClick={handleEmptyDayClick}
        onEntryClick={(entry) => {
          if (entry.onClickHref) {
            router.push(entry.onClickHref)
            return
          }
          // Calendar notes carry no href on purpose, so clicking one used to do
          // nothing at all. Open the editor instead, when the user may write.
          if (entry.kind === 'calendar_note' && canManageCalendarNotes) {
            const note = notesById.get(entry.id.replace(/^note:/, ''))
            if (note) openEditNoteModal(note)
          }
        }}
        renderTooltip={renderTooltip}
        legendKinds={legendKinds}
        dailyOps={dailyOps}
        firstDayOfWeek={1}
      />

      {hiddenCount > 0 && (
        <p className="mt-2 text-xs text-gray-500">{hiddenCount} without a date (not shown)</p>
      )}

      {datasetWarnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {datasetWarnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-700">
              {warning}
            </p>
          ))}
        </div>
      )}

      {canManageCalendarNotes && noteEditor && (
        <Modal
          open
          onClose={closeNoteModal}
          title={noteEditor.mode === 'edit' ? 'Edit calendar note' : 'Add calendar note'}
          description={
            noteEditor.mode === 'edit'
              ? 'Changes also update the shared Pub Ops calendar.'
              : `Adding a note for ${format(new Date(noteEditor.note_date + 'T00:00:00'), 'EEE d MMM yyyy')}`
          }
        >
          <form onSubmit={handleNoteSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormGroup label="Start date" required>
                <Input
                  type="date"
                  value={noteEditor.note_date}
                  onChange={(e) => {
                    const d = e.target.value
                    // Clearing a native date input emits an empty string. Writing
                    // that straight back used to unmount the modal and destroy the
                    // draft, because the modal was keyed on the date being truthy.
                    setNoteEditor((f) =>
                      f ? { ...f, note_date: d, end_date: f.end_date < d ? d : f.end_date } : f,
                    )
                  }}
                  required
                />
              </FormGroup>
              <FormGroup label="End date" required>
                <Input
                  type="date"
                  value={noteEditor.end_date}
                  min={noteEditor.note_date}
                  onChange={(e) =>
                    setNoteEditor((f) => (f ? { ...f, end_date: e.target.value } : f))
                  }
                  required
                />
              </FormGroup>
            </div>
            <FormGroup label="Title" required>
              <Input
                type="text"
                placeholder="e.g. St Patrick's Day"
                value={noteEditor.title}
                onChange={(e) => setNoteEditor((f) => (f ? { ...f, title: e.target.value } : f))}
                maxLength={160}
                required
                autoFocus
              />
            </FormGroup>
            <FormGroup label="Colour">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CALENDAR_COLOUR_OPTIONS.map((option) => {
                  const selected = noteEditor.color.toUpperCase() === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setNoteEditor((f) => (f ? { ...f, color: option.value } : f))}
                      className={cn(
                        'flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors',
                        selected
                          ? 'border-gray-950 bg-gray-100 text-gray-950 ring-2 ring-gray-950 ring-offset-1'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      <span
                        className="h-5 w-5 shrink-0 rounded-sm border border-black/20"
                        style={{ backgroundColor: option.value }}
                        aria-hidden="true"
                      />
                      {option.label}
                    </button>
                  )
                })}
              </div>
              {!CALENDAR_COLOUR_OPTIONS.some(
                (option) => option.value === noteEditor.color.toUpperCase(),
              ) && (
                <p className="mt-2 text-xs text-gray-500">
                  This note uses a colour outside the palette. It is kept unless you pick a new one.
                </p>
              )}
            </FormGroup>
            <FormGroup label="Notes">
              <Textarea
                rows={3}
                placeholder="Optional detail."
                value={noteEditor.notes}
                onChange={(e) => setNoteEditor((f) => (f ? { ...f, notes: e.target.value } : f))}
                maxLength={4000}
              />
            </FormGroup>

            {confirmingDelete && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
                <p className="font-medium">Delete this note permanently?</p>
                <p className="mt-1">
                  This cannot be undone, and it also removes the entry from the shared Pub Ops
                  calendar.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    loading={isDeletingNote}
                    onClick={handleNoteDelete}
                  >
                    Delete permanently
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isDeletingNote}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Keep it
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {noteEditor.mode === 'edit' && !confirmingDelete && (
                <Button
                  variant="ghost"
                  type="button"
                  className="mr-auto text-red-700"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={isSavingNote || isDeletingNote}
                >
                  Delete
                </Button>
              )}
              <Button
                variant="ghost"
                type="button"
                onClick={closeNoteModal}
                disabled={isSavingNote || isDeletingNote}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={isSavingNote}
                disabled={isDeletingNote}
                leftIcon={<CalendarDaysIcon className="h-4 w-4" />}
              >
                {noteEditor.mode === 'edit' ? 'Save changes' : 'Add note'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
