/**
 * Unified Job Queue System
 * This replaces the multiple job queue implementations with a single, consistent system
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { HiringApplication, HiringCandidate, HiringJob } from '@/types/database'
import { logger } from './logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { formatTime12Hour } from '@/lib/dateUtils'
import { sendEventReminderById } from '@/lib/reminders/send-event-reminder'

const DEBUG_JOB_QUEUE = process.env.JOB_QUEUE_DEBUG === '1'
const DEBUG_PARSE_CV = process.env.HIRING_PARSE_DEBUG === '1' || DEBUG_JOB_QUEUE

function logQueueDebug(message: string, metadata?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    logger.info(message, { metadata })
    return
  }

  if (DEBUG_JOB_QUEUE) {
    console.log(`[job-queue] ${message}`, metadata ?? {})
  }
}

function logParseDebug(message: string, metadata?: Record<string, unknown>) {
  if (!DEBUG_PARSE_CV) {
    return
  }

  if (process.env.NODE_ENV === 'development') {
    logger.info(message, { metadata })
    return
  }

  console.log(`[parse-cv] ${message}`, metadata ?? {})
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
  | 'parse_cv'
  | 'screen_application'
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
  'parse_cv',
  'screen_application',
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
      .select('id, attempts, max_attempts, started_at, lease_expires_at')
      .eq('status', 'processing')
      .in('type', SUPPORTED_JOB_TYPES)

    if (error) {
      logger.warn('Failed to load processing jobs for stale reset', { error })
      return
    }

    const cutoffMs = Date.now() - STALE_JOB_MINUTES * 60 * 1000
    const staleJobs = (data ?? []).filter((job) => {
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
      staleJobs.map((job) => {
        const attempts = Number(job.attempts ?? 0)
        const maxAttempts = Number(job.max_attempts ?? 3)
        const shouldRetry = attempts < maxAttempts
        const update = shouldRetry
          ? {
            status: 'pending',
            scheduled_for: now,
            started_at: null,
            processing_token: null,
            lease_expires_at: null,
            last_heartbeat_at: null,
            error_message: 'Job timed out - reset to pending',
            updated_at: now,
          }
          : {
            status: 'failed',
            failed_at: now,
            processing_token: null,
            lease_expires_at: null,
            last_heartbeat_at: null,
            error_message: 'Job timed out - max attempts reached',
            updated_at: now,
          }
        return supabase
          .from('jobs')
          .update(update)
          .eq('id', job.id)
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

    const parseJobs = await this.claimJobs(supabase, {
      limit: Math.min(1, limit),
      types: ['parse_cv'],
    })
    const remaining = Math.max(0, limit - parseJobs.length)
    const otherTypes = SUPPORTED_JOB_TYPES.filter((type) => type !== 'parse_cv')
    const otherJobs = await this.claimJobs(supabase, {
      limit: remaining,
      types: otherTypes,
    })

    const jobs = [...parseJobs, ...otherJobs]

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
      case 'parse_cv': {
        const { parseResumeWithUsage } = await import('@/lib/hiring/parsing')
        const { createAdminClient } = await import('@/lib/supabase/admin')

        const supabase = createAdminClient()
        const candidateId = payload.candidateId as string | undefined
        const resumeUrl = payload.resumeUrl as string | undefined
        const storagePath = payload.storagePath as string | undefined
        const documentId = payload.documentId as string | undefined
        const applicationId = payload.applicationId as string | null | undefined
        const jobId = payload.jobId as string | null | undefined

        logParseDebug('parse_cv job received', {
          candidateId,
          documentId,
          applicationId,
          jobId,
          hasStoragePath: Boolean(storagePath),
          hasResumeUrl: Boolean(resumeUrl),
        })

        if (!candidateId) {
          throw new Error('Missing candidateId for parse_cv job')
        }

        const candidateResponse = await supabase
          .from('hiring_candidates')
          .select('email, secondary_emails, first_name, last_name, phone, location, current_profile_version_id')
          .eq('id', candidateId)
          .single()

        if (candidateResponse.error) {
          throw new Error(`Candidate not found: ${candidateResponse.error.message}`)
        }

        const candidate = candidateResponse.data

        logParseDebug('Candidate loaded', {
          candidateId,
          hasPlaceholderName: candidate?.first_name === 'Parsing' || candidate?.last_name === 'CV...',
        })

        const documentResponse = documentId
          ? await supabase
            .from('hiring_candidate_documents')
            .select('*')
            .eq('id', documentId)
            .single()
          : null

        const document = documentResponse?.data ?? null

        const resolvedStoragePath =
          storagePath || (document?.storage_path && !document.storage_path.startsWith('http') ? document.storage_path : undefined)
        const resolvedResumeUrl =
          resumeUrl || (document?.storage_path?.startsWith('http') ? document.storage_path : undefined)

        logParseDebug('Resolved resume source', {
          candidateId,
          resolvedStoragePath: resolvedStoragePath ?? null,
          resolvedResumeUrl: resolvedResumeUrl ?? null,
        })

        let buffer: Buffer
        let contentType: string

        const guessContentType = (fileName?: string | null) => {
          const extension = fileName?.split('.').pop()?.toLowerCase()
          switch (extension) {
            case 'pdf':
              return 'application/pdf'
            case 'doc':
              return 'application/msword'
            case 'docx':
              return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            case 'jpg':
            case 'jpeg':
              return 'image/jpeg'
            case 'png':
              return 'image/png'
            case 'gif':
              return 'image/gif'
            default:
              return 'application/octet-stream'
          }
        }

        if (resolvedStoragePath) {
          logParseDebug('Downloading resume from storage', { storagePath: resolvedStoragePath })
          const { data, error } = await supabase.storage
            .from('hiring-docs')
            .download(resolvedStoragePath)

          if (error || !data) {
            throw new Error(`Failed to download resume from storage: ${error?.message || 'Unknown error'}`)
          }

          const arrayBuffer = await data.arrayBuffer()
          buffer = Buffer.from(arrayBuffer)
          contentType = data.type || document?.mime_type || guessContentType(document?.file_name)
          logParseDebug('Downloaded resume from storage', {
            storagePath: resolvedStoragePath,
            contentType,
            bytes: buffer.length,
          })
        } else if (resolvedResumeUrl && resolvedResumeUrl.startsWith('http')) {
          logParseDebug('Downloading resume from URL', { resumeUrl: resolvedResumeUrl })
          const fetchRes = await fetch(resolvedResumeUrl, { cache: 'no-store' })
          if (!fetchRes.ok) throw new Error(`Failed to download resume: ${fetchRes.statusText}`)
          const arrayBuffer = await fetchRes.arrayBuffer()
          buffer = Buffer.from(arrayBuffer)
          contentType = fetchRes.headers.get('content-type') || 'application/pdf'
          logParseDebug('Downloaded resume from URL', {
            resumeUrl: resolvedResumeUrl,
            contentType,
            bytes: buffer.length,
          })
        } else {
          throw new Error('Resume URL or storage path is required')
        }

        logParseDebug('Parsing resume content', { candidateId, contentType, bytes: buffer.length })
        const parseResult = await parseResumeWithUsage(buffer, contentType)
        const parsedData = parseResult.parsedData

        logParseDebug('Parsed resume content', {
          candidateId,
          model: parseResult.usage?.model ?? parseResult.model,
          fields: parsedData ? Object.keys(parsedData) : [],
        })

        const isPlaceholderEmail = (value?: string | null) =>
          !value || value.startsWith('pending-') || value.endsWith('@hiring.temp')

        const normalizeEmail = (value?: string | null) => value?.trim().toLowerCase() || ''

        const updates: Record<string, any> = {
          parsed_data: parsedData
        }

        if ((candidate.first_name === 'Parsing' || !candidate.first_name) && parsedData.first_name) {
          updates.first_name = parsedData.first_name
        }
        if ((candidate.last_name === 'CV...' || !candidate.last_name) && parsedData.last_name) {
          updates.last_name = parsedData.last_name
        }
        if (isPlaceholderEmail(candidate.email) && parsedData.email) {
          updates.email = parsedData.email
        }
        if (!candidate.phone && parsedData.phone) {
          updates.phone = parsedData.phone
        }
        if (!candidate.location && parsedData.location) {
          updates.location = parsedData.location
        }

        const secondaryEmails = new Set<string>(Array.isArray(candidate.secondary_emails) ? candidate.secondary_emails : [])
        const parsedPrimaryEmail = normalizeEmail(parsedData.email)
        const existingPrimaryEmail = normalizeEmail(candidate.email)

        if (parsedPrimaryEmail && parsedPrimaryEmail !== existingPrimaryEmail && !isPlaceholderEmail(candidate.email)) {
          secondaryEmails.add(parsedPrimaryEmail)
        }

        if (Array.isArray(parsedData.secondary_emails)) {
          parsedData.secondary_emails.forEach((email) => {
            const normalized = normalizeEmail(email)
            if (normalized && normalized !== existingPrimaryEmail) {
              secondaryEmails.add(normalized)
            }
          })
        }

        if (secondaryEmails.size > 0) {
          updates.secondary_emails = Array.from(secondaryEmails)
        }

        let profileVersionId: string | null = null
        try {
          const latestVersion = await supabase
            .from('hiring_candidate_profile_versions')
            .select('id, version_number, parsed_data')
            .eq('candidate_id', candidateId)
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle()

          const previousData = latestVersion.data?.parsed_data || {}
          const diffData: Record<string, any> = {}
          const allKeys = new Set([
            ...Object.keys(previousData || {}),
            ...Object.keys(parsedData || {})
          ])

          allKeys.forEach((key) => {
            const beforeValue = (previousData as any)?.[key]
            const afterValue = (parsedData as any)?.[key]
            if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
              diffData[key] = { before: beforeValue ?? null, after: afterValue ?? null }
            }
          })

          const diffSummary = Object.keys(diffData).length
            ? `Updated fields: ${Object.keys(diffData).join(', ')}`
            : 'No changes detected'

          const { data: versionRow, error: versionError } = await supabase
            .from('hiring_candidate_profile_versions')
            .insert({
              candidate_id: candidateId,
              document_id: document?.id || documentId || null,
              version_number: (latestVersion.data?.version_number || 0) + 1,
              parsed_data: parsedData,
              diff_summary: diffSummary,
              diff_data: diffData,
            })
            .select('id')
            .single()

          if (versionError) {
            throw new Error(versionError.message)
          }

          profileVersionId = versionRow?.id || null
        } catch (error) {
          logger.warn('Failed to create candidate profile version', { error: error as Error })
        }

        if (profileVersionId) {
          updates.current_profile_version_id = profileVersionId
        }

        const { error: updateError } = await supabase
          .from('hiring_candidates')
          .update(updates)
          .eq('id', candidateId)

        if (updateError) throw new Error(`Failed to update candidate: ${updateError.message}`)

        logParseDebug('Updated candidate profile', { candidateId })

        await supabase.from('hiring_candidate_events').insert({
          candidate_id: candidateId,
          application_id: applicationId || null,
          job_id: jobId || null,
          event_type: 'cv_parsed',
          source: 'system',
          metadata: {
            document_id: document?.id || documentId || null,
            resume_url: resolvedResumeUrl || null,
            storage_path: resolvedStoragePath || null,
          },
        })

        if (parseResult.usage) {
          const usage = parseResult.usage
          const contextParts = ['hiring_parsing', candidateId]
          if (document?.id || documentId) {
            contextParts.push(String(document?.id || documentId))
          }
          const context = contextParts.join(':')
          const { error: usageError } = await (supabase.from('ai_usage_events') as any).insert([
            {
              context,
              model: usage.model,
              prompt_tokens: usage.promptTokens,
              completion_tokens: usage.completionTokens,
              total_tokens: usage.totalTokens,
              cost: usage.cost,
            },
          ])

          if (usageError) {
            logger.warn('Failed to record parsing AI usage', { error: usageError })
          }
        }

        if (applicationId) {
          await this.enqueue(
            'screen_application',
            { applicationId },
            { unique: `screen_application:${applicationId}` }
          )
        }
        return parsedData
      }

      case 'screen_application': {
        const { screenApplicationWithAI } = await import('@/lib/hiring/screening')
        const { sendNewApplicationNotification } = await import('@/lib/hiring/notifications')

        const supabase = createAdminClient()
        const applicationId = payload.applicationId as string | undefined
        const force = payload.force === true

        if (!applicationId) {
          throw new Error('Missing applicationId for screen_application job')
        }

        const { data, error } = await supabase
          .from('hiring_applications')
          .select(`
            id,
            job_id,
            candidate_id,
            stage,
            source,
            ai_score,
            ai_recommendation,
            ai_screening_result,
            screener_answers,
            candidate:hiring_candidates(*),
            job:hiring_jobs(*, template:hiring_job_templates(*))
          `)
          .eq('id', applicationId)
          .single()

        if (error || !data) {
          throw new Error(`Application not found: ${error?.message || 'Unknown error'}`)
        }

        const application = data as unknown as HiringApplication
        const candidate = (data as any).candidate as HiringCandidate | undefined
        const job = (data as any).job as HiringJob | undefined

        if (!candidate || !job) {
          throw new Error('Missing candidate or job for screen_application job')
        }

        const logStageChange = async (fromStage: string | null | undefined, toStage: string) => {
          if (!fromStage || fromStage === toStage) return
          const { error: auditError } = await supabase
            .from('audit_logs')
            .insert({
              user_id: null,
              user_email: null,
              operation_type: 'stage_change',
              resource_type: 'hiring_application',
              resource_id: applicationId,
              operation_status: 'success',
              old_values: { stage: fromStage },
              new_values: { stage: toStage },
              additional_info: { source: 'screening_job' },
              ip_address: null,
              user_agent: 'job_queue',
            })

          if (auditError) {
            logger.warn('Failed to log hiring stage change', { error: auditError })
          }
        }

        let currentStage = application.stage

        if (!force && (application.ai_score != null || application.ai_screening_result)) {
          return { skipped: true, reason: 'already_screened' }
        }

        if (application.stage === 'new') {
          await supabase
            .from('hiring_applications')
            .update({ stage: 'screening' })
            .eq('id', applicationId)
          await logStageChange(currentStage, 'screening')
          currentStage = 'screening'
        }

        const screeningOutcome = await screenApplicationWithAI({
          job,
          candidate,
          application,
        })

        const screeningResult = screeningOutcome.result
        const nextStage = currentStage === 'new' || currentStage === 'screening'
          ? 'screened'
          : currentStage

        const screeningPayload = {
          eligibility: screeningResult.eligibility,
          strengths: screeningResult.strengths ?? [],
          concerns: screeningResult.concerns ?? [],
          rationale: screeningResult.rationale,
          experience_analysis: screeningResult.experience_analysis ?? null,
          draft_replies: screeningResult.draft_replies ?? null,
          generated_at: new Date().toISOString(),
          model: screeningOutcome.usage?.model ?? screeningOutcome.model,
        }

        const { error: updateError } = await supabase
          .from('hiring_applications')
          .update({
            ai_score: screeningResult.score,
            ai_recommendation: screeningResult.recommendation,
            ai_screening_result: screeningPayload,
            stage: nextStage,
          })
          .eq('id', applicationId)

        if (updateError) {
          throw new Error(`Failed to update application screening: ${updateError.message}`)
        }

        await logStageChange(currentStage, nextStage)
        currentStage = nextStage

        if (screeningOutcome.usage) {
          const { error: usageError } = await (supabase.from('ai_usage_events') as any).insert([
            {
              context: `hiring_screening:${applicationId}`,
              model: screeningOutcome.usage.model,
              prompt_tokens: screeningOutcome.usage.promptTokens,
              completion_tokens: screeningOutcome.usage.completionTokens,
              total_tokens: screeningOutcome.usage.totalTokens,
              cost: screeningOutcome.usage.cost,
            },
          ])

          if (usageError) {
            logger.warn('Failed to record screening AI usage', { error: usageError })
          }
        }

        try {
          await sendNewApplicationNotification({
            application,
            candidate,
            job,
            screening: screeningResult,
          })
        } catch (notificationError) {
          logger.warn('Failed to send hiring notification', { error: notificationError as Error })
        }

        return screeningResult
      }

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
