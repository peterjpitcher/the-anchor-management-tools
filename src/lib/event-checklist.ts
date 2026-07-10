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
  { key: 'write_event_brief', label: 'Write Event Brief', offsetDays: -28, channel: 'Admin', required: true, order: 0 },
  { key: 'design_table_talkers', label: 'Design Printed Materials', offsetDays: -28, channel: 'Print File', required: true, order: 1 },
  { key: 'create_facebook_event', label: 'Create Facebook Event', offsetDays: -28, channel: 'Facebook', required: true, order: 2 },
  { key: 'add_google_business_post', label: 'Add GBP Event Post', offsetDays: -28, channel: 'Google', required: true, order: 3 },
  { key: 'schedule_social_content', label: 'Schedule Social Posts', offsetDays: -28, channel: 'FB/IG', required: true, order: 4 },
  { key: 'schedule_stories', label: 'Scheduled Stories', offsetDays: -28, channel: 'FB/IG', required: true, order: 5 },
  { key: 'setup_paid_advertising', label: 'Set Up Paid Advertising', offsetDays: -28, channel: 'Paid Ads', required: true, order: 6 },
  { key: 'send_whatsapp_reminder', label: 'Whatsapp Reminder (Day of)', offsetDays: 0, channel: 'WhatsApp', required: true, order: 7 }
]

const EVENT_CHECKLIST_TOTAL_TASKS = EVENT_CHECKLIST_DEFINITIONS.length
const EVENT_CHECKLIST_TASK_KEYS = new Set(EVENT_CHECKLIST_DEFINITIONS.map(task => task.key))

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

function calculateChecklistProgress(
  statuses: EventChecklistStatusRecord[] = []
): { completed: number; total: number } {
  const completed = statuses.filter(
    (status) => EVENT_CHECKLIST_TASK_KEYS.has(status.task_key) && Boolean(status.completed_at)
  ).length
  return {
    completed,
    total: EVENT_CHECKLIST_TOTAL_TASKS
  }
}
