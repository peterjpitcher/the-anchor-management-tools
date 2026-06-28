import type { ChecklistTodoItem, EventChecklistItem } from '@/lib/event-checklist'
import type { BookingStatus } from '@/types/private-bookings'

export type EventOverview = {
    id: string
    name: string
    date: string
    time: string
    daysUntil: number
    bookedSeatsCount: number
    category: { id: string; name: string; color: string } | null
    heroImageUrl: string | null
    posterImageUrl: string | null
    eventStatus: string | null
    bookingUrl: string | null
    checklist: {
        completed: number
        total: number
        overdueCount: number
        dueTodayCount: number
        nextTask: EventChecklistItem | null
        outstanding: EventChecklistItem[]
    }
    statusBadge: {
        label: string
        tone: 'success' | 'warning' | 'error' | 'info' | 'neutral'
    }
}

export type EventsOverviewResult = {
    kpis: {
        activeEvents: number
        overdueTasks: number
        dueTodayTasks: number
        draftEvents: number
    }
    upcoming: EventOverview[]
    past: EventOverview[]
    todos: ChecklistTodoItem[]
    privateBookingsForCalendar: PrivateBookingCalendarOverview[]
    calendarNotes: CalendarNoteCalendarOverview[]
    error?: string
}

export type PrivateBookingCalendarOverview = {
    id: string
    customer_name: string
    event_date: string
    start_time: string
    end_time: string | null
    end_time_next_day: boolean | null
    status: BookingStatus
    event_type: string | null
    guest_count: number | null
}

export type CalendarNoteCalendarOverview = {
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
