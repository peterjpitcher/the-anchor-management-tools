'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { CalendarDaysIcon, LockClosedIcon, TruckIcon } from '@heroicons/react/20/solid'
import { ScheduleCalendar } from './ScheduleCalendar'
import {
  eventToEntry,
  privateBookingToEntry,
  balanceDueToEntry,
  employeeBirthdayToEntry,
  specialHoursToEntry,
  calendarNoteToEntry,
  parkingToEntry,
} from './adapters'
import type {
  CalendarEntry,
  CalendarEntryKind,
  ScheduleCalendarView,
  ScheduleDailyOps,
} from './types'

export interface VenueCalendarEvent {
  id: string
  name: string
  date: string | null
  time: string | null
  bookedSeatsCount?: number
  eventStatus?: string | null
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

export interface VenueCalendarProps {
  events: VenueCalendarEvent[]
  privateBookings: VenueCalendarBooking[]
  balanceDueDates?: VenueCalendarBalanceDue[]
  employeeBirthdays?: VenueCalendarEmployeeBirthday[]
  specialHours?: VenueCalendarSpecialHours[]
  calendarNotes: VenueCalendarNote[]
  parkingBookings: VenueCalendarParking[]
  canCreateCalendarNote?: boolean
  onEmptyDayClick?: (date: Date) => void
  dailyOps?: ScheduleDailyOps
  header?: ReactNode
  className?: string
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
): CalendarEntry[] {
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
    out.push(parkingToEntry(booking))
  }

  return out
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
            <span className="font-medium">Event date:</span> {td.eventDate}
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
  canCreateCalendarNote,
  onEmptyDayClick,
  dailyOps,
  header,
  className,
}: VenueCalendarProps): ReactNode {
  const router = useRouter()
  const [view, setView] = useState<ScheduleCalendarView>('month')

  const entries = useMemo(
    () => buildEntries(events, privateBookings, balanceDueDates, employeeBirthdays, specialHours, calendarNotes, parkingBookings),
    [events, privateBookings, balanceDueDates, employeeBirthdays, specialHours, calendarNotes, parkingBookings],
  )

  const legendKinds = useMemo<CalendarEntryKind[]>(() => {
    const kinds: CalendarEntryKind[] = []
    if (calendarNotes.length > 0) kinds.push('calendar_note')
    if (specialHours.length > 0) kinds.push('special_hours')
    if (employeeBirthdays.length > 0) kinds.push('birthday')
    if (balanceDueDates.length > 0) kinds.push('balance_due')
    if (privateBookings.length > 0) kinds.push('private_booking')
    if (parkingBookings.length > 0) kinds.push('parking')
    kinds.push('event')
    return kinds
  }, [calendarNotes.length, specialHours.length, employeeBirthdays.length, balanceDueDates.length, privateBookings.length, parkingBookings.length])

  const hiddenCount = useMemo(() => {
    return (
      events.filter((e) => !e.date).length +
      calendarNotes.filter((n) => !n.note_date).length +
      privateBookings.filter((b) => !b.event_date).length +
      balanceDueDates.filter((b) => !b.balance_due_date).length +
      employeeBirthdays.filter((b) => !b.occurrence_date).length +
      specialHours.filter((h) => !h.date).length +
      parkingBookings.filter((p) => !p.start_at).length
    )
  }, [events, calendarNotes, privateBookings, balanceDueDates, employeeBirthdays, specialHours, parkingBookings])

  return (
    <div className={className}>
      {header}

      <ScheduleCalendar
        entries={entries}
        view={view}
        onViewChange={setView}
        canCreateCalendarNote={canCreateCalendarNote}
        onEmptyDayClick={onEmptyDayClick}
        onEntryClick={(entry) => {
          if (entry.onClickHref) router.push(entry.onClickHref)
        }}
        renderTooltip={renderTooltip}
        legendKinds={legendKinds}
        dailyOps={dailyOps}
        firstDayOfWeek={1}
      />

      {hiddenCount > 0 && (
        <p className="mt-2 text-xs text-gray-500">{hiddenCount} without a date (not shown)</p>
      )}
    </div>
  )
}
