import { createAdminClient } from '@/lib/supabase/server'
import { Job, JobType, JobPayload, JobOptions } from './job-types'
import { logger } from './logger'

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
      
      // Process based on job type
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
        messageText = messageText.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
      })
      
      // Add contact phone if not in variables
      if (messageText.includes('{{contact_phone}}') && !payload.variables.contact_phone) {
        messageText = messageText.replace(/{{contact_phone}}/g, process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '')
      }
    }
    
    const result = await sendSMS(payload.to, messageText)
    
    if (!result.success) {
      throw new Error(result.error as string)
    }
    
    // Log message to database
    if (payload.customerId || payload.customer_id) {
      const supabase = await createAdminClient()
      await supabase
        .from('messages')
        .insert({
          customer_id: payload.customerId || payload.customer_id,
          direction: 'outbound',
          message_sid: result.sid,
          twilio_message_sid: result.sid,
          body: messageText,
          status: 'sent',
          twilio_status: 'queued',
          from_number: process.env.TWILIO_PHONE_NUMBER,
          to_number: payload.to,
          message_type: 'sms',
          metadata: payload.booking_id ? { booking_id: payload.booking_id } : null
        })
    }
    
    return { success: true }
  }
  
  private async processBulkSms(payload: JobPayload['send_bulk_sms']) {
    const { customerIds, message, eventId, categoryId } = payload
    const results = []
    const errors = []
    const supabase = await createAdminClient()
    const { sendSMS } = await import('./twilio')
    
    // Process in larger batches for efficiency
    const batchSize = 50 // Increased from 10 for better performance
    
    // Get event and category details if provided for personalization
    let eventDetails = null
    let categoryDetails = null
    
    if (eventId) {
      const { data: event } = await supabase
        .from('events')
        .select('id, name, date, time')
        .eq('id', eventId)
        .single()
      eventDetails = event
    }
    
    if (categoryId) {
      const { data: category } = await supabase
        .from('event_categories')
        .select('id, name')
        .eq('id', categoryId)
        .single()
      categoryDetails = category
    }
    
    // Calculate segments for cost estimation
    const messageLength = message.length
    const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
    const costUsd = segments * 0.04
    
    for (let i = 0; i < customerIds.length; i += batchSize) {
      const batch = customerIds.slice(i, i + batchSize)
      
      // Get customer details with all fields needed for personalization
      const { data: customers } = await supabase
        .from('customers')
        .select('id, first_name, last_name, mobile_number, sms_opt_in')
        .in('id', batch)
        .eq('sms_opt_in', true)
        .not('mobile_number', 'is', null)
      
      if (!customers) continue
      
      // Send SMS to each customer with personalization
      const messagesToInsert = []
      
      for (const customer of customers) {
        try {
          // Personalize the message for this customer
          let personalizedMessage = message
          personalizedMessage = personalizedMessage.replace(/{{customer_name}}/g, `${customer.first_name} ${customer.last_name}`)
          personalizedMessage = personalizedMessage.replace(/{{first_name}}/g, customer.first_name)
          personalizedMessage = personalizedMessage.replace(/{{last_name}}/g, customer.last_name || '')
          personalizedMessage = personalizedMessage.replace(/{{venue_name}}/g, 'The Anchor')
          personalizedMessage = personalizedMessage.replace(/{{contact_phone}}/g, process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707')
          
          // Add event-specific variables if available
          if (eventDetails) {
            personalizedMessage = personalizedMessage.replace(/{{event_name}}/g, eventDetails.name)
            personalizedMessage = personalizedMessage.replace(/{{event_date}}/g, new Date(eventDetails.date).toLocaleDateString('en-GB', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            }))
            personalizedMessage = personalizedMessage.replace(/{{event_time}}/g, eventDetails.time)
          }
          
          // Add category-specific variables if available
          if (categoryDetails) {
            personalizedMessage = personalizedMessage.replace(/{{category_name}}/g, categoryDetails.name)
          }
          
          // Send the personalized SMS directly (no more job multiplication)
          const result = await sendSMS(customer.mobile_number!, personalizedMessage)
          
          if (result.success) {
            // Prepare message for batch insert
            messagesToInsert.push({
              customer_id: customer.id,
              direction: 'outbound' as const,
              message_sid: result.sid,
              twilio_message_sid: result.sid,
              body: personalizedMessage,
              status: 'sent',
              twilio_status: 'queued' as const,
              from_number: process.env.TWILIO_PHONE_NUMBER || '',
              to_number: customer.mobile_number,
              message_type: 'sms' as const,
              segments: segments,
              cost_usd: costUsd,
              read_at: new Date().toISOString(), // Mark as read since it's outbound
              metadata: {
                bulk_job: true,
                event_id: eventId,
                category_id: categoryId
              }
            })
            
            results.push({
              customerId: customer.id,
              success: true,
              messageSid: result.sid
            })
          } else {
            errors.push({
              customerId: customer.id,
              error: result.error || 'Failed to send SMS'
            })
          }
        } catch (error) {
          logger.error('Failed to send SMS to customer', {
            error: error as Error,
            metadata: { customerId: customer.id }
          })
          errors.push({
            customerId: customer.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }
      
      // Batch insert all successful messages
      if (messagesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('messages')
          .insert(messagesToInsert)
        
        if (insertError) {
          logger.error('Failed to store messages in database', {
            error: insertError,
            metadata: { count: messagesToInsert.length }
          })
        }
      }
      
      // Add a small delay between batches to avoid overwhelming Twilio
      if (i + batchSize < customerIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)) // 1 second delay between batches
      }
    }
    
    logger.info('Bulk SMS job completed', {
      metadata: {
        total: customerIds.length,
        sent: results.length,
        failed: errors.length
      }
    })
    
    return { 
      sent: results.length,
      failed: errors.length,
      results,
      errors
    }
  }
  
  private async processReminder(payload: JobPayload['process_reminder']) {
    const { bookingId, reminderType } = payload
    
    // Get booking details
    const supabase = await createAdminClient()
    const { data: booking } = await supabase
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
    const { data: existingReminder } = await supabase
      .from('booking_reminders')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('reminder_type', reminderType)
      .single()
    
    if (existingReminder) {
      return { skipped: true, reason: 'Reminder already sent' }
    }
    
    // Import SMS templates and send the confirmation
    const { smsTemplates, getMessageTemplate, renderTemplate } = await import('./smsTemplates')
    const { sendSMS } = await import('./twilio')
    
    // Prepare template variables
    const templateVariables = {
      customer_name: `${booking.customer.first_name} ${booking.customer.last_name}`,
      first_name: booking.customer.first_name,
      event_name: booking.event.name,
      event_date: new Date(booking.event.date).toLocaleDateString('en-GB', {
        month: 'long',
        day: 'numeric',
      }),
      event_time: booking.event.time,
      seats: booking.seats?.toString() || '0',
      venue_name: 'The Anchor',
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
      booking_reference: bookingId.substring(0, 8).toUpperCase()
    }
    
    // Try to get template from database
    const templateType = booking.seats ? 'bookingConfirmation' : 'reminderOnly'
    let message = await getMessageTemplate(booking.event.id, templateType, templateVariables)
    
    // Fall back to legacy templates if database template not found
    if (!message) {
      message = booking.seats
        ? smsTemplates.bookingConfirmation({
            firstName: booking.customer.first_name,
            seats: booking.seats,
            eventName: booking.event.name,
            eventDate: new Date(booking.event.date),
            eventTime: booking.event.time,
          })
        : smsTemplates.reminderOnly({
            firstName: booking.customer.first_name,
            eventName: booking.event.name,
            eventDate: new Date(booking.event.date),
            eventTime: booking.event.time,
          })
    }
    
    // Send the SMS
    const result = await sendSMS(booking.customer.mobile_number, message)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to send SMS')
    }
    
    // Calculate segments and cost
    const messageLength = message.length
    const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
    const costUsd = segments * 0.04
    
    // Log message to database
    const { error: messageError } = await supabase
      .from('messages')
      .insert({
        customer_id: booking.customer.id,
        direction: 'outbound',
        message_sid: result.sid,
        twilio_message_sid: result.sid,
        body: message,
        status: 'sent',
        twilio_status: 'queued',
        from_number: process.env.TWILIO_PHONE_NUMBER || '',
        to_number: booking.customer.mobile_number,
        message_type: 'sms',
        segments: segments,
        cost_usd: costUsd
      })
      .select('id')
      .single()
    
    if (messageError) {
      logger.error('Failed to store message in database', {
        error: messageError,
        metadata: { bookingId, customerId: booking.customer.id }
      })
    }
    
    // Record the reminder as sent (using 24_hour for confirmations)
    const actualReminderType = reminderType === '24_hour' ? '24_hour' : reminderType
    const { error: reminderError } = await supabase
      .from('booking_reminders')
      .insert({
        booking_id: bookingId,
        reminder_type: actualReminderType,
        message_id: messageError ? null : result.sid
      })
    
    if (reminderError) {
      logger.error('Failed to record reminder', {
        error: reminderError,
        metadata: { bookingId, reminderType: actualReminderType }
      })
    }
    
    logger.info('Booking confirmation SMS sent', {
      metadata: { 
        bookingId, 
        customerId: booking.customer.id,
        messageSid: result.sid 
      }
    })
    
    return { sent: true, messageSid: result.sid }
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