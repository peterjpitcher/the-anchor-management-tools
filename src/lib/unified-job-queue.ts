/**
 * Unified Job Queue System
 * This replaces the multiple job queue implementations with a single, consistent system
 */

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from './logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { claimIdempotencyKey, releaseIdempotencyClaim } from '@/lib/api/idempotency'

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

function buildJobEnqueueLockKey(type: JobType, uniqueKey: string): string {
  const normalized = uniqueKey.trim()
  const prefix = `job_enqueue:${type}:`
  const maxKeyLength = 255
  const maxUniqueLength = Math.max(0, maxKeyLength - prefix.length)

  if (normalized.length <= maxUniqueLength) {
    return `${prefix}${normalized}`
  }

  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 48)
  return `${prefix}sha:${digest}`
}

function buildJobEnqueueLockRequestHash(type: JobType, uniqueKey: string): string {
  // Unique keys are already intended to represent the enqueue identity; keep the
  // request hash stable so "double click" replays don't become idempotency conflicts.
  return createHash('sha256').update(`${type}:${uniqueKey.trim()}`).digest('hex')
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

type FatalSmsSafetyCode = 'logging_failed' | 'safety_unavailable' | 'idempotency_conflict'

function isFatalSmsSafetyCode(code: unknown): code is FatalSmsSafetyCode {
  return (
    code === 'logging_failed'
    || code === 'safety_unavailable'
    || code === 'idempotency_conflict'
  )
}

function parseBulkSmsAbortCode(message: unknown): FatalSmsSafetyCode | null {
  if (typeof message !== 'string') {
    return null
  }

  const match = /Bulk SMS aborted due to safety failure \\(([^)]+)\\)/.exec(message)
  if (!match) {
    return null
  }

  const code = match[1]
  return isFatalSmsSafetyCode(code) ? code : null
}

class FatalSmsSafetyError extends Error {
  code: FatalSmsSafetyCode
  smsSent: boolean

  constructor(params: { code: FatalSmsSafetyCode; message: string; smsSent: boolean }) {
    super(params.message)
    this.name = 'FatalSmsSafetyError'
    this.code = params.code
    this.smsSent = params.smsSent
  }
}

type ProcessJobOutcome = {
  ok: boolean
  fatalSmsSafetyFailure: boolean
  fatalCode?: FatalSmsSafetyCode
  errorMessage?: string
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
    let supabase: Awaited<ReturnType<typeof createAdminClient>> | null = null
    let enqueueLock: { key: string; requestHash: string } | null = null
    let enqueueLockClaimed = false

    try {
      supabase = await createAdminClient()

      // Check for unique constraint if provided
      if (options.unique) {
        enqueueLock = {
          key: buildJobEnqueueLockKey(type, options.unique),
          requestHash: buildJobEnqueueLockRequestHash(type, options.unique),
        }

        const lockTtlHours = 0.25 // 15 minutes; should be released immediately on success/failure.
        const lockState = await claimIdempotencyKey(
          supabase as any,
          enqueueLock.key,
          enqueueLock.requestHash,
          lockTtlHours
        )

        if (lockState.state === 'conflict') {
          logger.error('Unable to acquire job enqueue idempotency lock due to conflict', {
            metadata: {
              type,
              uniqueKey: options.unique,
              lockKey: enqueueLock.key,
            }
          })
          return {
            success: false,
            error: 'Failed to acquire job enqueue idempotency lock (conflict)',
          }
        }

        if (lockState.state === 'in_progress' || lockState.state === 'replay') {
          // Another caller is already enqueuing this unique job. Fail closed to avoid duplicates,
          // but attempt to return an existing pending/processing job id if it is already visible.
          const { data: existingRows, error: existingError } = await supabase
            .from('jobs')
            .select('id, status')
            .eq('type', type)
            .in('status', ['pending', 'processing'])
            .contains('payload', { unique_key: options.unique })
            .order('created_at', { ascending: false })
            .limit(1)

          if (existingError) {
            logger.error('Unable to verify unique job constraint during enqueue lock contention', {
              metadata: {
                type,
                uniqueKey: options.unique,
                error: existingError.message,
              }
            })
            return {
              success: false,
              error: `Failed to verify unique job constraint: ${existingError.message || 'unknown database error'}`,
            }
          }

          const existing = existingRows?.[0]
          if (existing) {
            logger.info(`Job with unique key ${options.unique} already exists (lock contention)`, {
              metadata: { jobId: existing.id, type, status: existing.status }
            })
            return { success: true, jobId: existing.id }
          }

          logger.warn('Job enqueue already in progress; no pending/processing job row visible yet', {
            metadata: {
              type,
              uniqueKey: options.unique,
              lockKey: enqueueLock.key,
            }
          })
          return {
            success: false,
            error: 'Job enqueue already in progress; retry shortly',
          }
        }

        enqueueLockClaimed = lockState.state === 'claimed'

        const { data: existingRows, error: existingError } = await supabase
          .from('jobs')
          .select('id, status')
          .eq('type', type)
          .in('status', ['pending', 'processing'])
          .contains('payload', { unique_key: options.unique })
          .order('created_at', { ascending: false })
          .limit(1)

        if (existingError) {
          logger.error('Unable to verify unique job constraint; blocking enqueue to fail closed', {
            metadata: {
              type,
              uniqueKey: options.unique,
              error: existingError.message
            }
          })
          return {
            success: false,
            error: `Failed to verify unique job constraint: ${existingError.message || 'unknown database error'}`
          }
        }

        const existing = existingRows?.[0]
        if (existing) {
          logger.info(`Job with unique key ${options.unique} already exists`, {
            metadata: { jobId: existing.id, type, status: existing.status }
          })
          return { success: true, jobId: existing.id }
        }
      }

      if (type === 'send_sms') {
        const smsPayload = payload as JobPayload
        const customerId = (smsPayload as any).customer_id ?? (smsPayload as any).customerId
        if (!customerId) {
          logger.warn('Enqueuing send_sms job without explicit customer id; resolver will run at send time', {
            metadata: { payload }
          })
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
    } finally {
      if (enqueueLockClaimed && enqueueLock && supabase) {
        try {
          await releaseIdempotencyClaim(supabase as any, enqueueLock.key, enqueueLock.requestHash)
        } catch (releaseError) {
          logger.warn('Failed releasing job enqueue idempotency lock', {
            metadata: {
              type,
              uniqueKey: options.unique ?? null,
              lockKey: enqueueLock.key,
              error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            }
          })
        }
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
        const { data: updatedRow, error: updateError } = await supabase
          .from('jobs')
          .update(update)
          .eq('id', job.id)
          .select('id')
          .maybeSingle()

        if (updateError) {
          logger.warn('Failed to reset stale job', { error: updateError, metadata: { jobId: job.id } })
          return
        }

        if (!updatedRow) {
          logger.warn('Skipping stale job reset because row no longer exists', {
            metadata: { jobId: job.id }
          })
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

    const sendJobTypes: JobType[] = ['send_sms', 'send_bulk_sms']
    const sendJobs = jobs.filter((job) => sendJobTypes.includes(job.type))
    const otherJobs = jobs.filter((job) => !sendJobTypes.includes(job.type))

    // Non-SMS jobs can run concurrently.
    if (otherJobs.length > 0) {
      await Promise.allSettled(
        otherJobs.map((job) => this.processJob(job))
      )
    }

    // SMS jobs must run serially so we can abort remaining sends on fatal safety signals
    // (e.g., outbound message persistence failures).
    let abort: { code: FatalSmsSafetyCode; message: string } | null = null
    for (const job of sendJobs) {
      if (abort) {
        await this.requeueAbortedSendJob(supabase, job, abort)
        continue
      }

      const outcome = await this.processJob(job)
      if (outcome.fatalSmsSafetyFailure && outcome.fatalCode) {
        abort = {
          code: outcome.fatalCode,
          message: outcome.errorMessage || 'Fatal SMS safety failure',
        }
        logger.error('Aborting remaining SMS jobs due to fatal safety failure', {
          metadata: {
            code: abort.code,
            jobId: job.id,
            error: abort.message,
          }
        })
      }
    }
  }

  private async requeueAbortedSendJob(
    supabase: ReturnType<typeof createAdminClient>,
    job: Job,
    abort: { code: FatalSmsSafetyCode; message: string }
  ): Promise<void> {
    const now = new Date().toISOString()
    const token = job.processing_token ?? null
    const rescheduleFor = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const errorMessage = `Aborted due to fatal SMS safety failure (${abort.code}): ${abort.message}`
    const truncatedErrorMessage = errorMessage.length > 500 ? errorMessage.slice(0, 500) : errorMessage

    let update: any = supabase
      .from('jobs')
      .update({
        status: 'pending',
        scheduled_for: rescheduleFor,
        started_at: null,
        completed_at: null,
        failed_at: null,
        processing_token: null,
        lease_expires_at: null,
        last_heartbeat_at: null,
        error_message: truncatedErrorMessage,
        updated_at: now,
      })
      .eq('id', job.id)

    if (token) {
      update = update.eq('processing_token', token)
    }

    const { data: updatedRow, error } = await update.select('id').maybeSingle()

    if (error) {
      logger.error('Failed to requeue aborted SMS job', {
        error,
        metadata: {
          jobId: job.id,
          code: abort.code,
        }
      })
      return
    }

    if (!updatedRow) {
      logger.warn('Aborted SMS job requeue affected no rows', {
        metadata: {
          jobId: job.id,
          tokenPresent: Boolean(token),
          code: abort.code,
        }
      })
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: Job): Promise<ProcessJobOutcome> {
    const startTime = Date.now()
    const supabase = await createAdminClient()
    const token = job.processing_token ?? null
    let heartbeat: ReturnType<typeof setInterval> | null = null
    let abortLease: ((error: Error) => void) | null = null
    let leaseLost: Promise<never> | null = null

    try {
      logQueueDebug('Starting job', { jobId: job.id, type: job.type })

      if (token) {
        const updateLease = async () => {
          const now = new Date().toISOString()
          const { data: leaseRow, error: leaseError } = await supabase
            .from('jobs')
            .update({
              lease_expires_at: new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString(),
              last_heartbeat_at: now,
              updated_at: now,
            })
            .eq('id', job.id)
            .eq('processing_token', token)
            .select('id')
            .maybeSingle()
          if (leaseError) {
            throw new Error(`Failed to update job lease: ${leaseError.message}`)
          }
          if (!leaseRow) {
            throw new Error('Failed to update job lease: no row updated')
          }
        }

        let leaseAborted = false
        leaseLost = new Promise<never>((_, reject) => {
          abortLease = (error: Error) => {
            if (leaseAborted) return
            leaseAborted = true
            reject(error)
          }
        })

        // Fail closed before running side effects if our lease token is already invalid.
        await updateLease()

        heartbeat = setInterval(() => {
          void updateLease().catch((error) => {
            const leaseError = error instanceof Error ? error : new Error(String(error))
            logger.error('Job lease heartbeat failed; aborting execution', {
              error: leaseError,
              metadata: { jobId: job.id, type: job.type }
            })
            if (heartbeat) {
              clearInterval(heartbeat)
              heartbeat = null
            }
            abortLease?.(leaseError)
          })
        }, HEARTBEAT_MS)
      } else {
        logger.warn('Processing job without token; guarded updates disabled.', {
          metadata: { jobId: job.id, type: job.type }
        })
      }

      // Execute job based on type with timeout protection
      const timeoutMs = resolveJobTimeoutMs(job.type)
      const execution = withTimeout(
        this.executeJob(job.type, { ...job.payload, __job_id: job.id }),
        timeoutMs,
        `Job execution timeout (${timeoutMs}ms)`
      )
      const result = leaseLost ? await Promise.race([execution, leaseLost]) : await execution

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

      const { data: completedRow, error: completeError } = await completeUpdate
        .select('id')
        .maybeSingle()
      if (completeError) {
        // For SMS jobs, a completion-persistence failure happens after side effects ran and can
        // cause retries to dribble duplicate sends. Treat as a fatal safety signal.
        if (job.type === 'send_sms' || job.type === 'send_bulk_sms') {
          throw new FatalSmsSafetyError({
            code: 'logging_failed',
            message: `Failed to persist job completion state: ${completeError.message}`,
            smsSent: true,
          })
        }

        throw new Error(`Failed to mark job completed: ${completeError.message}`)
      }
      if (!completedRow) {
        if (job.type === 'send_sms' || job.type === 'send_bulk_sms') {
          throw new FatalSmsSafetyError({
            code: 'logging_failed',
            message: 'Failed to persist job completion state: no row updated',
            smsSent: true,
          })
        }

        throw new Error('Failed to mark job completed: no row updated')
      }

      logger.info(`Job completed: ${job.type}`, {
        metadata: {
          jobId: job.id,
          duration: Date.now() - startTime
        }
      })

      return { ok: true, fatalSmsSafetyFailure: false }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const fatalError = error instanceof FatalSmsSafetyError ? error : null
      const isSmsJob = job.type === 'send_sms' || job.type === 'send_bulk_sms'

      // Check if should retry
      const attempts = Number(job.attempts ?? 0)
      const maxAttempts = Number(job.max_attempts ?? 3)
      let shouldRetry = attempts < maxAttempts
      if (fatalError?.code === 'logging_failed') {
        // Transport send already succeeded; retries cannot repair missing persistence and can dribble sends.
        shouldRetry = false
      }
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

      const { data: failedRow, error: failurePersistError } = await failureUpdate
        .select('id')
        .maybeSingle()

      let persistenceFatal: { code: FatalSmsSafetyCode; message: string } | null = null
      if (failurePersistError) {
        logger.error('Failed to persist job failure state', {
          error: failurePersistError,
          metadata: { jobId: job.id, type: job.type }
        })
        if (isSmsJob) {
          persistenceFatal = {
            code: 'safety_unavailable',
            message: `Failed to persist job failure state: ${failurePersistError.message}`,
          }
        }
      } else if (!failedRow) {
        logger.warn('Job failure state was not persisted (no row updated)', {
          metadata: { jobId: job.id, type: job.type, tokenPresent: Boolean(token) }
        })
        if (isSmsJob) {
          persistenceFatal = {
            code: 'safety_unavailable',
            message: 'Failed to persist job failure state: no row updated',
          }
        }
      }

      if (persistenceFatal) {
        logger.error('SMS job failure persistence failed; aborting further SMS processing', {
          metadata: {
            jobId: job.id,
            type: job.type,
            code: persistenceFatal.code,
            error: persistenceFatal.message,
          }
        })
      }

      logger.error(`Job failed: ${job.type}`, {
        error: error as Error,
        metadata: {
          jobId: job.id,
          attempts,
          willRetry: shouldRetry
        }
      })

      const combinedErrorMessage = persistenceFatal
        ? `${errorMessage}; ${persistenceFatal.message}`
        : errorMessage

      return {
        ok: false,
        fatalSmsSafetyFailure: Boolean(fatalError) || Boolean(persistenceFatal),
        fatalCode: fatalError?.code ?? persistenceFatal?.code,
        errorMessage: combinedErrorMessage,
      }
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
        if (payload.template) {
          throw new Error('Template-based SMS jobs are no longer supported')
        }

        {
          const rawCustomerId = payload.customer_id ?? payload.customerId
          const customerId =
            typeof rawCustomerId === 'string' && rawCustomerId.trim().length > 0
              ? rawCustomerId.trim()
              : null

          if (!customerId) {
            throw new Error('send_sms job blocked: missing customer_id')
          }

          const { sendSMS } = await import('@/lib/twilio')
          const jobId = typeof payload.__job_id === 'string' ? payload.__job_id : null
          const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
          const messageWithSupport = ensureReplyInstruction(payload.message || '', supportPhone)
          const baseMetadata =
            typeof payload.metadata === 'object' && payload.metadata !== null
              ? { ...(payload.metadata as Record<string, unknown>) }
              : {}
          if (jobId && baseMetadata.queue_job_id === undefined) {
            // Keep job correlation metadata out of idempotency context to avoid
            // turning duplicate SMS payloads into unique sends.
            baseMetadata.queue_job_id = jobId
          }
          if (baseMetadata.template_key === undefined) {
            // Ensure distributed SMS dedupe stays active for queue-driven sends.
            baseMetadata.template_key = 'job_queue_sms'
          }
          if (baseMetadata.stage === undefined) {
            // Include a message fingerprint in context so different queue messages don't conflict.
            baseMetadata.stage = createHash('sha256').update(messageWithSupport).digest('hex').slice(0, 16)
          }
          if (payload.booking_id && baseMetadata.booking_id === undefined) {
            baseMetadata.booking_id = payload.booking_id
          }

          const result = await sendSMS(payload.to, messageWithSupport, {
            customerId,
            metadata: Object.keys(baseMetadata).length > 0 ? baseMetadata : undefined
          })

          const code = (result as any)?.code
          const logFailure = (result as any)?.logFailure === true

          if (logFailure || code === 'logging_failed') {
            throw new FatalSmsSafetyError({
              code: 'logging_failed',
              message: 'SMS sent but message persistence failed (logging_failed)',
              smsSent: true,
            })
          }

          if (!result.success) {
            if (isFatalSmsSafetyCode(code)) {
              throw new FatalSmsSafetyError({
                code,
                message: result.error || `SMS blocked by safety guard (${code})`,
                smsSent: false,
              })
            }

            throw new Error(result.error || 'Failed to send SMS')
          }

          return result
        }

      case 'send_bulk_sms':
        {
          const { sendBulkSms } = await import('@/lib/sms/bulk')
          const normalizedUniqueKey = typeof payload.unique_key === 'string' ? payload.unique_key.trim() : ''
          const normalizedJobId = typeof payload.jobId === 'string' ? payload.jobId.trim() : ''
          const normalizedQueueJobId = typeof payload.__job_id === 'string' ? payload.__job_id.trim() : ''
          const bulkJobId = normalizedUniqueKey || normalizedJobId || normalizedQueueJobId || 'unified_queue'
          const result = await sendBulkSms({
            customerIds: payload.customerIds,
            message: payload.message,
            eventId: payload.eventId,
            categoryId: payload.categoryId,
            bulkJobId
          })
          if (!result.success) {
            const fatalCode = parseBulkSmsAbortCode(result.error)
            if (fatalCode) {
              throw new FatalSmsSafetyError({
                code: fatalCode,
                message: result.error,
                smsSent: fatalCode === 'logging_failed',
              })
            }

            throw new Error(result.error)
          }
          return result
        }

      case 'export_employees':
        const { exportEmployees } = await import('@/app/actions/employeeExport')
        return await exportEmployees(payload.filters || {})

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
    const { data: updatedJob, error: updateError } = await supabase
      .from('jobs')
      .update(update)
      .eq('id', jobId)
      .select('id')
      .maybeSingle()

    if (updateError) {
      logger.error('Failed to update job status', {
        error: updateError,
        metadata: { jobId, status }
      })
      return false
    }
    if (!updatedJob) {
      logger.warn('Job status update affected no rows', {
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
