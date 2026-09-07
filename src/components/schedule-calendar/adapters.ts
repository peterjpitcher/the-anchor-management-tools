// src/components/schedule-calendar/adapters.ts
import { addHours, differenceInCalendarDays, format } from 'date-fns'
import type {
    EventOverview,
    PrivateBookingCalendarOverview,
    CalendarNoteCalendarOverview,
} from '@/app/(authenticated)/events/get-events-command-center'
import type { CalendarEntry, CalendarEntryContent, CalendarEntryStatus } from './types'
import { kindColor } from './appearance'
import { formatTimeInLondon, toLocalIsoDate as toLondonIsoDate } from '@/lib/dateUtils'

// --- Helpers ---

function parseLocalDate(isoDate: string, time: string = '00:00'): Date {
    // Europe/London wall-clock. ISO date parts + time -> local Date.
    // Guarded: date-fns v4 format() THROWS on an Invalid Date, so one malformed
    // row would take down the whole calendar rather than just itself. NaN also
    // slips past `?? 1`, so check explicitly.
    const [y, m, d] = isoDate.split('-').map(Number)
    const [hh, mm] = time.split(':').slice(0, 2).map(Number)
    const year = Number.isFinite(y) ? y : NaN
    const month = Number.isFinite(m) ? m : 1
    const day = Number.isFinite(d) ? d : 1
    const hours = Number.isFinite(hh) ? hh : 0
    const minutes = Number.isFinite(mm) ? mm : 0
    if (!Number.isFinite(year)) return new Date(NaN)
    const parsed = new Date(year, month - 1, day, hours, minutes)
    // Round-trip check: JavaScript silently rolls 2026-02-31 into March.
    if (parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return new Date(NaN)
    return parsed
}

function statusFromString(s: string | null | undefined): CalendarEntryStatus {
    if (!s) return null
    if (
        [
            'scheduled',
            'draft',
            'confirmed',
            'pending_payment',
            'pending_card_capture',
            'sold_out',
            'postponed',
            'rescheduled',
            'cancelled',
            'no_show',
            'completed',
            'visited_waiting_for_review',
            'review_clicked',
        ].includes(s)
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
        case 'pending_payment':
            return 'Pending payment'
        case 'pending_card_capture':
            return 'Pending card capture'
        case 'postponed':
            return 'Postponed'
        case 'rescheduled':
            return 'Rescheduled'
        case 'cancelled':
            return 'Cancelled'
        case 'no_show':
            return 'No-show'
        case 'completed':
            return 'Completed'
        case 'visited_waiting_for_review':
            return 'Visited'
        case 'review_clicked':
            return 'Review clicked'
        default:
            return null
    }
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        maximumFractionDigits: 0,
    }).format(value)
}

/**
 * Content readiness for an event, or undefined when the caller supplied none.
 *
 * Undefined means "we did not load this", which is NOT the same as "loaded and
 * missing". `entryGaps` returns [] for an absent record but all three gaps for a
 * record of `false`s, so defaulting to false makes every event on a caller that
 * does not load readiness claim it needs artwork, a brief and a description. The
 * dashboard shipped exactly that bug.
 *
 * Only the three explicit flags count. Image URLs are deliberately not used as a
 * fallback: a caller that has not loaded them passes null, which is
 * indistinguishable from "no artwork".
 */
function resolveEventContent(event: EventOverview): CalendarEntryContent | undefined {
    if (
        event.hasImage === undefined &&
        event.hasBrief === undefined &&
        event.hasDescription === undefined
    ) {
        return undefined
    }

    // A partially supplied record reports gaps only for what was actually
    // loaded; anything unknown defaults to "present" so it raises no false flag.
    return {
        hasImage: event.hasImage ?? true,
        hasBrief: event.hasBrief ?? true,
        hasDescription: event.hasDescription ?? true,
    }
}

// --- Event ---

export function eventToEntry(event: EventOverview): CalendarEntry {
    const start = parseLocalDate(event.date, event.time || '00:00')
    const end = addHours(start, 2) // D9 — fixed 2h
    const status = statusFromString(event.eventStatus ?? 'scheduled')
    const content = resolveEventContent(event)
    return {
        id: `evt:${event.id}`,
        kind: 'event',
        title: event.name,
        start,
        end,
        allDay: false,
        spansMultipleDays: false,
        endsNextDay: false,
        color: kindColor('event'),
        subtitle: `${event.bookedSeatsCount ?? 0} booked`,
        status,
        statusLabel: statusLabel(status),
        // Content readiness is OPTIONAL on purpose. A caller that does not load
        // the readiness columns must not have its events reported as missing
        // everything: `entryGaps` returns [] when `content` is absent, but would
        // return all three gaps for a record of `false`s. The dashboard shipped
        // exactly that bug, showing "No artwork / No brief / No description" on
        // every event it rendered.
        ...(content ? { content } : {}),
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
        color: kindColor('private_booking'),
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

// --- Private booking balance due (dashboard only) ---

export interface DashboardBalanceDueInput {
    id: string
    customer_name: string | null
    balance_due_date: string
    event_date: string | null
    status: string | null
    total_amount: number | null
}

export function balanceDueToEntry(booking: DashboardBalanceDueInput): CalendarEntry {
    const start = parseLocalDate(booking.balance_due_date)
    const customerName = booking.customer_name || 'Private booking'
    const amount = booking.total_amount != null ? Number(booking.total_amount) : null

    return {
        id: `balance:${booking.id}`,
        kind: 'balance_due',
        title: `Balance due: ${customerName}`,
        start,
        end: start,
        allDay: true,
        spansMultipleDays: false,
        endsNextDay: false,
        color: kindColor('balance_due'),
        subtitle: amount != null && Number.isFinite(amount) ? formatCurrency(amount) : null,
        status: statusFromString(booking.status),
        statusLabel: statusLabel(statusFromString(booking.status)),
        tooltipData: {
            kind: 'balance_due',
            customerName,
            amount: amount != null && Number.isFinite(amount) ? amount : null,
            eventDate: booking.event_date,
            status: booking.status,
        },
        onClickHref: `/private-bookings/${booking.id}`,
    }
}

// --- Employee birthday (dashboard only) ---

export interface DashboardEmployeeBirthdayInput {
    employee_id: string
    employee_name: string
    occurrence_date: string
    turning_age: number | null
    job_title: string | null
}

export function employeeBirthdayToEntry(birthday: DashboardEmployeeBirthdayInput): CalendarEntry {
    const start = parseLocalDate(birthday.occurrence_date)

    return {
        id: `birthday:${birthday.employee_id}:${birthday.occurrence_date}`,
        kind: 'birthday',
        title: `${birthday.employee_name} birthday`,
        start,
        end: start,
        allDay: true,
        spansMultipleDays: false,
        endsNextDay: false,
        color: kindColor('birthday'),
        subtitle: birthday.turning_age != null ? `Turns ${birthday.turning_age}` : null,
        status: null,
        statusLabel: null,
        tooltipData: {
            kind: 'birthday',
            employeeName: birthday.employee_name,
            turningAge: birthday.turning_age,
            jobTitle: birthday.job_title,
        },
        onClickHref: `/employees/${birthday.employee_id}`,
    }
}

// --- Special hours / holidays (dashboard only) ---

export interface DashboardSpecialHoursInput {
    id: string
    date: string
    opens: string | null
    closes: string | null
    is_closed: boolean
    is_kitchen_closed: boolean
    note: string | null
}

export function specialHoursToEntry(specialHours: DashboardSpecialHoursInput): CalendarEntry {
    const start = parseLocalDate(specialHours.date)
    const timeRange = specialHours.opens && specialHours.closes
        ? `${specialHours.opens.slice(0, 5)}–${specialHours.closes.slice(0, 5)}`
        : null
    const title = specialHours.note
        || (specialHours.is_closed
            ? 'Closed'
            : specialHours.is_kitchen_closed
                ? 'Kitchen closed'
                : 'Special opening hours')

    return {
        id: `special:${specialHours.id}`,
        kind: 'special_hours',
        title,
        start,
        end: start,
        allDay: true,
        spansMultipleDays: false,
        endsNextDay: false,
        color: kindColor('special_hours'),
        subtitle: specialHours.is_closed ? 'Closed' : timeRange,
        status: null,
        statusLabel: null,
        tooltipData: {
            kind: 'special_hours',
            title,
            note: specialHours.note,
            date: specialHours.date,
            timeRange,
            isClosed: specialHours.is_closed,
            isKitchenClosed: specialHours.is_kitchen_closed,
        },
        onClickHref: '/settings/business-hours',
    }
}

// --- Calendar note ---

export function calendarNoteToEntry(note: CalendarNoteCalendarOverview): CalendarEntry {
    const hasStartTime = Boolean(note.start_time)
    const start = parseLocalDate(note.note_date, note.start_time || '00:00')
    const rawEnd = note.end_time
        ? parseLocalDate(note.end_date || note.note_date, note.end_time)
        : hasStartTime
            ? addHours(start, 1)
            : parseLocalDate(note.end_date || note.note_date)
    const end = rawEnd.getTime() < start.getTime() ? start : rawEnd // clamp corrupt ranges
    const spansMultipleDays = start.toDateString() !== end.toDateString()
    const dateRange = spansMultipleDays
        ? `${format(start, 'EEE d MMM yyyy')} – ${format(end, 'EEE d MMM yyyy')}`
        : format(start, 'EEE d MMM yyyy')
    return {
        id: `note:${note.id}`,
        kind: 'calendar_note',
        title: note.title,
        start,
        end,
        allDay: !hasStartTime,
        spansMultipleDays,
        endsNextDay: false,
        color: note.color || kindColor('calendar_note'),
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

/**
 * Parking is the only kind built from an instant rather than a calendar date.
 * `new Date(timestamptz)` plus host-local formatting puts a late-evening booking
 * on the wrong day for anyone whose device is not on London time, and under
 * `npm run test:utc`. Convert to the London wall clock first, then build the
 * same host-local Date every other adapter builds, so the month grid and the
 * list agree with the rest of the calendar.
 */
function londonWallClock(instant: Date): Date {
    return parseLocalDate(toLondonIsoDate(instant), formatTimeInLondon(instant))
}

export function parkingToEntry(booking: DashboardParkingInput): CalendarEntry | null {
    // No start instant means we cannot place it on a day. Returning null is
    // honest; the previous `new Date()` fallback silently parked it on today.
    if (!booking.start_at) return null
    const startInstant = new Date(booking.start_at)
    if (Number.isNaN(startInstant.getTime())) return null

    const start = londonWallClock(startInstant)
    const endInstant = booking.end_at ? new Date(booking.end_at) : null
    const end =
        endInstant && !Number.isNaN(endInstant.getTime())
            ? londonWallClock(endInstant)
            : addHours(start, 2)
    const spansMultipleDays = start.toDateString() !== end.toDateString()
    const customerName =
        [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' ') || 'Parking'
    const timeRange = `${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`
    const status = statusFromString(booking.status)
    return {
        id: `park:${booking.id}`,
        kind: 'parking',
        title: booking.reference ? `${booking.reference} · ${customerName}` : customerName,
        start,
        end,
        allDay: spansMultipleDays,
        spansMultipleDays,
        // "+1 day" is only true when it actually ends the next day. A booking
        // running a fortnight was previously labelled "+1 day".
        endsNextDay: spansMultipleDays && differenceInCalendarDays(end, start) === 1,
        color: kindColor('parking'),
        subtitle: booking.vehicle_registration ?? null,
        // Carry the real status so a cancelled or expired booking is struck
        // through and can be hidden by the "Hide cancelled" filter, instead of
        // rendering as a live green block that no filter can touch.
        status,
        statusLabel: statusLabel(status),
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
