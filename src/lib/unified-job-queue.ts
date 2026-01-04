/**
 * Unified Job Queue System
 * This replaces the multiple job queue implementations with a single, consistent system
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from './logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { formatTime12Hour } from '@/lib/dateUtils'
import { sendEventReminderById } from '@/lib/reminders/send-event-reminder'

const DEBUG_JOB_QUEUE = process.env.JOB_QUEUE_DEBUG === '1'

function logQueueDebug(message: string, metadata?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    logger.info(message, { metadata })
    return
  }

  if (DEBUG_JOB_QUEUE) {
    console.log(`[job-queue] ${message}`, metadata ?? {})
  }
}

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
  | 'classify_receipt_transactions'

const SUPPORTED_JOB_TYPES: JobType[] = [
  'send_sms',
  'send_bulk_sms',
  'export_employees',
  'rebuild_category_stats',
  'categorize_historical_events',
  'process_booking_reminder',
  'process_event_reminder',
  'generate_report',
  'sync_calendar',
  'cleanup_old_data',
  'classify_receipt_transactions',
]

const STALE_JOB_MINUTES = Number.isFinite(Number(process.env.JOB_QUEUE_STALE_MINUTES))
  ? Number(process.env.JOB_QUEUE_STALE_MINUTES)
  : 30
const DEFAULT_JOB_TIMEOUT_MS = Number.isFinite(Number(process.env.JOB_QUEUE_TIMEOUT_MS))
  ? Number(process.env.JOB_QUEUE_TIMEOUT_MS)
  : 120000
const DEFAULT_LEASE_SECONDS = Number.isFinite(Number(process.env.JOB_QUEUE_LEASE_SECONDS))
  ? Number(process.env.JOB_QUEUE_LEASE_SECONDS)
  : Math.max(60, Math.ceil(DEFAULT_JOB_TIMEOUT_MS / 1000))
const HEARTBEAT_MS = Number.isFinite(Number(process.env.JOB_QUEUE_HEARTBEAT_MS))
  ? Number(process.env.JOB_QUEUE_HEARTBEAT_MS)
  : 30000
const JOB_TIMEOUTS_MS: Partial<Record<JobType, number>> = {
  send_bulk_sms: 0,
}

function resolveJobTimeoutMs(type: JobType): number {
  const override = JOB_TIMEOUTS_MS[type]
  if (typeof override === 'number') {
    return override
  }
  return DEFAULT_JOB_TIMEOUT_MS
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise
  }

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

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
  processing_token?: string | null
  lease_expires_at?: string | null
  last_heartbeat_at?: string | null
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

  private constructor() { }

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
      .in('type', SUPPORTED_JOB_TYPES)
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

  private async claimJobs(
    supabase: ReturnType<typeof createAdminClient>,
    options: { limit: number; types: JobType[] }
  ): Promise<Job[]> {
    if (options.limit <= 0) {
      return []
    }

    const { data, error } = await supabase.rpc('claim_jobs', {
      batch_size: options.limit,
      job_types: options.types,
      lease_seconds: DEFAULT_LEASE_SECONDS,
    })

    if (error) {
      logger.error('Failed to claim jobs', { error })
      const message = typeof error.message === 'string' ? error.message : ''
      const isMissingRpc = error.code === 'PGRST202' || message.includes('claim_jobs')
      if (isMissingRpc) {
        logger.warn('claim_jobs RPC unavailable; falling back to direct claim', {
          metadata: { limit: options.limit, types: options.types }
        })
        return this.claimJobsFallback(supabase, options)
      }
      return []
    }

    return (data ?? []) as Job[]
  }

  private async claimJobsFallback(
    supabase: ReturnType<typeof createAdminClient>,
    options: { limit: number; types: JobType[] }
  ): Promise<Job[]> {
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', now)
      .in('type', options.types)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(Math.max(options.limit * 2, options.limit))

    if (error) {
      logger.error('Failed to load pending jobs for fallback claim', { error })
      return []
    }

    const candidates = (data ?? [])
      .filter((job) => Number(job.attempts ?? 0) < Number(job.max_attempts ?? 3))
      .slice(0, options.limit)

    if (candidates.length === 0) {
      return []
    }

    const claimed: Job[] = []
    for (const job of candidates) {
      const update: Record<string, any> = {
        status: 'processing',
        started_at: now,
        attempts: Number(job.attempts ?? 0) + 1,
        updated_at: now,
      }

      if (Object.prototype.hasOwnProperty.call(job, 'processing_token')) {
        update.processing_token = crypto.randomUUID()
        if (Object.prototype.hasOwnProperty.call(job, 'lease_expires_at')) {
          update.lease_expires_at = new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString()
        }
        if (Object.prototype.hasOwnProperty.call(job, 'last_heartbeat_at')) {
          update.last_heartbeat_at = now
        }
      }

      const { data: updated, error: updateError } = await supabase
        .from('jobs')
        .update(update)
        .eq('id', job.id)
        .eq('status', 'pending')
        .select('*')

      if (updateError) {
        logger.warn('Failed to claim job in fallback mode', { error: updateError, metadata: { jobId: job.id } })
        continue
      }

      if (updated?.[0]) {
        claimed.push(updated[0] as Job)
      }
    }

    return claimed
  }

  private async resetStaleJobs(supabase: ReturnType<typeof createAdminClient>) {
    if (!Number.isFinite(STALE_JOB_MINUTES) || STALE_JOB_MINUTES <= 0) {
      return
    }

    const { data, error } = await supabase
      .from('jobs')
      .select('id, type, payload, attempts, max_attempts, started_at, lease_expires_at')
      .eq('status', 'processing')
      .in('type', SUPPORTED_JOB_TYPES)

    if (error) {
      logger.warn('Failed to load processing jobs for stale reset', { error })
      return
    }

    const typedJobs = (data ?? []) as Array<Pick<Job, 'id' | 'type' | 'payload' | 'attempts' | 'max_attempts' | 'started_at' | 'lease_expires_at'>>
    const cutoffMs = Date.now() - STALE_JOB_MINUTES * 60 * 1000
    const staleJobs = typedJobs.filter((job) => {
      const leaseMs = job.lease_expires_at ? Date.parse(job.lease_expires_at) : Number.NaN
      if (Number.isFinite(leaseMs)) {
        return leaseMs <= Date.now()
      }
      if (!job.started_at) return true
      const startedAtMs = Date.parse(job.started_at)
      if (!Number.isFinite(startedAtMs)) return true
      return startedAtMs <= cutoffMs
    })

    if (staleJobs.length === 0) {
      return
    }

    const now = new Date().toISOString()

    await Promise.allSettled(
      staleJobs.map(async (job) => {
        const attempts = Number(job.attempts ?? 0)
        const maxAttempts = Number(job.max_attempts ?? 3)
        const shouldRetry = attempts < maxAttempts
        const errorMessage = shouldRetry
          ? 'Job timed out - reset to pending'
          : 'Job timed out - max attempts reached'
        const update = shouldRetry
          ? {
            status: 'pending',
            scheduled_for: now,
            started_at: null,
            processing_token: null,
            lease_expires_at: null,
            last_heartbeat_at: null,
            error_message: errorMessage,
            updated_at: now,
          }
          : {
            status: 'failed',
            failed_at: now,
            processing_token: null,
            lease_expires_at: null,
            last_heartbeat_at: null,
            error_message: errorMessage,
            updated_at: now,
          }
        const { error: updateError } = await supabase
          .from('jobs')
          .update(update)
          .eq('id', job.id)

        if (updateError) {
          logger.warn('Failed to reset stale job', { error: updateError, metadata: { jobId: job.id } })
          return
        }

      })
    )

    logQueueDebug('Reset stale processing jobs', {
      count: staleJobs.length,
      cutoffMinutes: STALE_JOB_MINUTES,
    })
  }

  /**
   * Process pending jobs
   */
  async processJobs(limit = 10): Promise<void> {
    const supabase = await createAdminClient()
    await this.resetStaleJobs(supabase)

    const jobs = await this.claimJobs(supabase, {
      limit,
      types: SUPPORTED_JOB_TYPES,
    })

    if (jobs.length === 0) {
      logQueueDebug('No pending jobs found')
      return
    }

    logQueueDebug('Processing pending jobs', {
      count: jobs.length,
      types: jobs.reduce<Record<string, number>>((acc, job) => {
        acc[job.type] = (acc[job.type] || 0) + 1
        return acc
      }, {}),
    })

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
    const token = job.processing_token ?? null
    let heartbeat: ReturnType<typeof setInterval> | null = null

    try {
      logQueueDebug('Starting job', { jobId: job.id, type: job.type })

      if (token) {
        const updateLease = async () => {
          const now = new Date().toISOString()
          await supabase
            .from('jobs')
            .update({
              lease_expires_at: new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString(),
              last_heartbeat_at: now,
              updated_at: now,
            })
            .eq('id', job.id)
            .eq('processing_token', token)
        }

        heartbeat = setInterval(() => {
          void updateLease().catch((error) => {
            logger.warn('Failed to update job lease', { error: error as Error })
          })
        }, HEARTBEAT_MS)
      } else {
        logger.warn('Processing job without token; guarded updates disabled.', {
          metadata: { jobId: job.id, type: job.type }
        })
      }

      // Execute job based on type with timeout protection
      const timeoutMs = resolveJobTimeoutMs(job.type)
      const result = await withTimeout(
        this.executeJob(job.type, job.payload),
        timeoutMs,
        `Job execution timeout (${timeoutMs}ms)`
      )

      // Mark as completed
      const completeUpdate = supabase
        .from('jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          processing_token: null,
          lease_expires_at: null,
          last_heartbeat_at: null,
          result,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      if (token) {
        completeUpdate.eq('processing_token', token)
      }

      await completeUpdate

      logger.info(`Job completed: ${job.type}`, {
        metadata: {
          jobId: job.id,
          duration: Date.now() - startTime
        }
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Check if should retry
      const attempts = Number(job.attempts ?? 0)
      const maxAttempts = Number(job.max_attempts ?? 3)
      const shouldRetry = attempts < maxAttempts
      const attemptIndex = Math.max(0, attempts - 1)

      const failureUpdate = supabase
        .from('jobs')
        .update({
          status: shouldRetry ? 'pending' : 'failed',
          error_message: errorMessage,
          failed_at: shouldRetry ? null : new Date().toISOString(),
          // Exponential backoff for retries
          scheduled_for: shouldRetry
            ? new Date(Date.now() + Math.pow(2, attemptIndex) * 60000).toISOString()
            : job.scheduled_for,
          processing_token: null,
          lease_expires_at: null,
          last_heartbeat_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      if (token) {
        failureUpdate.eq('processing_token', token)
      }

      await failureUpdate

      logger.error(`Job failed: ${job.type}`, {
        error: error as Error,
        metadata: {
          jobId: job.id,
          attempts,
          willRetry: shouldRetry
        }
      })
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat)
      }
    }
  }

  /**
   * Execute job based on type
   */
  private async executeJob(type: JobType, payload: JobPayload): Promise<any> {
    // Import handlers dynamically to avoid circular dependencies
    switch (type) {
      case 'classify_receipt_transactions': {
        const transactionIds = Array.isArray(payload.transactionIds)
          ? payload.transactionIds.filter((id) => typeof id === 'string' && id.length > 0)
          : []

        if (!transactionIds.length) {
          return { skipped: true }
        }

        const { classifyReceiptTransactionsWithAI } = await import('@/lib/receipts/ai-classification')
        const supabase = createAdminClient()

        await classifyReceiptTransactionsWithAI(supabase, transactionIds)
        return { processed: transactionIds.length }
      }

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

          const result = await sendSMS(payload.to, messageWithSupport, {
            customerId: payload.customer_id || payload.customerId,
            metadata: payload.booking_id ? { booking_id: payload.booking_id } : undefined
          })

          return result
        } else {
          // Regular SMS with plain text message
          const { sendSMS } = await import('@/lib/twilio')
          const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
          const messageWithSupport = ensureReplyInstruction(payload.message || '', supportPhone)

          const result = await sendSMS(payload.to, messageWithSupport, {
            customerId: payload.customer_id || payload.customerId,
            metadata: payload.booking_id ? { booking_id: payload.booking_id } : undefined
          })

          return result
        }

      case 'send_bulk_sms':
        {
          const { sendBulkSms } = await import('@/lib/sms/bulk')
          const result = await sendBulkSms({
            customerIds: payload.customerIds,
            message: payload.message,
            eventId: payload.eventId,
            categoryId: payload.categoryId,
            bulkJobId: payload?.jobId || 'unified_queue'
          })
          if (!result.success) {
            throw new Error(result.error)
          }
          return result
        }

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
        {
          const reminderId = payload.reminder_id || payload.reminderId
          if (!reminderId || typeof reminderId !== 'string') {
            throw new Error('process_event_reminder jobs require a reminder_id')
          }
          const result = await sendEventReminderById(reminderId)
          if (!result.success) {
            throw new Error(result.error)
          }
          return result
        }

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
