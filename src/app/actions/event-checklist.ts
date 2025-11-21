'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { logAuditEvent } from '@/app/actions/audit'
import { buildEventChecklist, EVENT_CHECKLIST_DEFINITIONS, getOutstandingTodos, type ChecklistTodoItem, type EventChecklistItem } from '@/lib/event-checklist'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { Event, EventChecklistStatus } from '@/types/database'
import { EventChecklistService } from '@/services/event-checklist' // Import the new service

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

  // Delegate to service for read logic
  return EventChecklistService.getEventChecklist(eventId);
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

  const result = await EventChecklistService.toggleEventChecklistTask(eventId, taskKey, completed);

  if (result.error) {
    return result;
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

  const supabase = createAdminClient()

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

  // Delegate to service for read logic
  return EventChecklistService.getChecklistTodos();
}