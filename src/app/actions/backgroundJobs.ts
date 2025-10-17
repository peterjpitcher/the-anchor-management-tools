'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { revalidatePath } from 'next/cache'

export type BackgroundJob = {
  id: string
  type: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  priority: number
  attempts: number
  max_attempts: number
  scheduled_for: string
  created_at: string
  started_at?: string | null
  completed_at?: string | null
  failed_at?: string | null
  error_message?: string | null
  result?: Record<string, unknown> | null
  updated_at: string
}

export type BackgroundJobFilters = {
  status?: string
  type?: string
}

export type BackgroundJobSummary = {
  total: number
  pending: number
  completed: number
  failed: number
}

async function ensureSettingsManage(): Promise<{ supabase: Awaited<ReturnType<typeof createAdminClient>> } | { error: string }> {
  const hasPermission = await checkUserPermission('settings', 'manage')
  if (!hasPermission) {
    return { error: 'You do not have permission to manage background jobs' }
  }

  const supabase = await createAdminClient()
  return { supabase }
}

export async function listBackgroundJobs(filters: BackgroundJobFilters = {}) {
  try {
    const ensure = await ensureSettingsManage()
    if ('error' in ensure) {
      return { error: ensure.error }
    }

    const { supabase } = ensure

    let query = supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)

    if (filters.status) {
      query = query.eq('status', filters.status)
    }

    if (filters.type) {
      query = query.eq('type', filters.type)
    }

    const { data: jobs, error } = await query

    if (error) {
      console.error('Error loading background jobs:', error)
      return { error: 'Failed to load background jobs' }
    }

    const summary: BackgroundJobSummary = {
      total: jobs?.length ?? 0,
      pending: jobs?.filter((job) => job.status === 'pending').length ?? 0,
      completed: jobs?.filter((job) => job.status === 'completed').length ?? 0,
      failed: jobs?.filter((job) => job.status === 'failed').length ?? 0,
    }

    return {
      jobs: (jobs ?? []) as BackgroundJob[],
      summary,
    }
  } catch (error) {
    console.error('Unexpected error in listBackgroundJobs:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function retryBackgroundJob(jobId: string) {
  try {
    const ensure = await ensureSettingsManage()
    if ('error' in ensure) {
      return { error: ensure.error }
    }

    const { supabase } = ensure

    const { error } = await supabase
      .from('jobs')
      .update({
        status: 'pending',
        attempts: 0,
        error_message: null,
        scheduled_for: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    if (error) {
      console.error('Error retrying job:', error)
      return { error: 'Failed to retry job' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'background_job',
      resource_id: jobId,
      operation_status: 'success',
      additional_info: { action: 'retry' },
    })

    revalidatePath('/settings/background-jobs')

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in retryBackgroundJob:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteBackgroundJob(jobId: string) {
  try {
    const ensure = await ensureSettingsManage()
    if ('error' in ensure) {
      return { error: ensure.error }
    }

    const { supabase } = ensure

    const { error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', jobId)

    if (error) {
      console.error('Error deleting job:', error)
      return { error: 'Failed to delete job' }
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'background_job',
      resource_id: jobId,
      operation_status: 'success',
    })

    revalidatePath('/settings/background-jobs')

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in deleteBackgroundJob:', error)
    return { error: 'An unexpected error occurred' }
  }
}
