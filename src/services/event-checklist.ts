import { createAdminClient } from '@/lib/supabase/admin';
import { buildEventChecklist, getOutstandingTodos, EVENT_CHECKLIST_DEFINITIONS } from '@/lib/event-checklist';
import { getTodayIsoDate } from '@/lib/dateUtils';
import type { EventChecklistItem } from '@/lib/event-checklist';
import type { Event, EventChecklistStatus } from '@/types/database';

const EVENT_CHECKLIST_TASK_KEYS = new Set(EVENT_CHECKLIST_DEFINITIONS.map(task => task.key));

interface ChecklistResponse {
  success: boolean;
  error?: string;
  items?: EventChecklistItem[];
  event?: Pick<Event, 'id' | 'name' | 'date'>;
}

export class EventChecklistService {
  static async getEventChecklist(eventId: string): Promise<ChecklistResponse> {
    const supabase = createAdminClient();

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, date')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      console.error('Failed to load event for checklist', eventError);
      return { success: false, error: 'Event not found' };
    }

    const { data: statuses, error: statusError } = await supabase
      .from('event_checklist_statuses')
      .select('event_id, task_key, completed_at')
      .eq('event_id', eventId);

    if (statusError) {
      console.error('Failed to load event checklist statuses', statusError);
      return { success: false, error: 'Unable to load checklist' };
    }

    const todayIso = getTodayIsoDate();
    const items = buildEventChecklist(event, statuses ?? [], todayIso);

    return {
      success: true,
      items,
      event
    };
  }

  static async toggleEventChecklistTask(
    eventId: string,
    taskKey: string,
    completed: boolean
  ): Promise<{ success: boolean; error?: string }> {
    if (!EVENT_CHECKLIST_TASK_KEYS.has(taskKey)) {
      return { success: false, error: 'Unknown checklist task' };
    }

    const supabase = createAdminClient();
    const timestamp = completed ? new Date().toISOString() : null;

    const { error } = await supabase
      .from('event_checklist_statuses')
      .upsert(
        {
          event_id: eventId,
          task_key: taskKey,
          completed_at: timestamp
        },
        { onConflict: 'event_id,task_key' }
      );

    if (error) {
      console.error('Failed to update event checklist task', error);
      return { success: false, error: 'Failed to update checklist task' };
    }

    // Clean up rows that are explicitly marked incomplete to keep table small
    if (!completed) {
      const { error: deleteError } = await supabase
        .from('event_checklist_statuses')
        .delete()
        .eq('event_id', eventId)
        .eq('task_key', taskKey)
        .is('completed_at', null);

      if (deleteError) {
        console.warn('Failed to clean up incomplete checklist row', deleteError);
      }
    }

    return { success: true };
  }

  static async getChecklistTodos(): Promise<{ success: boolean; error?: string; items?: any[] }> {
    const supabase = createAdminClient();
    const todayIso = getTodayIsoDate();

    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, name, date')
      .gte('date', todayIso)
      .order('date', { ascending: true });

    if (eventsError) {
      console.error('Failed to load events for checklist todos', eventsError);
      return { success: false, error: 'Unable to load events' };
    }

    if (!events || events.length === 0) {
      return { success: true, items: [] };
    }

    const eventIds = events.map((event) => event.id);

    const { data: statuses, error: statusesError } = await supabase
      .from('event_checklist_statuses')
      .select('event_id, task_key, completed_at')
      .in('event_id', eventIds);

    if (statusesError) {
      console.error('Failed to load checklist statuses for todos', statusesError);
      return { success: false, error: 'Unable to load checklist statuses' };
    }

    const statusMap = new Map<string, EventChecklistStatus[]>();
    statuses?.forEach((status) => {
      const list = statusMap.get(status.event_id) ?? [];
      list.push(status as EventChecklistStatus);
      statusMap.set(status.event_id, list);
    });

    const todos: EventChecklistItem[] = [];
    events.forEach((event) => {
      const eventStatuses = statusMap.get(event.id) ?? [];
      const outstanding = getOutstandingTodos(event, eventStatuses, todayIso);
      outstanding
        .filter(item => item.status === 'overdue' || item.status === 'due_today')
        .forEach((item) => {
          todos.push(item);
        });
    });

    todos.sort((a, b) => {
      if (a.dueDate === b.dueDate) {
        return a.order - b.order;
      }
      return a.dueDate.localeCompare(b.dueDate);
    });

    return { success: true, items: todos };
  }
}
