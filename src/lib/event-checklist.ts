import { formatDate } from '@/lib/dateUtils'
import { Event } from '@/types/database'

type EventWithDate = Pick<Event, 'id' | 'name' | 'date'>

export interface EventChecklistDefinition {
  key: string
  label: string
  offsetDays: number
  channel: string
  required: boolean
  order: number
}

export interface EventChecklistStatusRecord {
  event_id: string
  task_key: string
  completed_at: string | null
}

export interface EventChecklistItem extends EventChecklistDefinition {
  eventId: string
  dueDate: string
  dueDateFormatted: string
  completed: boolean
  completedAt: string | null
  status: 'completed' | 'due_today' | 'overdue' | 'upcoming'
}

export const EVENT_CHECKLIST_DEFINITIONS: EventChecklistDefinition[] = [
  { key: 'update_event_details', label: 'Update all event details', offsetDays: -42, channel: 'Website', required: true, order: 0 },
  { key: 'write_event_brief', label: 'Write event brief', offsetDays: -28, channel: 'Admin', required: true, order: 1 },
  { key: 'publish_event_page', label: 'Build & publish event web page', offsetDays: -28, channel: 'Website', required: true, order: 2 },
  { key: 'create_short_link', label: 'Create short link & QR code', offsetDays: -28, channel: 'Website', required: true, order: 3 },
  { key: 'design_table_talkers', label: 'Design table-talkers', offsetDays: -28, channel: 'Print file', required: true, order: 4 },
  { key: 'design_bar_strut_cards', label: 'Design bar-strut cards', offsetDays: -28, channel: 'Print file', required: true, order: 5 },
  { key: 'design_poster', label: 'Design poster', offsetDays: -28, channel: 'Print file', required: false, order: 6 },
  { key: 'create_facebook_event', label: 'Create Facebook Event', offsetDays: -28, channel: 'Facebook', required: true, order: 7 },
  { key: 'add_google_business_post', label: 'Add Google Business Profile Event post', offsetDays: -28, channel: 'Google', required: true, order: 8 },
  { key: 'schedule_social_content', label: 'Create & schedule social content', offsetDays: -28, channel: 'FB/IG', required: true, order: 9 },
  { key: 'schedule_stories', label: 'Schedule Stories (day-before & day-of)', offsetDays: -28, channel: 'FB/IG', required: true, order: 10 },
  { key: 'send_whatsapp_reminder', label: 'WhatsApp reminder to local group', offsetDays: 0, channel: 'WhatsApp', required: true, order: 11 }
]

export const EVENT_CHECKLIST_TOTAL_TASKS = EVENT_CHECKLIST_DEFINITIONS.length

function addDays(dateString: string, offsetDays: number): string {
  const date = new Date(`${dateString}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().split('T')[0]
}

export function buildEventChecklist(
  event: EventWithDate,
  statuses: EventChecklistStatusRecord[] = [],
  todayIso: string = new Date().toISOString().split('T')[0]
): EventChecklistItem[] {
  const statusMap = new Map<string, EventChecklistStatusRecord>()
  statuses.forEach((status) => {
    if (status.task_key) {
      statusMap.set(status.task_key, status)
    }
  })

  return EVENT_CHECKLIST_DEFINITIONS.map((definition) => {
    const dueDate = addDays(event.date, definition.offsetDays)
    const statusRecord = statusMap.get(definition.key)
    const completed = Boolean(statusRecord?.completed_at)
    const completedAt = statusRecord?.completed_at ?? null

    let status: EventChecklistItem['status']
    if (completed) {
      status = 'completed'
    } else if (dueDate < todayIso) {
      status = 'overdue'
    } else if (dueDate === todayIso) {
      status = 'due_today'
    } else {
      status = 'upcoming'
    }

    return {
      ...definition,
      eventId: event.id,
      dueDate,
      dueDateFormatted: formatDate(dueDate),
      completed,
      completedAt,
      status
    }
  })
}

export interface ChecklistTodoItem extends EventChecklistItem {
  eventName: string
  eventDate: string
}

export function getOutstandingTodos(
  event: EventWithDate,
  statuses: EventChecklistStatusRecord[] = [],
  todayIso: string = new Date().toISOString().split('T')[0]
): ChecklistTodoItem[] {
  return buildEventChecklist(event, statuses, todayIso)
    .filter(item => !item.completed)
    .map(item => ({
      ...item,
      eventName: event.name,
      eventDate: event.date
    }))
}

export function calculateChecklistProgress(
  statuses: EventChecklistStatusRecord[] = []
): { completed: number; total: number } {
  const completed = statuses.filter((status) => Boolean(status.completed_at)).length
  return {
    completed,
    total: EVENT_CHECKLIST_TOTAL_TASKS
  }
}
