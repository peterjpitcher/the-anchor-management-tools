/**
 * @deprecated Use @/lib/unified-job-queue instead
 * This file is kept for backward compatibility but redirects to the unified job queue
 */

import { jobQueue as unifiedJobQueue } from './unified-job-queue'

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
  constructor() {
    console.warn('JobQueue is deprecated. Use unified-job-queue instead.')
  }

  async enqueue(type: JobType, payload?: any, userId?: string): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const result = await unifiedJobQueue.enqueue(type as any, payload || {}, {
        unique: userId ? `${type}-${userId}` : undefined
      })
      return result
    } catch (error) {
      console.error('Failed to enqueue job:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Failed to enqueue job' }
    }
  }

  async getJob(jobId: string): Promise<Job | null> {
    const job = await unifiedJobQueue.getJob(jobId)
    if (!job) return null
    
    // Map to old format
    return {
      id: job.id,
      type: job.type as JobType,
      status: job.status as any,
      payload: job.payload,
      result: job.result,
      error: job.error_message,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      created_by: job.payload?.created_by as string
    }
  }

  async updateJobStatus(
    jobId: string, 
    status: 'processing' | 'completed' | 'failed',
    result?: any,
    error?: string
  ): Promise<boolean> {
    return await unifiedJobQueue.updateJobStatus(jobId, status, result, error)
  }

  async getNextPendingJob(): Promise<Job | null> {
    const job = await unifiedJobQueue.getNextPendingJob()
    if (!job) return null
    
    // Map to old format
    return {
      id: job.id,
      type: job.type as JobType,
      status: job.status as any,
      payload: job.payload,
      result: job.result,
      error: job.error_message,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      created_by: job.payload?.created_by as string
    }
  }
}