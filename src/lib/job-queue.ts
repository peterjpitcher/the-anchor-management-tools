import { getSupabaseAdminClient } from '@/lib/supabase-singleton'

export type JobType = 
  | 'export_employees' 
  | 'send_bulk_sms' 
  | 'rebuild_category_stats' 
  | 'categorize_historical_events'

export interface Job {
  id: string
  type: JobType
  status: 'pending' | 'processing' | 'completed' | 'failed'
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  created_at: string
  started_at?: string
  completed_at?: string
  created_by?: string
}

export class JobQueue {
  private supabase = getSupabaseAdminClient()

  constructor() {
  }

  async enqueue(type: JobType, payload?: any, userId?: string): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('job_queue')
        .insert({
          type,
          payload,
          created_by: userId
        })
        .select()
        .single()

      if (error || !data) {
        console.error('Failed to enqueue job:', error)
        return { success: false, error: error?.message || 'Failed to create job' }
      }

      return { success: true, jobId: data.id as string }
    } catch (error) {
      console.error('Error enqueueing job:', error)
      return { success: false, error: 'Failed to enqueue job' }
    }
  }

  async getJob(jobId: string): Promise<Job | null> {
    const { data, error } = await this.supabase
      .from('job_queue')
      .select('*')
      .eq('id', jobId)
      .single()

    if (error) {
      console.error('Failed to get job:', error)
      return null
    }

    return data ? {
      id: data.id,
      type: data.type,
      status: data.status,
      payload: data.payload,
      result: data.result,
      error: data.error,
      created_at: data.created_at,
      started_at: data.started_at,
      completed_at: data.completed_at,
      created_by: data.created_by
    } as Job : null
  }

  async updateJobStatus(
    jobId: string, 
    status: 'processing' | 'completed' | 'failed',
    result?: any,
    error?: string
  ): Promise<boolean> {
    const update: any = { status }
    
    if (status === 'processing') {
      update.started_at = new Date().toISOString()
    } else if (status === 'completed' || status === 'failed') {
      update.completed_at = new Date().toISOString()
    }

    if (result) update.result = result
    if (error) update.error = error

    const { error: updateError } = await this.supabase
      .from('job_queue')
      .update(update)
      .eq('id', jobId)

    if (updateError) {
      console.error('Failed to update job status:', updateError)
      return false
    }

    return true
  }

  async getNextPendingJob(): Promise<Job | null> {
    const { data, error } = await this.supabase
      .rpc('process_pending_jobs')
      .single()

    if (error || !data) {
      return null
    }

    return this.getJob((data as any).job_id)
  }
}