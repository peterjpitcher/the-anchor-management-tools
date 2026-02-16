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

function stableSerialize(value: unknown): string {
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

export function getIdempotencyKey(request: Request): string | null {
  const key = request.headers.get('Idempotency-Key')
  if (!key) {
    return null
  }

  const trimmed = key.trim()
  return trimmed.length > 0 ? trimmed : null
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

  return {
    state: 'replay',
    response: data.response
  }
}

export async function claimIdempotencyKey(
  supabase: SupabaseClient<any, 'public', any>,
  key: string,
  requestHash: string,
  ttlHours = 24
): Promise<IdempotencyClaimResult> {
  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()
  const processingPayload = {
    key,
    request_hash: requestHash,
    response: {
      state: 'processing'
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
          state: 'processing'
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

  const response = existing.response as { state?: string } | null
  if (response?.state === 'processing') {
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
