import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type IdempotencyLookupResult =
  | { state: 'new' }
  | { state: 'replay'; response: unknown }
  | { state: 'conflict' }

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

export async function lookupIdempotencyKey(
  supabase: SupabaseClient<any, 'public', any>,
  key: string,
  requestHash: string
): Promise<IdempotencyLookupResult> {
  const { data, error } = await supabase
    .from('idempotency_keys')
    .select('request_hash, response')
    .eq('key', key)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
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
