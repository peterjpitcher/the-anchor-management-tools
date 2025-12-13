'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'

export type ReminderQueueSummary = {
  pendingDue: number
  pendingScheduled: number
  failed: number
  cancelled: number
  nextDueAt: string | null
  lastSentAt: string | null
  activeJobs: number
}

async function ensureSettingsManage() {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' as const }
  }

  const supabase = await createAdminClient()
  return { supabase }
}

export async function getReminderQueueSummary() {
  const ensure = await ensureSettingsManage()
  if ('error' in ensure) {
    return { error: ensure.error }
  }

  const { supabase } = ensure
  const nowIso = new Date().toISOString()

  const [
    pendingDueResult,
    pendingScheduledResult,
    failedResult,
    cancelledResult,
    nextDueRow,
    lastSentRow,
    activeJobsResult
  ] = await Promise.all([
    supabase
      .from('booking_reminders')
      .select('id', { head: true, count: 'exact' })
      .in('status', ['pending', 'queued', 'sending'])
      .lte('scheduled_for', nowIso),
    supabase
      .from('booking_reminders')
      .select('id', { head: true, count: 'exact' })
      .in('status', ['pending', 'queued'])
      .gt('scheduled_for', nowIso),
    supabase
      .from('booking_reminders')
      .select('id', { head: true, count: 'exact' })
      .eq('status', 'failed'),
    supabase
      .from('booking_reminders')
      .select('id', { head: true, count: 'exact' })
      .eq('status', 'cancelled'),
    supabase
      .from('booking_reminders')
      .select('scheduled_for')
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('booking_reminders')
      .select('sent_at')
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('jobs')
      .select('id', { head: true, count: 'exact' })
      .eq('type', 'process_event_reminder')
      .in('status', ['pending', 'processing'])
  ])

  const summary: ReminderQueueSummary = {
    pendingDue: pendingDueResult.count ?? 0,
    pendingScheduled: pendingScheduledResult.count ?? 0,
    failed: failedResult.count ?? 0,
    cancelled: cancelledResult.count ?? 0,
    nextDueAt: nextDueRow?.data?.scheduled_for ?? null,
    lastSentAt: lastSentRow?.data?.sent_at ?? null,
    activeJobs: activeJobsResult.count ?? 0
  }

  return { summary }
}
