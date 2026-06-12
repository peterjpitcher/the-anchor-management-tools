import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  releaseIdempotencyClaim,
  STALE_PROCESSING_MS,
} from '../idempotency'

type StepResult = { data?: unknown; error: unknown }

type Script = {
  inserts?: StepResult[]
  selects?: StepResult[]
  updates?: StepResult[]
  deletes?: StepResult[]
}

type RecordedCalls = {
  inserts: unknown[]
  updates: unknown[]
  filters: string[][]
}

function createFakeSupabase(script: Script): { client: any; calls: RecordedCalls } {
  const calls: RecordedCalls = { inserts: [], updates: [], filters: [] }

  const makeBuilder = () => {
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select'
    const currentFilters: string[] = []

    const pop = (): StepResult => {
      calls.filters.push([...currentFilters])
      const queue =
        mode === 'insert' ? script.inserts :
        mode === 'update' ? script.updates :
        mode === 'delete' ? script.deletes :
        script.selects
      const result = queue?.shift()
      if (!result) {
        throw new Error(`No scripted result for ${mode}`)
      }
      return result
    }

    const builder: any = {
      insert(payload: unknown) {
        mode = 'insert'
        calls.inserts.push(payload)
        return builder
      },
      update(payload: unknown) {
        mode = 'update'
        calls.updates.push(payload)
        return builder
      },
      delete() {
        mode = 'delete'
        return builder
      },
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        currentFilters.push(`eq:${column}=${value}`)
        return builder
      },
      lt(column: string, value: unknown) {
        currentFilters.push(`lt:${column}=${value}`)
        return builder
      },
      filter(column: string, operator: string, value: unknown) {
        currentFilters.push(`${operator}:${column}=${value}`)
        return builder
      },
      maybeSingle() {
        return Promise.resolve(pop())
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(pop()).then(resolve, reject)
      },
    }

    return builder
  }

  return {
    client: { from: () => makeBuilder() },
    calls,
  }
}

const KEY = 'test-key'
const HASH = 'hash-1'
const DUPLICATE_INSERT: StepResult = { error: { code: '23505' } }
const futureIso = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()
const recentClaimIso = () => new Date(Date.now() - 60 * 1000).toISOString()
const staleClaimIso = () => new Date(Date.now() - STALE_PROCESSING_MS - 60 * 1000).toISOString()

describe('computeIdempotencyRequestHash', () => {
  it('should produce the same hash when key order differs', () => {
    const a = computeIdempotencyRequestHash({ first: 'Chloe', nested: { x: 1, y: 2 } })
    const b = computeIdempotencyRequestHash({ nested: { y: 2, x: 1 }, first: 'Chloe' })
    expect(a).toBe(b)
  })

  it('should change when any field value changes', () => {
    const a = computeIdempotencyRequestHash({ email: 'a@b.com', consent_at: '2026-06-12T06:00:00Z' })
    const b = computeIdempotencyRequestHash({ email: 'a@b.com', consent_at: '2026-06-12T06:00:01Z' })
    expect(a).not.toBe(b)
  })
})

describe('claimIdempotencyKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should claim a fresh key and stamp claimed_at on the processing marker', async () => {
    const { client, calls } = createFakeSupabase({ inserts: [{ error: null }] })

    const result = await claimIdempotencyKey(client, KEY, HASH)

    expect(result).toEqual({ state: 'claimed' })
    const inserted = calls.inserts[0] as { response: { state: string; claimed_at: string } }
    expect(inserted.response.state).toBe('processing')
    expect(typeof inserted.response.claimed_at).toBe('string')
    expect(Number.isFinite(Date.parse(inserted.response.claimed_at))).toBe(true)
  })

  it('should report in_progress when a recent processing claim holds the key', async () => {
    const { client } = createFakeSupabase({
      inserts: [DUPLICATE_INSERT],
      selects: [{
        data: {
          request_hash: HASH,
          response: { state: 'processing', claimed_at: recentClaimIso() },
          expires_at: futureIso(),
        },
        error: null,
      }],
    })

    const result = await claimIdempotencyKey(client, KEY, HASH)

    expect(result).toEqual({ state: 'in_progress' })
  })

  it('should reclaim a stale processing claim with an optimistic lock on claimed_at', async () => {
    const staleClaimedAt = staleClaimIso()
    const { client, calls } = createFakeSupabase({
      inserts: [DUPLICATE_INSERT],
      selects: [{
        data: {
          request_hash: HASH,
          response: { state: 'processing', claimed_at: staleClaimedAt },
          expires_at: futureIso(),
        },
        error: null,
      }],
      updates: [{ data: { key: KEY }, error: null }],
    })

    const result = await claimIdempotencyKey(client, KEY, HASH)

    expect(result).toEqual({ state: 'claimed' })
    const updateFilters = calls.filters[calls.filters.length - 1]
    expect(updateFilters).toContain(`eq:response->>state=processing`)
    expect(updateFilters).toContain(`eq:response->>claimed_at=${staleClaimedAt}`)
  })

  it('should treat legacy processing claims without claimed_at as stale', async () => {
    const { client, calls } = createFakeSupabase({
      inserts: [DUPLICATE_INSERT],
      selects: [{
        data: {
          request_hash: HASH,
          response: { state: 'processing' },
          expires_at: futureIso(),
        },
        error: null,
      }],
      updates: [{ data: { key: KEY }, error: null }],
    })

    const result = await claimIdempotencyKey(client, KEY, HASH)

    expect(result).toEqual({ state: 'claimed' })
    const updateFilters = calls.filters[calls.filters.length - 1]
    expect(updateFilters).toContain('is:response->>claimed_at=null')
  })

  it('should replay the persisted response when losing the stale-reclaim race to completion', async () => {
    const persistedResponse = { success: true, data: { application_id: 'app-1' } }
    const { client } = createFakeSupabase({
      inserts: [DUPLICATE_INSERT],
      selects: [
        {
          data: {
            request_hash: HASH,
            response: { state: 'processing', claimed_at: staleClaimIso() },
            expires_at: futureIso(),
          },
          error: null,
        },
        {
          data: {
            request_hash: HASH,
            response: persistedResponse,
            expires_at: futureIso(),
          },
          error: null,
        },
      ],
      updates: [{ data: null, error: null }],
    })

    const result = await claimIdempotencyKey(client, KEY, HASH)

    expect(result).toEqual({ state: 'replay', response: persistedResponse })
  })

  it('should report in_progress when losing the stale-reclaim race to another claimer', async () => {
    const { client } = createFakeSupabase({
      inserts: [DUPLICATE_INSERT],
      selects: [
        {
          data: {
            request_hash: HASH,
            response: { state: 'processing', claimed_at: staleClaimIso() },
            expires_at: futureIso(),
          },
          error: null,
        },
        {
          data: {
            request_hash: HASH,
            response: { state: 'processing', claimed_at: recentClaimIso() },
            expires_at: futureIso(),
          },
          error: null,
        },
      ],
      updates: [{ data: null, error: null }],
    })

    const result = await claimIdempotencyKey(client, KEY, HASH)

    expect(result).toEqual({ state: 'in_progress' })
  })

  it('should replay a completed response for the same request hash', async () => {
    const persistedResponse = { success: true, data: { application_id: 'app-1' } }
    const { client } = createFakeSupabase({
      inserts: [DUPLICATE_INSERT],
      selects: [{
        data: { request_hash: HASH, response: persistedResponse, expires_at: futureIso() },
        error: null,
      }],
    })

    const result = await claimIdempotencyKey(client, KEY, HASH)

    expect(result).toEqual({ state: 'replay', response: persistedResponse })
  })

  it('should report conflict when the same key is reused with a different payload', async () => {
    const { client } = createFakeSupabase({
      inserts: [DUPLICATE_INSERT],
      selects: [{
        data: {
          request_hash: 'different-hash',
          response: { state: 'processing', claimed_at: recentClaimIso() },
          expires_at: futureIso(),
        },
        error: null,
      }],
    })

    const result = await claimIdempotencyKey(client, KEY, HASH)

    expect(result).toEqual({ state: 'conflict' })
  })

  it('should reclaim an expired key regardless of state', async () => {
    const { client } = createFakeSupabase({
      inserts: [DUPLICATE_INSERT],
      selects: [{
        data: {
          request_hash: HASH,
          response: { state: 'processing', claimed_at: recentClaimIso() },
          expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
        },
        error: null,
      }],
      updates: [{ data: { key: KEY }, error: null }],
    })

    const result = await claimIdempotencyKey(client, KEY, HASH)

    expect(result).toEqual({ state: 'claimed' })
  })
})

describe('releaseIdempotencyClaim', () => {
  it('should delete the claim scoped to key and request hash', async () => {
    const { client, calls } = createFakeSupabase({ deletes: [{ error: null }] })

    await releaseIdempotencyClaim(client, KEY, HASH)

    expect(calls.filters[0]).toContain(`eq:key=${KEY}`)
    expect(calls.filters[0]).toContain(`eq:request_hash=${HASH}`)
  })
})
