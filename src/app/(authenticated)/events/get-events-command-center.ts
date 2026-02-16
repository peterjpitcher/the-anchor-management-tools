import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate, getLocalIsoDateDaysAhead } from '@/lib/dateUtils'
import { buildEventChecklist, EVENT_CHECKLIST_TOTAL_TASKS, ChecklistTodoItem, EventChecklistItem } from '@/lib/event-checklist'
import type { BookingStatus } from '@/types/private-bookings'

export type EventOverview = {
    id: string
    name: string
    date: string
    time: string
    daysUntil: number
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

type EventCategoryRow = {
    id: string
    name: string
    color: string
}

type CommandCenterEventRow = {
    id: string
    name: string
    date: string
    time: string
    booking_url: string | null
    poster_image_url: string | null
    hero_image_url: string | null
    event_status: string | null
    category: EventCategoryRow | EventCategoryRow[] | null
}

type ChecklistStatusRow = {
    event_id: string
    task_key: string
    completed_at: string | null
}

const COMMAND_CENTER_PAGE_SIZE = 1000

export async function getEventsCommandCenterData(): Promise<EventsOverviewResult> {
    const supabase = createAdminClient()
    const todayIso = getTodayIsoDate()
    const windowEndIso = getLocalIsoDateDaysAhead(30)

    const events: CommandCenterEventRow[] = []
    let eventsError: unknown = null
    for (let start = 0; ; start += COMMAND_CENTER_PAGE_SIZE) {
        const { data, error } = await supabase
            .from('events')
            .select(`
        id,
        name,
        date,
        time,
        booking_url,
        poster_image_url,
        hero_image_url,
        event_status,
        category:event_categories(id, name, color)
      `)
            .order('date', { ascending: true })
            .order('time', { ascending: true })
            .range(start, start + COMMAND_CENTER_PAGE_SIZE - 1)

        if (error) {
            eventsError = error
            break
        }

        const chunk = (data || []) as CommandCenterEventRow[]
        events.push(...chunk)
        if (chunk.length < COMMAND_CENTER_PAGE_SIZE) {
            break
        }
    }

    if (eventsError) {
        console.error('Error fetching events:', eventsError)
        return {
            kpis: { activeEvents: 0, overdueTasks: 0, dueTodayTasks: 0, draftEvents: 0 },
            upcoming: [],
            past: [],
            todos: [],
            privateBookingsForCalendar: [],
            calendarNotes: [],
            error: 'Failed to load events.'
        }
    }

    let calendarNotes: CalendarNoteCalendarOverview[] = []
    try {
        const { data: noteRows, error: notesError } = await supabase
            .from('calendar_notes')
            .select('id, note_date, end_date, title, notes, source, start_time, end_time, color')
            .order('note_date', { ascending: true })
            .order('end_date', { ascending: true })
            .order('start_time', { ascending: true, nullsFirst: true })
            .order('title', { ascending: true })

        if (notesError) {
            throw notesError
        }

        calendarNotes = (noteRows ?? []).map((row) => ({
            id: String(row.id),
            note_date: String(row.note_date),
            end_date: typeof row.end_date === 'string' ? row.end_date : String(row.note_date),
            title: String(row.title ?? ''),
            notes: typeof row.notes === 'string' ? row.notes : null,
            source: typeof row.source === 'string' ? row.source : 'manual',
            start_time: typeof row.start_time === 'string' ? row.start_time : null,
            end_time: typeof row.end_time === 'string' ? row.end_time : null,
            color: typeof row.color === 'string' ? row.color : '#0EA5E9',
        }))
    } catch (notesError) {
        console.error('Error fetching calendar notes:', notesError)
    }

    const checklistStatuses: ChecklistStatusRow[] = []
    let checklistError: unknown = null
    for (let start = 0; ; start += COMMAND_CENTER_PAGE_SIZE) {
        const { data, error } = await supabase
            .from('event_checklist_statuses')
            .select('event_id, task_key, completed_at')
            .order('event_id', { ascending: true })
            .order('task_key', { ascending: true })
            .range(start, start + COMMAND_CENTER_PAGE_SIZE - 1)

        if (error) {
            checklistError = error
            break
        }

        const chunk = (data || []) as ChecklistStatusRow[]
        checklistStatuses.push(...chunk)
        if (chunk.length < COMMAND_CENTER_PAGE_SIZE) {
            break
        }
    }

    if (checklistError) {
        console.error('Error fetching checklist statuses:', checklistError)
    }

    // Map statuses by Event ID
    const checklistStatusesForMap = checklistError ? [] : checklistStatuses
    const statusMap = new Map<string, { task_key: string; completed_at: string | null }[]>()
    checklistStatusesForMap.forEach((status) => {
        if (!statusMap.has(status.event_id)) {
            statusMap.set(status.event_id, [])
        }
        statusMap.get(status.event_id)?.push(status)
    })

    // --- KPI Calculations ---

    // 1. Active Events (Next 30 Days)
    const eventsInWindow = events.filter(e => (
        e.date >= todayIso &&
        e.date <= windowEndIso &&
        e.event_status !== 'cancelled' &&
        e.event_status !== 'draft'
    ))
    const activeEventsCount = eventsInWindow.length

    // --- View Model Mapping ---
    const mappedEvents: EventOverview[] = events.map(event => {
        const bookingUrl = typeof event.booking_url === 'string' ? event.booking_url : null

        // Checklist
        const eventStatuses = statusMap.get(event.id) || []
        const checklistItems = buildEventChecklist(
            { id: event.id, name: event.name, date: event.date },
            eventStatuses.map(s => ({ event_id: event.id, task_key: s.task_key, completed_at: s.completed_at })),
            todayIso
        )

        const completedCount = checklistItems.filter(i => i.completed).length
        const overdueCount = checklistItems.filter(i => i.status === 'overdue').length
        const dueTodayCount = checklistItems.filter(i => i.status === 'due_today').length
        const outstanding = checklistItems.filter(i => !i.completed)
        const nextTask = outstanding.length > 0 ? [...outstanding].sort((a, b) => a.order - b.order)[0] : null

        // Status Badge Logic
        let badgeLabel = 'On Track'
        let badgeTone: EventOverview['statusBadge']['tone'] = 'success'

        if (event.event_status === 'draft') {
            badgeLabel = 'Draft'
            badgeTone = 'neutral'
        } else if (event.event_status === 'cancelled' || event.event_status === 'postponed') {
            badgeLabel = event.event_status === 'cancelled' ? 'Cancelled' : 'Postponed'
            badgeTone = event.event_status === 'cancelled' ? 'error' : 'warning'
        } else if (overdueCount > 0) {
            badgeLabel = 'Overdue Tasks'
            badgeTone = 'warning'
        } else if (dueTodayCount > 0) {
            badgeLabel = 'Due Today'
            badgeTone = 'info'
        } else {
            badgeLabel = 'On Track'
            badgeTone = 'success'
        }

        // Days Until
        const daysUntil = Math.ceil((new Date(event.date).getTime() - new Date(todayIso).getTime()) / (1000 * 60 * 60 * 24))

        const categoryRecord = Array.isArray(event.category) ? event.category[0] : event.category

        return {
            id: event.id,
            name: event.name,
            date: event.date,
            time: event.time,
            daysUntil,
            category: categoryRecord ?? null,
            heroImageUrl: event.hero_image_url,
            posterImageUrl: event.poster_image_url,
            eventStatus: event.event_status,
            bookingUrl,
            checklist: {
                completed: completedCount,
                total: EVENT_CHECKLIST_TOTAL_TASKS,
                overdueCount,
                dueTodayCount,
                nextTask,
                outstanding
            },
            statusBadge: {
                label: badgeLabel,
                tone: badgeTone
            }
        }
    })

    const upcomingEvents = mappedEvents.filter((event) => event.date >= todayIso)
    const pastEvents = mappedEvents.filter((event) => event.date < todayIso)
    const totalOverdueTasks = upcomingEvents.reduce((sum, event) => sum + event.checklist.overdueCount, 0)
    const totalDueTodayTasks = upcomingEvents.reduce((sum, event) => sum + event.checklist.dueTodayCount, 0)
    const draftEvents = upcomingEvents.filter((event) => event.eventStatus === 'draft').length

    // Todos (for sidebar)
    const todos: ChecklistTodoItem[] = []
    upcomingEvents.forEach(event => {
        event.checklist.outstanding.forEach(item => {
            todos.push({
                ...item,
                eventName: event.name,
                eventDate: event.date
            })
        })
    })

    // Sort todos
    todos.sort((a, b) => a.dueDate.localeCompare(b.dueDate))

    return {
        kpis: {
            activeEvents: activeEventsCount,
            overdueTasks: totalOverdueTasks,
            dueTodayTasks: totalDueTodayTasks,
            draftEvents,
        },
        upcoming: upcomingEvents,
        past: pastEvents,
        todos,
        privateBookingsForCalendar: [],
        calendarNotes,
        error: undefined
    }
}
