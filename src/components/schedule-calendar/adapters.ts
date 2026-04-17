// src/components/schedule-calendar/adapters.ts
import { addHours, format } from 'date-fns'
import type {
    EventOverview,
    PrivateBookingCalendarOverview,
    CalendarNoteCalendarOverview,
} from '@/app/(authenticated)/events/get-events-command-center'
import type { CalendarEntry, CalendarEntryStatus } from './types'

// --- Helpers ---

function parseLocalDate(isoDate: string, time: string = '00:00'): Date {
    // Europe/London wall-clock. ISO date parts + time -> local Date.
    const [y, m, d] = isoDate.split('-').map(Number)
    const [hh, mm] = time.split(':').slice(0, 2).map(Number)
    return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0)
}

function statusFromString(s: string | null | undefined): CalendarEntryStatus {
    if (!s) return null
    if (
        ['scheduled', 'draft', 'confirmed', 'sold_out', 'postponed', 'rescheduled', 'cancelled'].includes(s)
    ) {
        return s as CalendarEntryStatus
    }
    return null
}

function statusLabel(s: CalendarEntryStatus): string | null {
    switch (s) {
        case 'draft':
            return 'Draft'
        case 'sold_out':
            return 'Sold out'
        case 'postponed':
            return 'Postponed'
        case 'rescheduled':
            return 'Rescheduled'
        case 'cancelled':
            return 'Cancelled'
        default:
            return null
    }
}

// --- Event ---

export function eventToEntry(event: EventOverview): CalendarEntry {
    const start = parseLocalDate(event.date, event.time || '00:00')
    const end = addHours(start, 2) // D9 — fixed 2h
    const status = statusFromString(event.eventStatus ?? 'scheduled')
    const color = event.category?.color ?? '#22c55e'
    return {
        id: `evt:${event.id}`,
        kind: 'event',
        title: event.name,
        start,
        end,
        allDay: false,
        spansMultipleDays: false,
        endsNextDay: false,
        color,
        subtitle: `${event.bookedSeatsCount ?? 0} booked`,
        status,
        statusLabel: statusLabel(status),
        tooltipData: {
            kind: 'event',
            name: event.name,
            time: event.time,
            bookedSeats: event.bookedSeatsCount ?? 0,
            category: event.category?.name ?? null,
            status,
        },
        onClickHref: `/events/${event.id}`,
    }
}

// --- Private booking ---

export function privateBookingToEntry(booking: PrivateBookingCalendarOverview): CalendarEntry {
    const start = parseLocalDate(booking.event_date, booking.start_time || '00:00')
    let end: Date
    if (booking.end_time) {
        const [eh, em] = booking.end_time.split(':').slice(0, 2).map(Number)
        end = new Date(start)
        if (booking.end_time_next_day) end.setDate(end.getDate() + 1)
        end.setHours(eh ?? 0, em ?? 0, 0, 0)
    } else {
        end = addHours(start, 2)
    }
    const status = statusFromString(booking.status ?? 'confirmed')
    const timeRange = booking.end_time
        ? `${booking.start_time}–${booking.end_time}${booking.end_time_next_day ? ' (+1 day)' : ''}`
        : booking.start_time || ''
    const subtitle = booking.guest_count != null ? `${booking.guest_count} guests` : null
    return {
        id: `pb:${booking.id}`,
        kind: 'private_booking',
        title: booking.customer_name,
        start,
        end,
        allDay: false,
        spansMultipleDays: false, // overnight is NOT multi-day — D11
        endsNextDay: Boolean(booking.end_time_next_day),
        color: '#8b5cf6',
        subtitle,
        status,
        statusLabel: statusLabel(status),
        tooltipData: {
            kind: 'private_booking',
            customerName: booking.customer_name,
            eventType: booking.event_type ?? null,
            guestCount: booking.guest_count ?? null,
            timeRange,
            endsNextDay: Boolean(booking.end_time_next_day),
        },
        onClickHref: `/private-bookings/${booking.id}`,
    }
}

// --- Calendar note ---

export function calendarNoteToEntry(note: CalendarNoteCalendarOverview): CalendarEntry {
    const start = parseLocalDate(note.note_date)
    const rawEnd = parseLocalDate(note.end_date || note.note_date)
    const end = rawEnd.getTime() < start.getTime() ? start : rawEnd // clamp corrupt ranges
    const spansMultipleDays = end.getTime() > start.getTime()
    const dateRange = spansMultipleDays
        ? `${format(start, 'EEE d MMM yyyy')} – ${format(end, 'EEE d MMM yyyy')}`
        : format(start, 'EEE d MMM yyyy')
    return {
        id: `note:${note.id}`,
        kind: 'calendar_note',
        title: note.title,
        start,
        end,
        allDay: true,
        spansMultipleDays,
        endsNextDay: false,
        color: note.color || '#0EA5E9',
        subtitle: null,
        status: null,
        statusLabel: null,
        tooltipData: {
            kind: 'calendar_note',
            title: note.title,
            dateRange,
            notes: note.notes ?? null,
            source: note.source === 'ai' ? 'ai' : 'manual',
        },
        onClickHref: null,
    }
}

// --- Parking (dashboard only) ---

export interface DashboardParkingInput {
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

export function parkingToEntry(booking: DashboardParkingInput): CalendarEntry {
    const start = booking.start_at ? new Date(booking.start_at) : new Date()
    const end = booking.end_at ? new Date(booking.end_at) : addHours(start, 2)
    const customerName =
        [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' ') || 'Parking'
    const timeRange = `${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`
    return {
        id: `park:${booking.id}`,
        kind: 'parking',
        title: booking.reference ? `${booking.reference} · ${customerName}` : customerName,
        start,
        end,
        allDay: false,
        spansMultipleDays: start.toDateString() !== end.toDateString(),
        endsNextDay: false,
        color: '#14b8a6',
        subtitle: booking.vehicle_registration ?? null,
        status: null,
        statusLabel: null,
        tooltipData: {
            kind: 'parking',
            reference: booking.reference ?? null,
            customerName,
            vehicleReg: booking.vehicle_registration ?? null,
            timeRange,
            status: booking.status ?? null,
        },
        onClickHref: '/parking',
    }
}
