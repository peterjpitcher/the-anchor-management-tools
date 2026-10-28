import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type IdempotencyLookupResult =
  | { state: 'new' }
  | { state: 'replay'; response: unknown }
  | { state: 'conflict' }

export type IdempotencyClaimResult =
  | { state: 'claimed' }
  | { state: 'replay'; response: unknown }
  | { state: 'conflict' }
  | { state: 'in_progress' }

type IdempotencyRecord = {
  request_hash: string
  response: unknown
  expires_at: string | null
}

// A claim stuck in {state: 'processing'} longer than this is provably dead: Vercel caps
// function execution at 300s, so after 10 minutes the claiming invocation cannot still be
// running (e.g. it was killed mid-flight when the caller disconnected). Allow reclaiming it
// so the same idempotency key can be retried instead of blocking until the 24h TTL expires.
export const STALE_PROCESSING_MS = 10 * 60 * 1000

/**
 * A processing claim can carry the answer for a booking that has already been saved
 * (BK-127, customer bookings review of 24 October 2026). The route writes it the moment the
 * booking exists, and again with the full answer when storing that answer failed. Without it a
 * claim left behind by a function that died after saving, or by a failed response write, was
 * reclaimed after STALE_PROCESSING_MS, and a retry with the same key booked a second time.
 *
 * While the claim is fresh nothing changes: the original request may still be running, so a
 * retry is told the request is in progress. Once it is stale, the stored answer is replayed
 * instead of the key being handed to a new attempt.
 */
type ProcessingResponse = {
  state?: string
  claimed_at?: string
  committed_response?: unknown
}

function committedResponseOf(response: unknown): unknown {
  if (!response || typeof response !== 'object') return undefined
  const committed = (response as ProcessingResponse).committed_response
  return committed === null ? undefined : committed
}

function isStaleProcessingClaim(response: ProcessingResponse, staleProcessingMs: number): boolean {
  const claimedAt = typeof response.claimed_at === 'string' ? response.claimed_at : null
  if (!claimedAt) return true
  return claimedAt < new Date(Date.now() - staleProcessingMs).toISOString()
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`)

  return `{${entries.join(',')}}`
}

export function computeIdempotencyRequestHash(payload: unknown): string {
  return crypto
    .createHash('sha256')
    .update(stableSerialize(payload))
    .digest('hex')
}

// idempotency_keys.key is varchar(255). A longer key cannot be stored: the claim insert is
// refused (Postgres 22001, a PostgREST 400) and the route answers 500. The website's parking
// key is about 370 characters once it carries the guest's consent choices, so every online
// parking booking failed that way for months (found 19 October 2026).
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255

/**
 * The form of a caller's key that fits the table. A key that fits is kept exactly as sent; a
 * longer one is replaced by its SHA-256, which is the same for the same key on every retry,
 * so duplicate requests still meet. No stored key changes, because nothing over the limit was
 * ever stored.
 */
export function toStorableIdempotencyKey(key: string): string {
  if (key.length <= IDEMPOTENCY_KEY_MAX_LENGTH) {
    return key
  }

  return `sha256:${crypto.createHash('sha256').update(key).digest('hex')}`
}

export function getIdempotencyKey(request: Request): string | null {
  const key = request.headers.get('Idempotency-Key')
  if (!key) {
    return null
  }

  const trimmed = key.trim()
  return trimmed.length > 0 ? toStorableIdempotencyKey(trimmed) : null
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

async function fetchIdempotencyRecord(
  supabase: SupabaseClient<any, 'public', any>,
  key: string
): Promise<IdempotencyRecord | null> {
  const { data, error } = await supabase
    .from('idempotency_keys')
    .select('request_hash, response, expires_at')
    .eq('key', key)
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data as IdempotencyRecord | null) ?? null
}

export async function lookupIdempotencyKey(
  supabase: SupabaseClient<any, 'public', any>,
  key: string,
  requestHash: string
): Promise<IdempotencyLookupResult> {
  const data = await fetchIdempotencyRecord(supabase, key)

  if (!data) {
    return { state: 'new' }
  }

  if (isExpired(data.expires_at)) {
    return { state: 'new' }
  }

  if (data.request_hash !== requestHash) {
    return { state: 'conflict' }
  }

  const processing = data.response as ProcessingResponse | null
  if (processing?.state === 'processing') {
    const committed = committedResponseOf(processing)
    if (committed !== undefined && isStaleProcessingClaim(processing, STALE_PROCESSING_MS)) {
      return { state: 'replay', response: committed }
    }
  }

  return {
    state: 'replay',
    response: data.response
  }
}

export async function claimIdempotencyKey(
  supabase: SupabaseClient<any, 'public', any>,
  key: string,
  requestHash: string,
  ttlHours = 24,
  staleProcessingMs = STALE_PROCESSING_MS
): Promise<IdempotencyClaimResult> {
  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()
  const processingPayload = {
    key,
    request_hash: requestHash,
    response: {
      state: 'processing',
      claimed_at: nowIso
    },
    expires_at: expiresAt
  }

  const { error } = await supabase
    .from('idempotency_keys')
    .insert(processingPayload)

  if (!error) {
    return { state: 'claimed' }
  }

  const pgError = error as { code?: string } | null
  if (pgError?.code !== '23505') {
    throw error
  }

  const existing = await fetchIdempotencyRecord(supabase, key)
  if (!existing) {
    const { error: retryError } = await supabase
      .from('idempotency_keys')
      .insert(processingPayload)

    if (!retryError) {
      return { state: 'claimed' }
    }

    const retryPgError = retryError as { code?: string } | null
    if (retryPgError?.code !== '23505') {
      throw retryError
    }

    return { state: 'in_progress' }
  }

  if (isExpired(existing.expires_at)) {
    let reclaimQuery = supabase
      .from('idempotency_keys')
      .update({
        request_hash: requestHash,
        response: {
          state: 'processing',
          claimed_at: nowIso
        },
        expires_at: expiresAt
      })
      .eq('key', key)
      .eq('request_hash', existing.request_hash)
      .lt('expires_at', nowIso)

    if (existing.expires_at) {
      reclaimQuery = reclaimQuery.eq('expires_at', existing.expires_at)
    }

    const { data: reclaimed, error: reclaimError } = await reclaimQuery
      .select('key')
      .maybeSingle()

    if (reclaimError) {
      throw reclaimError
    }

    if (reclaimed) {
      return { state: 'claimed' }
    }

    const latest = await lookupIdempotencyKey(supabase, key, requestHash)
    if (latest.state === 'conflict') {
      return { state: 'conflict' }
    }

    if (latest.state === 'new') {
      const { error: retryError } = await supabase
        .from('idempotency_keys')
        .insert(processingPayload)

      if (!retryError) {
        return { state: 'claimed' }
      }

      const retryPgError = retryError as { code?: string } | null
      if (retryPgError?.code !== '23505') {
        throw retryError
      }

      return { state: 'in_progress' }
    }

    const latestResponse = latest.response as { state?: string } | null
    if (latestResponse?.state === 'processing') {
      return { state: 'in_progress' }
    }

    return { state: 'replay', response: latest.response }
  }

  if (existing.request_hash !== requestHash) {
    return { state: 'conflict' }
  }

  const response = existing.response as ProcessingResponse | null
  if (response?.state === 'processing') {
    const claimedAt = typeof response.claimed_at === 'string' ? response.claimed_at : null

    // Claims without claimed_at predate this field and are treated as stale.
    if (!isStaleProcessingClaim(response, staleProcessingMs)) {
      return { state: 'in_progress' }
    }

    // The booking behind this claim was saved. Replay its answer; never hand the key to a new
    // attempt, which would book again (BK-127).
    const committed = committedResponseOf(response)
    if (committed !== undefined) {
      return { state: 'replay', response: committed }
    }

    let reclaimQuery = supabase
      .from('idempotency_keys')
      .update({
        request_hash: requestHash,
        response: {
          state: 'processing',
          claimed_at: nowIso
        },
        expires_at: expiresAt
      })
      .eq('key', key)
      .eq('request_hash', requestHash)
      .filter('response->>state', 'eq', 'processing')

    reclaimQuery = claimedAt
      ? reclaimQuery.filter('response->>claimed_at', 'eq', claimedAt)
      : reclaimQuery.filter('response->>claimed_at', 'is', null)

    const { data: reclaimed, error: reclaimError } = await reclaimQuery
      .select('key')
      .maybeSingle()

    if (reclaimError) {
      throw reclaimError
    }

    if (reclaimed) {
      return { state: 'claimed' }
    }

    // Lost the race: another instance reclaimed it, or the original finished and
    // persisted its response between our read and the conditional update.
    const latest = await lookupIdempotencyKey(supabase, key, requestHash)
    if (latest.state === 'conflict') {
      return { state: 'conflict' }
    }

    if (latest.state === 'replay') {
      const latestResponse = latest.response as ProcessingResponse | null
      if (latestResponse?.state === 'processing') {
        return { state: 'in_progress' }
      }
      return { state: 'replay', response: latest.response }
    }

    return { state: 'in_progress' }
  }

  return { state: 'replay', response: existing.response }
}

export async function persistIdempotencyResponse(
  supabase: SupabaseClient<any, 'public', any>,
  key: string,
  requestHash: string,
  response: unknown,
  ttlHours = 24
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('idempotency_keys')
    .upsert({
      key,
      request_hash: requestHash,
      response,
      expires_at: expiresAt
    })

  if (error) {
    throw error
  }
}

/**
 * Record, on a claim that is still processing, the answer to replay for a booking that has been
 * saved (see ProcessingResponse above). Call it as soon as the booking exists, and again with the
 * full answer when persistIdempotencyResponse failed. Refreshes claimed_at, because the caller is
 * demonstrably still running.
 *
 * Throws on a database error. Callers log it and carry on: the booking is already made.
 */
export async function markIdempotencyClaimCommitted(
  supabase: SupabaseClient<any, 'public', any>,
  key: string,
  requestHash: string,
  committedResponse: unknown
): Promise<void> {
  const { error } = await supabase
    .from('idempotency_keys')
    .update({
      response: {
        state: 'processing',
        claimed_at: new Date().toISOString(),
        committed_response: committedResponse
      }
    })
    .eq('key', key)
    .eq('request_hash', requestHash)
    .filter('response->>state', 'eq', 'processing')

  if (error) {
    throw error
  }
}

/**
 * Delete stored answers past their expiry (BK-189). An expired row is already treated as new by
 * every reader, so removing it changes no behaviour; it only stops the table growing for ever.
 * Returns how many rows went.
 */
export async function deleteExpiredIdempotencyKeys(
  supabase: SupabaseClient<any, 'public', any>,
  now: Date = new Date()
): Promise<number> {
  const { data, error } = await supabase
    .from('idempotency_keys')
    .delete()
    .lt('expires_at', now.toISOString())
    .select('key')

  if (error) {
    throw error
  }

  return Array.isArray(data) ? data.length : 0
}

export async function releaseIdempotencyClaim(
  supabase: SupabaseClient<any, 'public', any>,
  key: string,
  requestHash: string
): Promise<void> {
  const { error } = await supabase
    .from('idempotency_keys')
    .delete()
    .eq('key', key)
    .eq('request_hash', requestHash)

  if (error) {
    throw error
  }
}
