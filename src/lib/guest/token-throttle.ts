import { hashGuestToken } from '@/lib/guest/tokens'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

type ThrottleEntry = {
  attempts: number
  resetAtMs: number
}

type HeaderReader = {
  get(name: string): string | null
}

type GuestTokenThrottleInput = {
  request?: Request
  headers?: HeaderReader
  rawToken: string
  scope: string
  maxAttempts?: number
  windowMs?: number
}

type GuestTokenThrottleResult = {
  allowed: boolean
  retryAfterSeconds: number
  remaining: number
}

const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_WINDOW_MS = 15 * 60 * 1000
const throttleStore = new Map<string, ThrottleEntry>()

let cleanupTick = 0

function resolveClientIpFromHeaders(headers: HeaderReader): string {
  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }

  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  return 'unknown'
}

function cleanupExpiredEntries(nowMs: number) {
  cleanupTick += 1
  if (cleanupTick % 50 !== 0) {
    return
  }

  for (const [key, entry] of throttleStore.entries()) {
    if (entry.resetAtMs <= nowMs) {
      throttleStore.delete(key)
    }
  }
}

function buildThrottleKey(scope: string, tokenHash: string, clientIp: string): string {
  const raw = `guest_token:${scope}:${tokenHash}:${clientIp}`
  if (raw.length <= 240) {
    return raw
  }

  const digest = crypto.createHash('sha256').update(raw).digest('hex')
  return `guest_token:${scope.slice(0, 40)}:${digest}`
}

function checkGuestTokenThrottleLocal(input: {
  key: string
  maxAttempts: number
  windowMs: number
  nowMs: number
}): GuestTokenThrottleResult {
  cleanupExpiredEntries(input.nowMs)

  const existing = throttleStore.get(input.key)
  if (!existing || existing.resetAtMs <= input.nowMs) {
    throttleStore.set(input.key, {
      attempts: 1,
      resetAtMs: input.nowMs + input.windowMs
    })

    return {
      allowed: true,
      retryAfterSeconds: Math.ceil(input.windowMs / 1000),
      remaining: Math.max(0, input.maxAttempts - 1)
    }
  }

  existing.attempts += 1
  throttleStore.set(input.key, existing)

  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - input.nowMs) / 1000))
  const remaining = Math.max(0, input.maxAttempts - existing.attempts)

  if (existing.attempts > input.maxAttempts) {
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0
    }
  }

  return {
    allowed: true,
    retryAfterSeconds,
    remaining
  }
}

function normalizeRequestTimestamps(raw: unknown, windowStartMs: number): Array<{ timestamp: number }> {
  if (!Array.isArray(raw)) {
    return []
  }

  const normalized: Array<{ timestamp: number }> = []

  for (const item of raw) {
    const timestamp = Number((item as any)?.timestamp)
    if (!Number.isFinite(timestamp)) {
      continue
    }
    if (timestamp <= windowStartMs) {
      continue
    }
    normalized.push({ timestamp })
  }

  normalized.sort((a, b) => a.timestamp - b.timestamp)
  return normalized
}

export async function checkGuestTokenThrottle(input: GuestTokenThrottleInput): Promise<GuestTokenThrottleResult> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS
  const nowMs = Date.now()

  const headerSource = input.request?.headers ?? input.headers
  const clientIp = headerSource ? resolveClientIpFromHeaders(headerSource) : 'unknown'
  const tokenHash = hashGuestToken(input.rawToken)
  const key = buildThrottleKey(input.scope, tokenHash, clientIp)

  try {
    const supabase = createAdminClient()
    const windowStartMs = nowMs - windowMs

    const { data: row, error: fetchError } = await (supabase.from('rate_limits') as any)
      .select('id, requests')
      .eq('key', key)
      .maybeSingle()

    if (fetchError) {
      throw fetchError
    }

    const validRequests = normalizeRequestTimestamps(row?.requests, windowStartMs)
    validRequests.push({ timestamp: nowMs })

    if (row?.id) {
      const { error: updateError } = await (supabase.from('rate_limits') as any)
        .update({
          requests: validRequests,
          window_ms: windowMs,
          max_requests: maxAttempts,
          updated_at: new Date(nowMs).toISOString()
        })
        .eq('id', row.id)

      if (updateError) {
        throw updateError
      }
    } else {
      const { error: insertError } = await (supabase.from('rate_limits') as any)
        .insert({
          key,
          requests: validRequests,
          window_ms: windowMs,
          max_requests: maxAttempts,
          created_at: new Date(nowMs).toISOString(),
          updated_at: new Date(nowMs).toISOString()
        })

      if (insertError) {
        if ((insertError as any)?.code === '23505') {
          const { data: retryRow, error: retryFetchError } = await (supabase.from('rate_limits') as any)
            .select('id, requests')
            .eq('key', key)
            .maybeSingle()

          if (retryFetchError || !retryRow?.id) {
            throw retryFetchError || insertError
          }

          const retryValid = normalizeRequestTimestamps(retryRow.requests, windowStartMs)
          retryValid.push({ timestamp: nowMs })

          const { error: retryUpdateError } = await (supabase.from('rate_limits') as any)
            .update({
              requests: retryValid,
              window_ms: windowMs,
              max_requests: maxAttempts,
              updated_at: new Date(nowMs).toISOString()
            })
            .eq('id', retryRow.id)

          if (retryUpdateError) {
            throw retryUpdateError
          }

          validRequests.length = 0
          validRequests.push(...retryValid)
        } else {
          throw insertError
        }
      }
    }

    const attemptCount = validRequests.length
    const oldestTimestamp = validRequests[0]?.timestamp ?? nowMs
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - nowMs) / 1000))
    const remaining = Math.max(0, maxAttempts - attemptCount)

    if (attemptCount > maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds,
        remaining: 0
      }
    }

    return {
      allowed: true,
      retryAfterSeconds,
      remaining
    }
  } catch {
    return checkGuestTokenThrottleLocal({
      key,
      maxAttempts,
      windowMs,
      nowMs
    })
  }
}
