'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addHours, format } from 'date-fns'
import { LockClosedIcon } from '@heroicons/react/20/solid'
import {
  EventOverview,
  PrivateBookingCalendarOverview,
} from '@/app/(authenticated)/events/get-events-command-center'
import { EventCalendar, type CalendarEvent } from '@/components/ui-v2/display/Calendar'
import { Tooltip } from '@/components/ui-v2/overlay/Tooltip'

type CalendarViewMode = 'month' | 'week' | 'day'

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

export default function EventCalendarView({
  events,
  privateBookings,
}: {
  events: EventOverview[]
  privateBookings?: PrivateBookingCalendarOverview[]
}) {
  const router = useRouter()
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('month')

  const privateBookingsById = useMemo(() => {
    const map = new Map<string, PrivateBookingCalendarOverview>()
    for (const booking of privateBookings ?? []) {
      map.set(booking.id, booking)
    }
    return map
  }, [privateBookings])

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
        color,
        textColor: getReadableTextColor(color),
      }
    })

    return [...eventEntries, ...privateBookingEntries].sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [events, privateBookings])

  const hasPrivateBookings = (privateBookings ?? []).length > 0

  return (
    <div className="space-y-4">
      {events.length === 0 && !hasPrivateBookings && (
        <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-sm text-gray-500">No events found matching your criteria.</p>
        </div>
      )}

      {hasPrivateBookings && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-violet-500" />
            <LockClosedIcon className="h-4 w-4 text-violet-600" />
            Private bookings
          </span>
        </div>
      )}

      <EventCalendar
        events={calendarEvents}
        view={calendarView}
        onViewChange={setCalendarView}
        firstDayOfWeek={1}
        renderEvent={(event) => {
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
