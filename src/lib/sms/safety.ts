import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

type SmsSafetyConfig = {
  enabled: boolean
  globalHourlyLimit: number
  recipientHourlyLimit: number
  recipientDailyLimit: number
  idempotencyTtlHours: number
  allowMissingTables: boolean
}

type SmsDedupContext = {
  key: string
  requestHash: string
}

type SmsIdempotencyClaimResult = 'claimed' | 'duplicate' | 'conflict' | 'unavailable'

type SmsSafetyLimitResult =
  | {
      allowed: true
      metrics: {
        globalLastHour: number
        recipientLastHour: number
        recipientLast24h: number
      }
    }
  | {
      allowed: false
      code: 'global_rate_limit' | 'recipient_hourly_limit' | 'recipient_daily_limit' | 'safety_unavailable'
      reason: string
      metrics: {
        globalLastHour: number
        recipientLastHour: number
        recipientLast24h: number
      }
    }

const DEDUPE_CONTEXT_KEYS = [
  'event_booking_id',
  'table_booking_id',
  'private_booking_id',
  'event_id',
  'parking_booking_id',
  'bulk_job_id',
  'waitlist_offer_id',
  'waitlist_entry_id',
  'booking_id',
  'trigger_type',
  'stage'
] as const

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function resolveConfig(): SmsSafetyConfig {
  const isProduction = process.env.NODE_ENV === 'production'
  const allowMissingTablesRequested = parseBooleanEnv('SMS_SAFETY_ALLOW_MISSING_TABLES', !isProduction)

  return {
    enabled: parseBooleanEnv('SMS_SAFETY_GUARDS_ENABLED', true),
    globalHourlyLimit: parsePositiveIntEnv('SMS_SAFETY_GLOBAL_HOURLY_LIMIT', 120),
    recipientHourlyLimit: parsePositiveIntEnv('SMS_SAFETY_RECIPIENT_HOURLY_LIMIT', 3),
    recipientDailyLimit: parsePositiveIntEnv('SMS_SAFETY_RECIPIENT_DAILY_LIMIT', 8),
    idempotencyTtlHours: parsePositiveIntEnv('SMS_SAFETY_IDEMPOTENCY_TTL_HOURS', 24 * 14),
    // Never allow missing-table bypass in production, even if misconfigured.
    allowMissingTables: isProduction ? false : allowMissingTablesRequested
  }
}

function normalizePhone(to: string): string {
  return to.replace(/\s+/g, '')
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableSerialize(entryValue)}`)

  return `{${entries.join(',')}}`
}

function hashSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parseKnownContext(metadata: Record<string, unknown>): Record<string, string> {
  const context: Record<string, string> = {}

  for (const key of DEDUPE_CONTEXT_KEYS) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      context[key] = value.trim()
    }
  }

  if (metadata.marketing === true) {
    context.marketing = 'true'
  }
  if (metadata.manual_interest === true) {
    context.manual_interest = 'true'
  }

  if (Object.keys(context).length === 0) {
    context.day_bucket_utc = new Date().toISOString().slice(0, 10)
  }

  return context
}

export function buildSmsDedupContext(params: {
  to: string
  customerId?: string | null
  body: string
  metadata?: Record<string, unknown> | null
}): SmsDedupContext | null {
  const metadata = params.metadata && typeof params.metadata === 'object' ? params.metadata : null
  const templateKey =
    metadata && typeof metadata.template_key === 'string'
      ? metadata.template_key.trim()
      : ''

  if (!templateKey) {
    return null
  }

  const identity = params.customerId?.trim() || normalizePhone(params.to)
  const context = parseKnownContext(metadata ?? {})
  const dedupeScope = {
    template_key: templateKey,
    identity,
    context
  }
  const dedupeKey = `sms:${hashSha256(stableSerialize(dedupeScope))}`
  const requestHash = hashSha256(
    stableSerialize({
      ...dedupeScope,
      body: params.body
    })
  )

  return {
    key: dedupeKey,
    requestHash
  }
}

function isMissingTableError(error: unknown): boolean {
  const maybeError = error as { code?: string; message?: string } | null
  return maybeError?.code === '42P01' || maybeError?.code === 'PGRST116'
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) {
    return false
  }

  const expiresMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresMs)) {
    return false
  }

  return expiresMs <= Date.now()
}

function resolveMissingIdempotencyTableResult(
  allowMissingTables: boolean,
  error: unknown
): SmsIdempotencyClaimResult {
  if (allowMissingTables) {
    logger.warn('SMS idempotency table unavailable; proceeding without distributed dedupe', {
      metadata: { error: (error as { message?: string } | null)?.message }
    })
    return 'unavailable'
  }

  logger.error('SMS idempotency table unavailable; blocking outbound SMS to fail closed', {
    metadata: { error: (error as { message?: string } | null)?.message }
  })
  return 'conflict'
}

export async function claimSmsIdempotency(
  supabase: SupabaseClient<any, 'public', any>,
  context: SmsDedupContext
): Promise<SmsIdempotencyClaimResult> {
  const { idempotencyTtlHours, allowMissingTables } = resolveConfig()
  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + idempotencyTtlHours * 60 * 60 * 1000).toISOString()
  const claimPayload = {
    key: context.key,
    request_hash: context.requestHash,
    response: {
      channel: 'sms',
      state: 'claimed'
    },
    expires_at: expiresAt
  }

  const { error } = await (supabase.from('idempotency_keys') as any).insert(claimPayload)

  if (!error) {
    return 'claimed'
  }

  const pgError = error as { code?: string; message?: string }
  if (isMissingTableError(pgError)) {
    return resolveMissingIdempotencyTableResult(allowMissingTables, pgError)
  }

  if (pgError?.code !== '23505') {
    throw error
  }

  const { data: existing, error: existingError } = await (supabase.from('idempotency_keys') as any)
    .select('request_hash, expires_at')
    .eq('key', context.key)
    .maybeSingle()

  if (existingError) {
    if (isMissingTableError(existingError)) {
      return resolveMissingIdempotencyTableResult(allowMissingTables, existingError)
    }
    throw existingError
  }

  if (!existing) {
    const { error: retryError } = await (supabase.from('idempotency_keys') as any).insert(claimPayload)
    if (!retryError) {
      return 'claimed'
    }

    if (isMissingTableError(retryError)) {
      return resolveMissingIdempotencyTableResult(allowMissingTables, retryError)
    }

    const retryPgError = retryError as { code?: string; message?: string }
    if (retryPgError?.code !== '23505') {
      throw retryError
    }

    return 'conflict'
  }

  if (isExpired(existing.expires_at)) {
    let reclaimQuery = (supabase.from('idempotency_keys') as any)
      .update({
        request_hash: context.requestHash,
        response: {
          channel: 'sms',
          state: 'claimed'
        },
        expires_at: expiresAt
      })
      .eq('key', context.key)
      .eq('request_hash', existing.request_hash)
      .lt('expires_at', nowIso)

    if (existing.expires_at) {
      reclaimQuery = reclaimQuery.eq('expires_at', existing.expires_at)
    }

    const { data: reclaimed, error: reclaimError } = await reclaimQuery
      .select('key')
      .maybeSingle()

    if (reclaimError) {
      if (isMissingTableError(reclaimError)) {
        return resolveMissingIdempotencyTableResult(allowMissingTables, reclaimError)
      }
      throw reclaimError
    }

    if (reclaimed) {
      return 'claimed'
    }
  }

  if (existing.request_hash === context.requestHash) {
    return 'duplicate'
  }

  return 'conflict'
}

export async function releaseSmsIdempotencyClaim(
  supabase: SupabaseClient<any, 'public', any>,
  context: SmsDedupContext
): Promise<void> {
  const { error } = await (supabase.from('idempotency_keys') as any)
    .delete()
    .eq('key', context.key)
    .eq('request_hash', context.requestHash)

  if (error && !isMissingTableError(error)) {
    logger.warn('Failed releasing SMS idempotency claim', {
      metadata: {
        key: context.key,
        error: (error as any)?.message || String(error)
      }
    })
  }
}

export async function evaluateSmsSafetyLimits(
  supabase: SupabaseClient<any, 'public', any>,
  params: {
    to: string
    customerId?: string | null
  }
): Promise<SmsSafetyLimitResult> {
  const config = resolveConfig()
  const metrics = {
    globalLastHour: 0,
    recipientLastHour: 0,
    recipientLast24h: 0
  }

  if (!config.enabled) {
    return { allowed: true, metrics }
  }

  const hourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const recipientColumn = params.customerId ? 'customer_id' : 'to_number'
  const recipientValue = params.customerId || normalizePhone(params.to)

  const [{ count: globalCount, error: globalError }, { count: recipientHourCount, error: recipientHourError }, { count: recipientDayCount, error: recipientDayError }] = await Promise.all([
    (supabase.from('messages') as any)
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .gte('created_at', hourAgoIso),
    (supabase.from('messages') as any)
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .eq(recipientColumn, recipientValue)
      .gte('created_at', hourAgoIso),
    (supabase.from('messages') as any)
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .eq(recipientColumn, recipientValue)
      .gte('created_at', dayAgoIso)
  ])

  if (globalError || recipientHourError || recipientDayError) {
    const firstError = globalError || recipientHourError || recipientDayError
    if (isMissingTableError(firstError)) {
      if (config.allowMissingTables) {
        logger.warn('SMS safety limits skipped because messages table is unavailable', {
          metadata: { error: (firstError as any)?.message || String(firstError) }
        })
        return { allowed: true, metrics }
      }

      logger.error('SMS safety limits unavailable because messages table is missing; blocking send', {
        metadata: { error: (firstError as any)?.message || String(firstError) }
      })
      return {
        allowed: false,
        code: 'safety_unavailable',
        reason: 'SMS safety persistence is unavailable',
        metrics
      }
    }
    throw firstError
  }

  metrics.globalLastHour = globalCount ?? 0
  metrics.recipientLastHour = recipientHourCount ?? 0
  metrics.recipientLast24h = recipientDayCount ?? 0

  if (metrics.globalLastHour >= config.globalHourlyLimit) {
    return {
      allowed: false,
      code: 'global_rate_limit',
      reason: 'Global SMS hourly safety limit reached',
      metrics
    }
  }

  if (metrics.recipientLastHour >= config.recipientHourlyLimit) {
    return {
      allowed: false,
      code: 'recipient_hourly_limit',
      reason: 'Recipient SMS hourly safety limit reached',
      metrics
    }
  }

  if (metrics.recipientLast24h >= config.recipientDailyLimit) {
    return {
      allowed: false,
      code: 'recipient_daily_limit',
      reason: 'Recipient SMS daily safety limit reached',
      metrics
    }
  }

  return { allowed: true, metrics }
}
