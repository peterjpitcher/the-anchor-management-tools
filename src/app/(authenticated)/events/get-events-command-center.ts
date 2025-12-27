import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate, getLocalIsoDateDaysAhead, getLocalIsoDateDaysAgo } from '@/lib/dateUtils'
import { buildEventChecklist, EVENT_CHECKLIST_TOTAL_TASKS, ChecklistTodoItem, EventChecklistItem } from '@/lib/event-checklist'

export type EventOverview = {
    id: string
    name: string
    date: string
    time: string
    daysUntil: number
    capacity: number | null
    bookedSeats: number
    price: number | null
    isFree: boolean
    category: { id: string; name: string; color: string } | null
    heroImageUrl: string | null
    posterImageUrl: string | null
    eventStatus: string | null
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
        last24hSeats: number
        velocityPercent: number | null
        urgentAttention: number
        revenueEstimate: number
    }
    upcoming: EventOverview[]
    past: EventOverview[]
    todos: ChecklistTodoItem[]
    error?: string
}

export async function getEventsCommandCenterData(): Promise<EventsOverviewResult> {
    const supabase = createAdminClient()
    const todayIso = getTodayIsoDate()
    const windowEndIso = getLocalIsoDateDaysAhead(30)
    const pastWindowIso = getLocalIsoDateDaysAgo(7) // For recent past events if needed, but mainly we focus on upcoming.

    // 1. Parallel Fetching
    const [eventsResult, velocityResult, checklistResult] = await Promise.all([
        // Fetch Events (Upcoming + sliver of past for context if needed, but primarily >= today)
        // "Range: date >= today" per plan. But let's fetch a bit of past if needed for "recent" lists, 
        // though the plan emphasizes "Approaching" and "Future".
        // Let's stick to >= today for the main KPIs.
        supabase
            .from('events')
            .select(`
        id,
        name,
        date,
        time,
        capacity,
        price,
        poster_image_url,
        hero_image_url,
        event_status,
        category:event_categories(id, name, color),
        booking_totals:bookings(sum:seats)
      `)
            .gte('date', todayIso)
            .order('date', { ascending: true })
            .order('time', { ascending: true }),

        // Fetch Velocity (Bookings in last 24h)
        // We need to know which event these bookings belong to, to verify they are for UPCOMING events?
        // The plan says "Join events to ensure only bookings for upcoming events".
        // Since we can't easily join in a single simple query without foreign table filters which can be tricky with aggregates,
        // let's just fetch recent bookings and filter in memory or assume all recent sales match "current" inventory.
        // Better: Fetch recent bookings with their event.date via join.
        supabase
            .from('bookings')
            .select(`
        seats,
        event:events!inner(date, capacity)
      `)
            .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),

        // We might want to filter the event date in the velocity join too, but let's accept all recent sales 
        // as "velocity" for simplicity unless strict upcoming-only is required. 
        // Plan: "velocityPercent = capacityTotal > 0 ? (last24hSeats / capacityTotal) : null"
        // capacityTotal is based on UPCOMING events 30 days.

        // Fetch Checklist Statuses for UPCOMING events (we'll filter IDs after getting events? 
        // Or just fetch all statuses for events in range? 
        // Better to fetch events first then statuses, but for parallelism we can fetch all statuses for events >= today?
        // Checklists table might be large. 
        // Let's optimize: Fetch events first, then statuses?
        // Plan suggests parallel. Let's fetch statuses for events >= today. 
        // But we can't filter statuses by event date directly without a join.
        supabase
            .from('event_checklist_statuses')
            .select('event_id, task_key, completed_at, event:events!inner(date)')
            .gte('event.date', todayIso)
    ])

    if (eventsResult.error) {
        console.error('Error fetching events:', eventsResult.error)
        return {
            kpis: { activeEvents: 0, last24hSeats: 0, velocityPercent: 0, urgentAttention: 0, revenueEstimate: 0 },
            upcoming: [],
            past: [],
            todos: [],
            error: 'Failed to load events.'
        }
    }

    const events = eventsResult.data || []
    const velocityBookings = velocityResult.data || []
    const checklistStatuses = checklistResult.data || []

    // Map statuses by Event ID
    const statusMap = new Map<string, { task_key: string; completed_at: string | null }[]>()
    checklistStatuses.forEach((status: any) => {
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

    // 2. Ticket Velocity
    // bookings in last 24h.
    // Filter for events that are actually in our "upcoming" window? 
    // Plan: "last24hSeats... AND events.date BETWEEN today AND today+30".
    const velocityBookingsFiltered = velocityBookings.filter((b: any) => {
        const d = b.event?.date
        return d && d >= todayIso && d <= windowEndIso
    })
    const last24hSeats = velocityBookingsFiltered.reduce((sum, b) => sum + (b.seats || 0), 0)

    const capacityTotal = eventsInWindow.reduce((sum, e) => {
        return sum + (e.capacity || 0)
    }, 0)

    const velocityPercent = capacityTotal > 0 ? Math.round((last24hSeats / capacityTotal) * 100) : null

    // 3. Revenue Estimate (30 days)
    const revenueEstimate = eventsInWindow.reduce((sum, e) => {
        const seats = (e.booking_totals as any[])?.reduce((acc: number, curr: { sum: number }) => acc + (curr.sum || 0), 0) || 0
        const price = e.price || 0
        return sum + (seats * price)
    }, 0)


    // --- View Model Mapping ---
    const mappedEvents: EventOverview[] = events.map(event => {
        const bookedSeats = (event.booking_totals as any[])?.reduce((acc: number, curr: { sum: number }) => acc + (curr.sum || 0), 0) || 0
        const capacity = event.capacity
        const price = event.price
        const isFree = !price || price === 0

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
        const nextTask = outstanding.length > 0 ? outstanding.sort((a, b) => a.order - b.order)[0] : null // Simplified sort

        // Status Badge Logic
        let badgeLabel = 'On Track'
        let badgeTone: EventOverview['statusBadge']['tone'] = 'neutral' // Changed default from info to neutral or success-like

        if (event.event_status === 'draft') {
            badgeLabel = 'Draft'
            badgeTone = 'neutral'
        } else if (event.event_status === 'cancelled' || event.event_status === 'postponed') {
            badgeLabel = event.event_status === 'cancelled' ? 'Cancelled' : 'Postponed'
            badgeTone = 'error'
        } else if (capacity && bookedSeats >= capacity) {
            badgeLabel = 'Sold Out'
            badgeTone = 'success' // or neutral dark
        } else if (capacity && (bookedSeats / capacity) >= 0.8) {
            badgeLabel = 'Selling Fast'
            badgeTone = 'success'
        } else {
            // "Low Bookings" check: 0 bookings and within 7 days
            const daysUntil = Math.ceil((new Date(event.date).getTime() - new Date(todayIso).getTime()) / (1000 * 60 * 60 * 24))
            if (bookedSeats === 0 && daysUntil <= 7 && daysUntil >= 0) {
                badgeLabel = 'Low Bookings'
                badgeTone = 'warning'
            } else {
                badgeLabel = 'On Track'
                badgeTone = 'info'
            }
        }

        // Days Until
        const daysUntil = Math.ceil((new Date(event.date).getTime() - new Date(todayIso).getTime()) / (1000 * 60 * 60 * 24))

        return {
            id: event.id,
            name: event.name,
            date: event.date,
            time: event.time,
            daysUntil,
            capacity,
            bookedSeats,
            price,
            isFree,
            category: event.category as any,
            heroImageUrl: event.hero_image_url,
            posterImageUrl: event.poster_image_url,
            eventStatus: event.event_status,
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

    // 4. Urgent Attention (Overdue Tasks + Low Bookings in Window)
    // Plan: overdueChecklistCount + zeroBookingCloseCount
    // We need to sum these up across ALL upcoming events (or just window?)
    // Plan says "Urgent Attention: overdue checklist items plus events with 0 bookings within X days" 
    // The query for events was gte today.

    const totalOverdueTasks = mappedEvents.reduce((sum, e) => sum + e.checklist.overdueCount, 0)
    const lowBookingsEvents = mappedEvents.filter(e => e.statusBadge.label === 'Low Bookings').length
    const urgentAttention = totalOverdueTasks + lowBookingsEvents

    // Todos (for sidebar)
    const todos: ChecklistTodoItem[] = []
    mappedEvents.forEach(e => {
        e.checklist.outstanding.forEach(item => {
            todos.push({
                ...item,
                eventName: e.name,
                eventDate: e.date
            })
        })
    })

    // Sort todos
    todos.sort((a, b) => a.dueDate.localeCompare(b.dueDate))

    return {
        kpis: {
            activeEvents: activeEventsCount,
            last24hSeats,
            velocityPercent,
            urgentAttention,
            revenueEstimate
        },
        upcoming: mappedEvents.filter(e => e.date >= todayIso), // Ensure purely upcoming
        past: [], // Not implemented yet
        todos,
        error: undefined
    }
}
