'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addHours, format } from 'date-fns'
import { CalendarDaysIcon, LockClosedIcon, TruckIcon } from '@heroicons/react/20/solid'
import { EventCalendar, type CalendarEvent } from '@/components/ui-v2/display/Calendar'
import { Tooltip } from '@/components/ui-v2/overlay/Tooltip'

type DashboardEventSummary = {
  id: string
  name: string
  date: string | null
  time: string | null
}

type DashboardPrivateBookingSummary = {
  id: string
  customer_name: string | null
  event_date: string | null
  start_time: string | null
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

const EVENT_ID_PREFIX = 'evt:'
const PRIVATE_BOOKING_ID_PREFIX = 'pb:'
const PARKING_ID_PREFIX = 'park:'

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

function getReadableTextColor(backgroundColor: string): string {
  const normalized = normalizeHexColor(backgroundColor)
  if (!normalized) return 'white'

  const r = parseInt(normalized.slice(1, 3), 16)
  const g = parseInt(normalized.slice(3, 5), 16)
  const b = parseInt(normalized.slice(5, 7), 16)
  if ([r, g, b].some(Number.isNaN)) return 'white'

  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness >= 160 ? '#111827' : 'white'
}

function parseLocalDateTime(dateIso: string, time: string | null) {
  const [yearStr, monthStr, dayStr] = dateIso.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  const day = Number(dayStr)

  const [hourStr, minuteStr] = (time || '00:00').split(':').slice(0, 2)
  const hours = Number(hourStr)
  const minutes = Number(minuteStr)

  return new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(monthIndex) ? monthIndex : new Date().getMonth(),
    Number.isFinite(day) ? day : new Date().getDate(),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
  )
}

function formatStatusLabel(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getPrivateBookingColor(status: string | null | undefined): string {
  switch (status) {
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

function getParkingColor(booking: DashboardParkingBookingSummary): string {
  if (booking.payment_status === 'pending') return '#f59e0b'
  if (booking.status === 'pending_payment') return '#f59e0b'
  return '#64748b'
}

export default function UpcomingScheduleCalendar({
  events,
  privateBookings,
  parkingBookings,
}: {
  events: DashboardEventSummary[]
  privateBookings: DashboardPrivateBookingSummary[]
  parkingBookings: DashboardParkingBookingSummary[]
}) {
  const router = useRouter()
  const [view, setView] = useState<'month' | 'week' | 'day'>('month')

  const eventsById = useMemo(() => {
    const map = new Map<string, DashboardEventSummary>()
    for (const event of events) {
      map.set(event.id, event)
    }
    return map
  }, [events])

  const privateBookingsById = useMemo(() => {
    const map = new Map<string, DashboardPrivateBookingSummary>()
    for (const booking of privateBookings) {
      map.set(booking.id, booking)
    }
    return map
  }, [privateBookings])

  const parkingById = useMemo(() => {
    const map = new Map<string, DashboardParkingBookingSummary>()
    for (const booking of parkingBookings) {
      map.set(booking.id, booking)
    }
    return map
  }, [parkingBookings])

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const entries: CalendarEvent[] = []

    for (const event of events) {
      if (!event.date) continue

      const allDay = !event.time
      const start = parseLocalDateTime(event.date, event.time)
      const end = allDay ? new Date(start) : addHours(start, 2)
      const color = '#3b82f6'

      entries.push({
        id: `${EVENT_ID_PREFIX}${event.id}`,
        title: event.name,
        start,
        end,
        allDay,
        color,
        textColor: getReadableTextColor(color),
      })
    }

    for (const booking of privateBookings) {
      if (!booking.event_date) continue

      const allDay = !booking.start_time
      const start = parseLocalDateTime(booking.event_date, booking.start_time)
      const end = allDay ? new Date(start) : addHours(start, 3)
      const color = getPrivateBookingColor(booking.status)

      const statusLabel = booking.status === 'confirmed' ? '' : ` (${formatStatusLabel(booking.status)})`

      entries.push({
        id: `${PRIVATE_BOOKING_ID_PREFIX}${booking.id}`,
        title: `${booking.customer_name || 'Guest'}${statusLabel}`,
        start,
        end,
        allDay,
        showOnStartDayOnly: true,
        color,
        textColor: getReadableTextColor(color),
      })
    }

    for (const booking of parkingBookings) {
      if (!booking.start_at) continue

      const start = new Date(booking.start_at)
      const end = booking.end_at ? new Date(booking.end_at) : addHours(start, 2)
      const color = getParkingColor(booking)

      const title = booking.vehicle_registration || booking.reference || 'Parking booking'

      entries.push({
        id: `${PARKING_ID_PREFIX}${booking.id}`,
        title,
        start,
        end,
        color,
        textColor: getReadableTextColor(color),
      })
    }

    return entries.sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [events, parkingBookings, privateBookings])

  const hiddenCount = useMemo(() => {
    const hiddenEvents = events.filter((event) => !event.date).length
    const hiddenBookings = privateBookings.filter((booking) => !booking.event_date).length
    const hiddenParking = parkingBookings.filter((booking) => !booking.start_at).length
    return hiddenEvents + hiddenBookings + hiddenParking
  }, [events, parkingBookings, privateBookings])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-blue-500" />
          Events
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-violet-500" />
          Private bookings
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-slate-500" />
          Parking
        </span>
        {hiddenCount > 0 && <span className="text-gray-500">• {hiddenCount} without a date (not shown)</span>}
      </div>

      <EventCalendar
        className="border-0"
        events={calendarEvents}
        view={view}
        onViewChange={setView}
        firstDayOfWeek={1}
        renderEvent={(event) => {
          const isPrivateBooking = event.id.startsWith(PRIVATE_BOOKING_ID_PREFIX)
          const isParking = event.id.startsWith(PARKING_ID_PREFIX)

          const icon = isPrivateBooking ? (
            <LockClosedIcon className="h-3 w-3 flex-none" />
          ) : isParking ? (
            <TruckIcon className="h-3 w-3 flex-none" />
          ) : (
            <CalendarDaysIcon className="h-3 w-3 flex-none" />
          )

          const tooltipContent = (() => {
            if (event.id.startsWith(EVENT_ID_PREFIX)) {
              const rawId = event.id.slice(EVENT_ID_PREFIX.length)
              const item = eventsById.get(rawId)
              return (
                <div className="space-y-1 text-xs">
                  <div className="font-medium">Event</div>
                  <div className="whitespace-pre-wrap">{item?.name ?? event.title}</div>
                  <div>
                    {format(event.start, 'EEE d MMM yyyy')}
                    {!event.allDay && ` • ${format(event.start, 'HH:mm')}`}
                  </div>
                </div>
              )
            }

            if (event.id.startsWith(PRIVATE_BOOKING_ID_PREFIX)) {
              const rawId = event.id.slice(PRIVATE_BOOKING_ID_PREFIX.length)
              const booking = privateBookingsById.get(rawId)
              const statusLabel = booking ? formatStatusLabel(booking.status) : 'Private booking'
              return (
                <div className="space-y-1 text-xs">
                  <div className="font-medium">Private booking • {statusLabel}</div>
                  <div className="whitespace-pre-wrap">{booking?.customer_name ?? event.title}</div>
                  <div>
                    {format(event.start, 'EEE d MMM yyyy')}
                    {!event.allDay && ` • ${format(event.start, 'HH:mm')}`}
                  </div>
                  {booking?.deposit_status && <div>Deposit: {booking.deposit_status}</div>}
                  {booking?.hold_expiry && booking?.status === 'draft' && (
                    <div>Hold expires: {format(new Date(booking.hold_expiry), 'EEE d MMM yyyy')}</div>
                  )}
                  {booking?.balance_due_date && booking?.status === 'confirmed' && (
                    <div>Balance due: {format(parseLocalDateTime(booking.balance_due_date, null), 'EEE d MMM yyyy')}</div>
                  )}
                  {typeof booking?.days_until_event === 'number' && <div>{booking.days_until_event} days until event</div>}
                </div>
              )
            }

            if (event.id.startsWith(PARKING_ID_PREFIX)) {
              const rawId = event.id.slice(PARKING_ID_PREFIX.length)
              const booking = parkingById.get(rawId)
              const customerName =
                booking?.customer_first_name || booking?.customer_last_name
                  ? `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim()
                  : null
              return (
                <div className="space-y-1 text-xs">
                  <div className="font-medium">Parking</div>
                  <div className="whitespace-pre-wrap">{booking?.vehicle_registration || booking?.reference || event.title}</div>
                  <div>
                    {format(event.start, 'EEE d MMM yyyy • HH:mm')}–{format(event.end, 'HH:mm')}
                  </div>
                  {customerName && <div>Customer: {customerName}</div>}
                  {booking?.payment_status && <div>Payment: {formatStatusLabel(booking.payment_status)}</div>}
                </div>
              )
            }

            return <div className="text-xs whitespace-pre-wrap">{event.title}</div>
          })()

          return (
            <Tooltip content={tooltipContent} placement="top" delay={250} maxWidth={360}>
              <span className="inline-flex min-w-0 items-center gap-1">
                {icon}
                <span className="truncate">{event.title}</span>
              </span>
            </Tooltip>
          )
        }}
        onEventClick={(event) => {
          if (event.id.startsWith(EVENT_ID_PREFIX)) {
            router.push(`/events/${event.id.slice(EVENT_ID_PREFIX.length)}`)
            return
          }

          if (event.id.startsWith(PRIVATE_BOOKING_ID_PREFIX)) {
            router.push(`/private-bookings/${event.id.slice(PRIVATE_BOOKING_ID_PREFIX.length)}`)
            return
          }

          if (event.id.startsWith(PARKING_ID_PREFIX)) {
            router.push('/parking')
          }
        }}
      />
    </div>
  )
}
