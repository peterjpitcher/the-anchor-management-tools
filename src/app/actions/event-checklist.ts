'use server'

import { revalidatePath } from 'next/cache'
import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { logAuditEvent } from '@/app/actions/audit'
import { buildEventChecklist, EVENT_CHECKLIST_DEFINITIONS, getOutstandingTodos, type ChecklistTodoItem, type EventChecklistItem } from '@/lib/event-checklist'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { Event, EventChecklistStatus } from '@/types/database'

const EVENT_CHECKLIST_TASK_KEYS = new Set(EVENT_CHECKLIST_DEFINITIONS.map(task => task.key))

interface ChecklistResponse {
  success: boolean
  error?: string
  items?: EventChecklistItem[]
  event?: Pick<Event, 'id' | 'name' | 'date'>
}

export async function getEventChecklist(eventId: string): Promise<ChecklistResponse> {
  const hasPermission = await checkUserPermission('events', 'view')
  if (!hasPermission) {
    return { success: false, error: 'Insufficient permissions' }
  }

  const supabase = getSupabaseAdminClient()

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, name, date')
    .eq('id', eventId)
    .single()

  if (eventError || !event) {
    console.error('Failed to load event for checklist', eventError)
    return { success: false, error: 'Event not found' }
  }

  const { data: statuses, error: statusError } = await supabase
    .from('event_checklist_statuses')
    .select('event_id, task_key, completed_at')
    .eq('event_id', eventId)

  if (statusError) {
    console.error('Failed to load event checklist statuses', statusError)
    return { success: false, error: 'Unable to load checklist' }
  }

  const todayIso = getTodayIsoDate()
  const items = buildEventChecklist(event, statuses ?? [], todayIso)

  return {
    success: true,
    items,
    event
  }
}

interface ToggleChecklistResult {
  success: boolean
  error?: string
}

export async function toggleEventChecklistTask(
  eventId: string,
  taskKey: string,
  completed: boolean
): Promise<ToggleChecklistResult> {
  const hasPermission = await checkUserPermission('events', 'manage')
  if (!hasPermission) {
    return { success: false, error: 'Insufficient permissions' }
  }

  if (!EVENT_CHECKLIST_TASK_KEYS.has(taskKey)) {
    return { success: false, error: 'Unknown checklist task' }
  }

  const supabase = getSupabaseAdminClient()
  const timestamp = completed ? new Date().toISOString() : null

  const { error } = await supabase
    .from('event_checklist_statuses')
    .upsert(
      {
        event_id: eventId,
        task_key: taskKey,
        completed_at: timestamp
      },
      { onConflict: 'event_id,task_key' }
    )

  if (error) {
    console.error('Failed to update event checklist task', error)
    return { success: false, error: 'Failed to update checklist task' }
  }

  // Clean up rows that are explicitly marked incomplete to keep table small
  if (!completed) {
    const { error: deleteError } = await supabase
      .from('event_checklist_statuses')
      .delete()
      .eq('event_id', eventId)
      .eq('task_key', taskKey)
      .is('completed_at', null)

    if (deleteError) {
      console.warn('Failed to clean up incomplete checklist row', deleteError)
    }
  }

  const userInfo = await getCurrentUser()
  await logAuditEvent({
    user_id: userInfo.user_id ?? undefined,
    user_email: userInfo.user_email ?? undefined,
    operation_type: completed ? 'complete' : 'reopen',
    resource_type: 'event_checklist_task',
    resource_id: `${eventId}:${taskKey}`,
    operation_status: 'success',
    additional_info: {
      eventId,
      taskKey,
      completed
    }
  })

  revalidatePath('/events')
  revalidatePath(`/events/${eventId}`)

  return { success: true }
}

interface ChecklistProgressMap {
  [eventId: string]: {
    completed: number
    total: number
  }
}

export async function getEventChecklistProgress(eventIds: string[]): Promise<{ success: boolean; error?: string; progress?: ChecklistProgressMap }> {
  const hasPermission = await checkUserPermission('events', 'view')
  if (!hasPermission) {
    return { success: false, error: 'Insufficient permissions' }
  }

  if (!eventIds || eventIds.length === 0) {
    return { success: true, progress: {} }
  }

  const supabase = getSupabaseAdminClient()

  const { data: statuses, error } = await supabase
    .from('event_checklist_statuses')
    .select('event_id, task_key, completed_at')
    .in('event_id', eventIds)

  if (error) {
    console.error('Failed to fetch checklist progress', error)
    return { success: false, error: 'Unable to load checklist progress' }
  }

  const progress: ChecklistProgressMap = {}
  for (const eventId of eventIds) {
    progress[eventId] = { completed: 0, total: EVENT_CHECKLIST_DEFINITIONS.length }
  }

  statuses?.forEach((status) => {
    if (!status.completed_at) return
    const current = progress[status.event_id]
    if (!current) {
      progress[status.event_id] = { completed: 1, total: EVENT_CHECKLIST_DEFINITIONS.length }
    } else {
      current.completed += 1
    }
  })

  return { success: true, progress }
}

interface ChecklistTodosResult {
  success: boolean
  error?: string
  items?: ChecklistTodoItem[]
}

export async function getChecklistTodos(): Promise<ChecklistTodosResult> {
  const hasPermission = await checkUserPermission('events', 'view')
  if (!hasPermission) {
    return { success: false, error: 'Insufficient permissions' }
  }

  const supabase = getSupabaseAdminClient()
  const todayIso = getTodayIsoDate()

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, date')
    .gte('date', todayIso)
    .order('date', { ascending: true })

  if (eventsError) {
    console.error('Failed to load events for checklist todos', eventsError)
    return { success: false, error: 'Unable to load events' }
  }

  if (!events || events.length === 0) {
    return { success: true, items: [] }
  }

  const eventIds = events.map((event) => event.id)

  const { data: statuses, error: statusesError } = await supabase
    .from('event_checklist_statuses')
    .select('event_id, task_key, completed_at')
    .in('event_id', eventIds)

  if (statusesError) {
    console.error('Failed to load checklist statuses for todos', statusesError)
    return { success: false, error: 'Unable to load checklist statuses' }
  }

  const statusMap = new Map<string, EventChecklistStatus[]>()
  statuses?.forEach((status) => {
    const list = statusMap.get(status.event_id) ?? []
    list.push(status as EventChecklistStatus)
    statusMap.set(status.event_id, list)
  })

  const todos: ChecklistTodoItem[] = []
  events.forEach((event) => {
    const eventStatuses = statusMap.get(event.id) ?? []
    const outstanding = getOutstandingTodos(event, eventStatuses, todayIso)
    outstanding
      .filter(item => item.status === 'overdue' || item.status === 'due_today')
      .forEach((item) => {
        todos.push(item)
      })
  })

  todos.sort((a, b) => {
    if (a.dueDate === b.dueDate) {
      return a.order - b.order
    }
    return a.dueDate.localeCompare(b.dueDate)
  })

  return { success: true, items: todos }
}
