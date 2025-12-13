import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildEventChecklist, EVENT_CHECKLIST_TOTAL_TASKS, ChecklistTodoItem } from '@/lib/event-checklist'
import { getTodayIsoDate, getLocalIsoDateDaysAgo, getLocalIsoDateDaysAhead } from '@/lib/dateUtils'
import { checkUserPermission } from '@/app/actions/rbac'
import EventsClient from './EventsClient'
import { EventChecklistItem } from '@/lib/event-checklist'

interface EventQueryResult {
  id: string
  name: string
  date: string
  time: string
  capacity: number | null
  category: { id: string; name: string; color: string } | null
  booking_totals: { sum: number | null }[]
}

// This matches the shape expected by EventsClient
interface PageEvent {
  id: string
  name: string
  date: string
  time: string
  capacity: number | null
  booked_seats: number
  category: { id: string; name: string; color: string } | null
  checklist?: {
    completed: number
    total: number
    overdueCount: number
    dueTodayCount: number
    nextTask: EventChecklistItem | null
    outstanding: EventChecklistItem[]
  }
}

async function getEvents(): Promise<{ events: PageEvent[]; todos: ChecklistTodoItem[]; error?: string }> {
  const supabase = createAdminClient()
  const errors: string[] = []
  // We want to see all future events, so we only restrict the past history.
  // const FUTURE_WINDOW_DAYS = 180 (Removed to allow all future events)
  const PAST_WINDOW_DAYS = 30 // Reduced past window to keep query lighter, assuming "Upcoming" is priority
  const earliestDate = getLocalIsoDateDaysAgo(PAST_WINDOW_DAYS)
  const MAX_EVENTS = 500

  const { data: events, error } = await supabase
    .from('events')
    .select(`
      id,
      name,
      date,
      time,
      capacity,
      category:event_categories(id, name, color),
      booking_totals:bookings(sum:seats)
    `)
    .gte('date', earliestDate)
    // .lte('date', latestDate) // Removed to show unlimited future events
    .order('date', { ascending: true })
    .order('time', { ascending: true })
    .limit(MAX_EVENTS)
    .returns<EventQueryResult[]>()

  if (error) {
    console.error('Error fetching events:', error)
    errors.push('We were unable to load events. Please try again.')
  }

  const safeEvents = events ?? []
  const eventIds = safeEvents.map(event => event.id).filter(Boolean) as string[]
  let statusMap = new Map<string, { task_key: string; completed_at: string | null }[]>()

  if (eventIds.length > 0) {
    const { data: checklistStatuses, error: checklistError } = await supabase
      .from('event_checklist_statuses')
      .select('event_id, task_key, completed_at')
      .in('event_id', eventIds)

    if (checklistError) {
      console.error('Error loading event checklist statuses:', checklistError)
      errors.push('Event checklist information may be out of date.')
    } else if (checklistStatuses) {
      statusMap = checklistStatuses.reduce((map, status) => {
        const list = map.get(status.event_id) ?? []
        list.push({ task_key: status.task_key, completed_at: status.completed_at })
        map.set(status.event_id, list)
        return map
      }, new Map<string, { task_key: string; completed_at: string | null }[]>())
    }
  }

  const todayIso = getTodayIsoDate()

  if (!events) {
    return { events: [], todos: [], error: errors.join(' ') || 'No events found.' }
  }

  const todos: ChecklistTodoItem[] = []

  const eventsWithChecklist = safeEvents.map(event => {
    const bookedSeats = (event.booking_totals?.[0]?.sum || 0) || 0

    if (!event.date) {
      return {
        ...event,
        booked_seats: bookedSeats,
        booking_totals: undefined,
        checklist: {
          completed: 0,
          total: EVENT_CHECKLIST_TOTAL_TASKS,
          overdueCount: 0,
          dueTodayCount: 0,
          nextTask: null,
          outstanding: []
        }
      }
    }

    const statuses = statusMap.get(event.id) ?? []
    const checklist = buildEventChecklist(
      { id: event.id, name: event.name, date: event.date },
      statuses.map(status => ({
        event_id: event.id,
        task_key: status.task_key,
        completed_at: status.completed_at
      })),
      todayIso
    )

    const outstanding = checklist
      .filter(item => !item.completed)
      .sort((a, b) => {
        if (a.dueDate === b.dueDate) {
          return a.order - b.order
        }
        return a.dueDate.localeCompare(b.dueDate)
      })

    outstanding.forEach(item => {
      todos.push({
        ...item,
        eventName: event.name ?? 'Untitled event',
        eventDate: event.date
      })
    })

    const overdueCount = outstanding.filter(item => item.status === 'overdue').length
    const dueTodayCount = outstanding.filter(item => item.status === 'due_today').length

    return {
      ...event,
      booked_seats: bookedSeats,
      booking_totals: undefined,
      checklist: {
        completed: checklist.filter(item => item.completed).length,
        total: EVENT_CHECKLIST_TOTAL_TASKS,
        overdueCount,
        dueTodayCount,
        nextTask: outstanding[0] || null,
        outstanding
      }
    }
  })

  todos.sort((a, b) => {
    if (a.dueDate === b.dueDate) {
      if (a.eventDate === b.eventDate) {
        return a.order - b.order
      }
      return (a.eventDate ?? '').localeCompare(b.eventDate ?? '')
    }
    return a.dueDate.localeCompare(b.dueDate)
  })

  return {
    events: eventsWithChecklist,
    todos,
    error: errors.length > 0 ? errors.join(' ') : undefined,
  }
}

export default async function EventsPage() {
  const canViewEvents = await checkUserPermission('events', 'view')
  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  const { events, todos, error } = await getEvents()

  return <EventsClient events={events} todos={todos} initialError={error} />
}
