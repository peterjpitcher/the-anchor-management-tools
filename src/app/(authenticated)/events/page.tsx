import { redirect } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import { buildEventChecklist, EVENT_CHECKLIST_TOTAL_TASKS, ChecklistTodoItem } from '@/lib/event-checklist'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { checkUserPermission } from '@/app/actions/rbac'
import EventsClient from './EventsClient'

async function getEvents(): Promise<{ events: any[]; todos: ChecklistTodoItem[] }> {
  const supabase = getSupabaseAdminClient()
  
  const { data: events, error } = await supabase
    .from('events')
    .select(`
      *,
      category:event_categories(*),
      bookings (id, seats)
    `)
    .order('date', { ascending: true })
    .order('time', { ascending: true })
  
  if (error) {
    console.error('Error fetching events:', error)
    return { events: [], todos: [] }
  }
  
  const eventIds = events?.map(event => event.id).filter(Boolean) as string[]
  let statusMap = new Map<string, { task_key: string; completed_at: string | null }[]>()

  if (eventIds.length > 0) {
    const { data: checklistStatuses, error: checklistError } = await supabase
      .from('event_checklist_statuses')
      .select('event_id, task_key, completed_at')
      .in('event_id', eventIds)

    if (checklistError) {
      console.error('Error loading event checklist statuses:', checklistError)
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
    return { events: [], todos: [] }
  }

  type BookingSeat = { seats: number | null }
  const todos: ChecklistTodoItem[] = []

  const eventsWithChecklist = events.map(event => {
    const bookedSeats = event.bookings?.reduce((sum: number, booking: BookingSeat) => sum + (booking.seats || 0), 0) || 0

    if (!event.date) {
      return {
        ...event,
        booked_seats: bookedSeats,
        bookings: undefined,
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
      bookings: undefined,
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
    todos
  }
}

export default async function EventsPage() {
  const canViewEvents = await checkUserPermission('events', 'view')
  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  const { events, todos } = await getEvents()
  
  return <EventsClient events={events} todos={todos} />
}
