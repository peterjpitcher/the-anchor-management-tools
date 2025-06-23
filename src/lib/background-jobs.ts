import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import { Job, JobType, JobPayload, JobOptions } from './job-types'
import { logger } from './logger'

export class JobQueue {
  private static instance: JobQueue
  private supabase = getSupabaseAdminClient()
  
  private constructor() {}
  
  static getInstance(): JobQueue {
    if (!JobQueue.instance) {
      JobQueue.instance = new JobQueue()
    }
    return JobQueue.instance
  }
  
  /**
   * Add a job to the queue
   */
  async enqueue<T extends JobType>(
    type: T,
    payload: JobPayload[T],
    options: JobOptions = {}
  ): Promise<string> {
    const job = {
      type,
      payload,
      status: 'pending',
      attempts: 0,
      max_attempts: options.maxAttempts || 3,
      priority: options.priority || 0,
      scheduled_for: options.delay 
        ? new Date(Date.now() + options.delay).toISOString()
        : new Date().toISOString(),
      created_at: new Date().toISOString()
    }
    
    const { data, error } = await this.supabase
      .from('background_jobs')
      .insert(job)
      .select()
      .single()
    
    if (error) {
      logger.error('Failed to enqueue job', { 
        error, 
        metadata: { type, payload } 
      })
      throw error
    }
    
    logger.info(`Job enqueued: ${type}`, { 
      metadata: { jobId: data.id, type } 
    })
    
    return data.id
  }
  
  /**
   * Process pending jobs
   */
  async processJobs(limit = 10): Promise<void> {
    const { data: jobs, error } = await this.supabase
      .from('background_jobs')
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
  private async processJob(job: any): Promise<void> {
    const startTime = Date.now()
    
    try {
      // Mark job as processing
      await this.supabase
        .from('background_jobs')
        .update({
          status: 'processing',
          processed_at: new Date().toISOString(),
          attempts: job.attempts + 1
        })
        .eq('id', job.id)
      
      // Process based on job type
      const result = await this.executeJob(job.type, job.payload)
      
      // Mark as completed
      await this.supabase
        .from('background_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result,
          duration_ms: Date.now() - startTime
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
      
      await this.supabase
        .from('background_jobs')
        .update({
          status: shouldRetry ? 'pending' : 'failed',
          error: errorMessage,
          // Exponential backoff for retries
          scheduled_for: shouldRetry 
            ? new Date(Date.now() + Math.pow(2, job.attempts) * 60000).toISOString()
            : undefined
        })
        .eq('id', job.id)
      
      logger.error(`Job failed: ${job.type}`, {
        error: error as Error,
        metadata: {
          jobId: job.id,
          attempt: job.attempts + 1,
          willRetry: shouldRetry
        }
      })
    }
  }
  
  /**
   * Execute job based on type
   */
  private async executeJob(type: JobType, payload: any): Promise<any> {
    switch (type) {
      case 'send_sms':
        return this.processSendSms(payload)
      
      case 'send_bulk_sms':
        return this.processBulkSms(payload)
      
      case 'process_reminder':
        return this.processReminder(payload)
      
      case 'sync_customer_stats':
        return this.syncCustomerStats(payload)
      
      case 'cleanup_old_messages':
        return this.cleanupOldMessages(payload)
      
      case 'update_sms_health':
        return this.updateSmsHealth(payload)
      
      default:
        throw new Error(`Unknown job type: ${type}`)
    }
  }
  
  // Job processors
  
  private async processSendSms(payload: JobPayload['send_sms']) {
    const { sendSMS } = await import('./twilio')
    const result = await sendSMS(payload.to, payload.message)
    
    if (!result.success) {
      throw new Error(result.error as string)
    }
    
    // Log message to database
    if (payload.customerId) {
      await this.supabase
        .from('messages')
        .insert({
          customer_id: payload.customerId,
          direction: 'outbound',
          body: payload.message,
          status: 'sent',
          from_number: process.env.TWILIO_PHONE_NUMBER,
          to_number: payload.to,
          message_type: 'sms'
        })
    }
    
    return { success: true }
  }
  
  private async processBulkSms(payload: JobPayload['send_bulk_sms']) {
    const { customerIds, message } = payload
    const results = []
    
    // Process in batches to avoid overloading
    const batchSize = 10
    for (let i = 0; i < customerIds.length; i += batchSize) {
      const batch = customerIds.slice(i, i + batchSize)
      
      // Get customer details
      const { data: customers } = await this.supabase
        .from('customers')
        .select('id, mobile_number, sms_opt_in')
        .in('id', batch)
        .eq('sms_opt_in', true)
        .not('mobile_number', 'is', null)
      
      if (!customers) continue
      
      // Send SMS to each customer
      for (const customer of customers) {
        await this.enqueue('send_sms', {
          to: customer.mobile_number!,
          message,
          customerId: customer.id,
          type: 'custom'
        })
      }
      
      results.push(...customers.map(c => c.id))
    }
    
    return { sent: results.length }
  }
  
  private async processReminder(payload: JobPayload['process_reminder']) {
    const { bookingId, reminderType } = payload
    
    // Get booking details
    const { data: booking } = await this.supabase
      .from('bookings')
      .select(`
        *,
        customer:customers(id, first_name, last_name, mobile_number, sms_opt_in),
        event:events(name, date, time)
      `)
      .eq('id', bookingId)
      .single()
    
    if (!booking || !booking.customer?.sms_opt_in || !booking.customer?.mobile_number) {
      return { skipped: true, reason: 'Invalid booking or customer opted out' }
    }
    
    // Check if reminder already sent
    const { data: existingReminder } = await this.supabase
      .from('booking_reminders')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('reminder_type', reminderType)
      .single()
    
    if (existingReminder) {
      return { skipped: true, reason: 'Reminder already sent' }
    }
    
    // Send reminder (implementation would go here)
    // For now, just log it
    logger.info('Would send reminder', {
      metadata: { bookingId, reminderType }
    })
    
    return { sent: true }
  }
  
  private async syncCustomerStats(payload: JobPayload['sync_customer_stats']) {
    const { customerId } = payload
    
    if (customerId) {
      // Sync single customer
      await this.supabase.rpc('rebuild_customer_category_stats', {
        p_customer_id: customerId
      })
    } else {
      // Sync all customers (be careful with this!)
      await this.supabase.rpc('rebuild_all_customer_category_stats')
    }
    
    return { success: true }
  }
  
  private async cleanupOldMessages(payload: JobPayload['cleanup_old_messages']) {
    const { daysToKeep } = payload
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)
    
    const { data, error } = await this.supabase
      .from('messages')
      .delete()
      .lt('created_at', cutoffDate.toISOString())
      .select()
    
    if (error) throw error
    
    return { deleted: data?.length || 0 }
  }
  
  private async updateSmsHealth(payload: JobPayload['update_sms_health']) {
    // This would update the customer_messaging_health view
    // For now, just return success
    return { success: true }
  }
}

// Export singleton instance
export const jobQueue = JobQueue.getInstance()