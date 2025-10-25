/**
 * Unified Job Queue System
 * This replaces the multiple job queue implementations with a single, consistent system
 */

import { createAdminClient } from '@/lib/supabase/server'
import { logger } from './logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { recordOutboundSmsMessage } from '@/lib/sms/logging'
import { formatTime12Hour } from '@/lib/dateUtils'

export type JobType = 
  | 'send_sms'
  | 'send_bulk_sms'
  | 'export_employees'
  | 'rebuild_category_stats'
  | 'categorize_historical_events'
  | 'process_booking_reminder'
  | 'process_event_reminder'
  | 'generate_report'
  | 'sync_calendar'
  | 'cleanup_old_data'

export interface JobPayload {
  [key: string]: any
}

export interface Job {
  id: string
  type: JobType
  payload: JobPayload
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  priority: number
  attempts: number
  max_attempts: number
  scheduled_for: string
  started_at?: string
  completed_at?: string
  failed_at?: string
  error_message?: string
  result?: any
  created_at: string
  updated_at: string
}

export interface JobOptions {
  priority?: number
  maxAttempts?: number
  delay?: number // milliseconds
  unique?: string // unique key to prevent duplicates
}

export class UnifiedJobQueue {
  private static instance: UnifiedJobQueue
  
  private constructor() {}
  
  static getInstance(): UnifiedJobQueue {
    if (!UnifiedJobQueue.instance) {
      UnifiedJobQueue.instance = new UnifiedJobQueue()
    }
    return UnifiedJobQueue.instance
  }
  
  /**
   * Add a job to the queue
   */
  async enqueue(
    type: JobType,
    payload: JobPayload,
    options: JobOptions = {}
  ): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const supabase = await createAdminClient()
      
      // Check for unique constraint if provided
      if (options.unique) {
        const { data: existing } = await supabase
          .from('jobs')
          .select('id')
          .eq('type', type)
          .eq('status', 'pending')
          .contains('payload', { unique_key: options.unique })
          .single()
        
        if (existing) {
          logger.info(`Job with unique key ${options.unique} already exists`, {
            metadata: { jobId: existing.id, type }
          })
          return { success: true, jobId: existing.id }
        }
      }
      
      if (type === 'send_sms') {
        const smsPayload = payload as JobPayload
        const customerId = (smsPayload as any).customer_id ?? (smsPayload as any).customerId
        if (!customerId) {
          logger.error('Rejected send_sms job without customer id', {
            metadata: { payload }
          })
          return { success: false, error: 'send_sms jobs require a customerId' }
        }
      }

      const job = {
        type,
        payload: options.unique ? { ...payload, unique_key: options.unique } : payload,
        status: 'pending' as const,
        priority: options.priority || 0,
        attempts: 0,
        max_attempts: options.maxAttempts || 3,
        scheduled_for: options.delay 
          ? new Date(Date.now() + options.delay).toISOString()
          : new Date().toISOString()
      }
      
      const { data, error } = await supabase
        .from('jobs')
        .insert(job)
        .select()
        .single()
      
      if (error) {
        logger.error('Failed to enqueue job', { 
          error, 
          metadata: { type, payload } 
        })
        return { success: false, error: error.message }
      }
      
      logger.info(`Job enqueued: ${type}`, { 
        metadata: { jobId: data.id, type } 
      })
      
      return { success: true, jobId: data.id }
    } catch (error) {
      logger.error('Error enqueueing job', { 
        error: error as Error,
        metadata: { type }
      })
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to enqueue job' 
      }
    }
  }
  
  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<Job | null> {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single()
    
    if (error) {
      logger.error('Failed to get job', { error, metadata: { jobId } })
      return null
    }
    
    return data as Job
  }
  
  /**
   * Get next pending job
   */
  async getNextPendingJob(): Promise<Job | null> {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .single()
    
    if (error && error.code !== 'PGRST116') { // Not found is ok
      logger.error('Failed to get next pending job', { error })
      return null
    }
    
    return data as Job | null
  }
  
  /**
   * Process pending jobs
   */
  async processJobs(limit = 10): Promise<void> {
    const supabase = await createAdminClient()
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(limit)
    
    if (error) {
      logger.error('Failed to fetch pending jobs', { error })
      return
    }
    
    if (!jobs || jobs.length === 0) {
      return
    }
    
    // Process jobs in parallel
    await Promise.allSettled(
      jobs.map(job => this.processJob(job))
    )
  }
  
  /**
   * Process a single job
   */
  private async processJob(job: Job): Promise<void> {
    const startTime = Date.now()
    const supabase = await createAdminClient()
    
    try {
      // Mark job as processing
      await supabase
        .from('jobs')
        .update({
          status: 'processing',
          started_at: new Date().toISOString(),
          attempts: job.attempts + 1
        })
        .eq('id', job.id)
      
      // Execute job based on type
      const result = await this.executeJob(job.type, job.payload)
      
      // Mark as completed
      await supabase
        .from('jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)
      
      logger.info(`Job completed: ${job.type}`, {
        metadata: {
          jobId: job.id,
          duration: Date.now() - startTime
        }
      })
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      // Check if should retry
      const shouldRetry = job.attempts + 1 < job.max_attempts
      
      await supabase
        .from('jobs')
        .update({
          status: shouldRetry ? 'pending' : 'failed',
          error_message: errorMessage,
          failed_at: shouldRetry ? null : new Date().toISOString(),
          // Exponential backoff for retries
          scheduled_for: shouldRetry 
            ? new Date(Date.now() + Math.pow(2, job.attempts) * 60000).toISOString()
            : job.scheduled_for,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)
      
      logger.error(`Job failed: ${job.type}`, {
        error: error as Error,
        metadata: {
          jobId: job.id,
          attempts: job.attempts + 1,
          willRetry: shouldRetry
        }
      })
    }
  }
  
  /**
   * Execute job based on type
   */
  private async executeJob(type: JobType, payload: JobPayload): Promise<any> {
    // Import handlers dynamically to avoid circular dependencies
    switch (type) {
      case 'send_sms':
        // Check if this is a template-based SMS (e.g., from table bookings)
        if (payload.template && payload.variables) {
          const supabase = await createAdminClient()
          
          // Get the template
          const { data: template } = await supabase
            .from('table_booking_sms_templates')
            .select('*')
            .eq('template_key', payload.template)
            .eq('is_active', true)
            .single()
            
          if (!template) {
            throw new Error(`SMS template not found: ${payload.template}`)
          }
          
          // Replace variables in template
          let messageText = template.template_text
          Object.entries(payload.variables).forEach(([key, value]) => {
            const replacement = key === 'event_time' ? formatTime12Hour(String(value)) : String(value)
            messageText = messageText.replace(new RegExp(`{{${key}}}`, 'g'), replacement)
          })
          
          // Add contact phone if not in variables
          if (messageText.includes('{{contact_phone}}') && !payload.variables.contact_phone) {
            messageText = messageText.replace(/{{contact_phone}}/g, process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '')
          }
          
          const { sendSMS } = await import('@/lib/twilio')
          const supportPhone = (payload.variables?.contact_phone as string | undefined) || process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
          const messageWithSupport = ensureReplyInstruction(messageText, supportPhone)
          const result = await sendSMS(payload.to, messageWithSupport)

          if (result.success) {
            const customerId = payload.customer_id || payload.customerId
            if (!customerId) {
              logger.warn('send_sms job (template) missing customer id for logging', {
                metadata: { to: payload.to, template: payload.template }
              })
            } else if (result.sid) {
              const messageId = await recordOutboundSmsMessage({
                supabase,
                customerId,
                to: payload.to,
                body: messageWithSupport,
                sid: result.sid,
                fromNumber: result.fromNumber ?? undefined,
                twilioStatus: result.status ?? 'queued',
                metadata: payload.booking_id ? { booking_id: payload.booking_id } : null
              })
              if (!messageId) {
                return { success: false, error: 'SMS sent but failed to log message' }
              }
            }
          }

          return result
        } else {
          // Regular SMS with plain text message
          const { sendSMS } = await import('@/lib/twilio')
          const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
          const messageWithSupport = ensureReplyInstruction(payload.message || '', supportPhone)
          const result = await sendSMS(payload.to, messageWithSupport)

          if (result.success) {
            const customerId = payload.customer_id || payload.customerId
            if (!customerId) {
              logger.warn('send_sms job missing customer id for logging', {
                metadata: { to: payload.to }
              })
            } else if (result.sid) {
              const supabase = await createAdminClient()
              const messageId = await recordOutboundSmsMessage({
                supabase,
                customerId,
                to: payload.to,
                body: messageWithSupport,
                sid: result.sid,
                fromNumber: result.fromNumber ?? undefined,
                twilioStatus: result.status ?? 'queued',
                metadata: payload.booking_id ? { booking_id: payload.booking_id } : null
              })
              if (!messageId) {
                return { success: false, error: 'SMS sent but failed to log message' }
              }
            }
          }

          return result
        }
      
      case 'send_bulk_sms':
        const { sendBulkSMSAsync } = await import('@/app/actions/sms')
        return await sendBulkSMSAsync(payload.customerIds, payload.message)
      
      case 'export_employees':
        const { exportEmployees } = await import('@/app/actions/employeeExport')
        return await exportEmployees(payload.filters || {})
      
      case 'process_booking_reminder':
        // TODO: Implement reminder processor
        // const { processBookingReminders } = await import('@/lib/reminder-processor')
        // return await processBookingReminders(payload.bookingId)
        console.log('Booking reminder processor not implemented')
        return
      
      case 'process_event_reminder':
        // TODO: Implement reminder processor
        // const { processEventReminders } = await import('@/lib/reminder-processor')
        // return await processEventReminders(payload.eventId)
        console.log('Event reminder processor not implemented')
        return
      
      default:
        throw new Error(`Unknown job type: ${type}`)
    }
  }
  
  /**
   * Update job status
   */
  async updateJobStatus(
    jobId: string,
    status: Job['status'],
    result?: any,
    error?: string
  ): Promise<boolean> {
    const update: any = { 
      status,
      updated_at: new Date().toISOString()
    }
    
    if (status === 'processing') {
      update.started_at = new Date().toISOString()
    } else if (status === 'completed') {
      update.completed_at = new Date().toISOString()
      if (result) update.result = result
    } else if (status === 'failed') {
      update.failed_at = new Date().toISOString()
      if (error) update.error_message = error
    }
    
    const supabase = await createAdminClient()
    const { error: updateError } = await supabase
      .from('jobs')
      .update(update)
      .eq('id', jobId)
    
    if (updateError) {
      logger.error('Failed to update job status', { 
        error: updateError,
        metadata: { jobId, status }
      })
      return false
    }
    
    return true
  }
  
  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    return await this.updateJobStatus(jobId, 'cancelled')
  }
  
  /**
   * Clean up old jobs
   */
  async cleanupOldJobs(daysToKeep = 30): Promise<number> {
    const supabase = await createAdminClient()
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)
    
    const { data, error } = await supabase
      .from('jobs')
      .delete()
      .in('status', ['completed', 'failed', 'cancelled'])
      .lt('created_at', cutoffDate.toISOString())
      .select('id')
    
    if (error) {
      logger.error('Failed to cleanup old jobs', { error })
      return 0
    }
    
    const count = data?.length || 0
    if (count > 0) {
      logger.info(`Cleaned up ${count} old jobs`)
    }
    
    return count
  }
}

// Export singleton instance
export const jobQueue = UnifiedJobQueue.getInstance()
