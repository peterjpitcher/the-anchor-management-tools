import { createAdminClient } from '@/lib/supabase/admin'
import { Job, JobType, JobPayload, JobOptions } from './job-types'
import { logger } from './logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { formatTime12Hour, formatDateInLondon } from '@/lib/dateUtils'

export class JobQueue {
  private static instance: JobQueue
  
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
    if (type === 'send_sms') {
      const smsPayload = payload as JobPayload['send_sms']
      const customerId = smsPayload.customerId || smsPayload.customer_id
      if (!customerId) {
        logger.error('Rejected send_sms job without customer id', {
          metadata: { payload }
        })
        throw new Error('send_sms jobs require a customerId for logging')
      }
    }

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
    
    const supabase = await createAdminClient()
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
    const supabase = await createAdminClient()
    
    // First, clean up any stuck processing jobs (older than 2 minutes)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    await supabase
      .from('jobs')
      .update({
        status: 'failed',
        error_message: 'Job timed out - stuck in processing',
        completed_at: new Date().toISOString()
      })
      .eq('status', 'processing')
      .lt('started_at', twoMinutesAgo)
    
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
    
    // Process jobs with timeout protection
    // Use smaller batches to avoid overwhelming the system
    const batchSize = 5
    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize)
      
      // Add timeout wrapper for each batch (max 10 seconds per batch)
      await Promise.race([
        Promise.allSettled(batch.map(job => this.processJob(job))),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Batch processing timeout')), 10000)
        )
      ]).catch(err => {
        logger.error('Batch processing timeout', { 
          error: err,
          metadata: { batchIndex: i / batchSize }
        })
      })
    }
  }
  
  /**
   * Process a single job
   */
  private async processJob(job: any): Promise<void> {
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
      
      // Process job; bulk SMS can legitimately take longer, so skip the 30s timeout there
      const execution = this.executeJob(job.type, job.payload, job.id)
      const result = job.type === 'send_bulk_sms'
        ? await execution
        : await Promise.race([
            execution,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Job execution timeout (30s)')), 30000)
            )
          ])
      
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
          attempt: job.attempts + 1,
          willRetry: shouldRetry
        }
      })
    }
  }
  
  /**
   * Execute job based on type
   */
  private async executeJob(type: JobType, payload: any, jobId?: string): Promise<any> {
    switch (type) {
      case 'send_sms':
        return this.processSendSms(payload)
      
      case 'send_bulk_sms':
        return this.processBulkSms(payload, jobId)
      
      case 'sync_customer_stats':
        return this.syncCustomerStats(payload)
      
      case 'cleanup_old_messages':
        return this.cleanupOldMessages(payload)
      
      case 'update_sms_health':
        return this.updateSmsHealth(payload)

      case 'send_email':
        return this.processSendEmail(payload)
      
      default:
        throw new Error(`Unknown job type: ${type}`)
    }
  }
  
  // Job processors

  private async processSendEmail(payload: JobPayload['send_email']) {
    const { 
      sendBookingConfirmationEmail, 
      sendBookingCancellationEmail, 
      sendBookingReminderEmail 
    } = await import('@/app/actions/table-booking-email')

    let result

    switch (payload.template) {
      case 'table_booking_confirmation':
      case 'table_booking_confirmation_sunday_lunch':
        if (!payload.booking_id) throw new Error('booking_id required')
        result = await sendBookingConfirmationEmail(payload.booking_id, true)
        break
        
      case 'table_booking_cancellation':
        if (!payload.booking_id) throw new Error('booking_id required')
        result = await sendBookingCancellationEmail(
          payload.booking_id,
          payload.refund_message || 'No payment was taken for this booking.'
        )
        break
        
      case 'table_booking_reminder':
        if (!payload.booking_id) throw new Error('booking_id required')
        result = await sendBookingReminderEmail(payload.booking_id)
        break
        
      // Add payment request case if you implement it
      // case 'table_booking_payment_request': ...

      default:
        throw new Error(`Unknown email template: ${payload.template}`)
    }

    if (result.error) {
      throw new Error(result.error)
    }

    return result
  }
  
  private async processSendSms(payload: JobPayload['send_sms']) {
    const { sendSMS } = await import('./twilio')
    let messageText = payload.message || ''
    
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
      messageText = template.template_text
      Object.entries(payload.variables).forEach(([key, value]) => {
        const replacement = key === 'event_time' ? formatTime12Hour(String(value)) : String(value)
        messageText = messageText.replace(new RegExp(`{{${key}}}`, 'g'), replacement)
      })
      
      // Add contact phone if not in variables
      if (messageText.includes('{{contact_phone}}') && !payload.variables.contact_phone) {
        messageText = messageText.replace(/{{contact_phone}}/g, process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '')
      }
    }
    
    const supportPhone = (payload.variables?.contact_phone as string | undefined) || process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    const messageWithSupport = ensureReplyInstruction(messageText, supportPhone)

    const result = await sendSMS(payload.to, messageWithSupport, {
      customerId: payload.customerId || payload.customer_id,
      metadata: payload.booking_id ? { booking_id: payload.booking_id } : undefined
    })

    if (!result.success || !result.sid) {
      throw new Error(result.error as string)
    }
    
    return { success: true, sid: result.sid }
  }
  
  private async processBulkSms(payload: JobPayload['send_bulk_sms'], jobId?: string) {
    const { sendBulkSms } = await import('@/lib/sms/bulk')
    const result = await sendBulkSms({
      customerIds: payload.customerIds,
      message: payload.message,
      eventId: payload.eventId,
      categoryId: payload.categoryId,
      bulkJobId: jobId || 'job_queue'
    })

    if (!result.success) {
      throw new Error(result.error)
    }

    return result
  }
  
  private async syncCustomerStats(payload: JobPayload['sync_customer_stats']) {
    const { customerId } = payload
    const supabase = await createAdminClient()
    
    if (customerId) {
      // Sync single customer
      await supabase.rpc('rebuild_customer_category_stats', {
        p_customer_id: customerId
      })
    } else {
      // Sync all customers (be careful with this!)
      await supabase.rpc('rebuild_all_customer_category_stats')
    }
    
    return { success: true }
  }
  
  private async cleanupOldMessages(payload: JobPayload['cleanup_old_messages']) {
    const { daysToKeep } = payload
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)
    
    const supabase = await createAdminClient()
    const { data, error } = await supabase
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
