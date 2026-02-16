import { describe, expect, it } from 'vitest'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  lookupIdempotencyKey
} from '@/lib/api/idempotency'

type IdempotencyRow = {
  key: string
  request_hash: string
  response: unknown
  expires_at: string
}

class IdempotencyTableQuery {
  private mode: 'select' | 'update' | 'delete' | null = null
  private filters: Array<(row: IdempotencyRow) => boolean> = []
  private updateValues: Partial<IdempotencyRow> = {}
  private selectedColumns: string | null = null

  constructor(private readonly rows: Map<string, IdempotencyRow>) {}

  insert(payload: IdempotencyRow | IdempotencyRow[]) {
    const row = Array.isArray(payload) ? payload[0] : payload
    if (!row) {
      return { error: null }
    }

    if (this.rows.has(row.key)) {
      return {
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint'
        }
      }
    }

    this.rows.set(row.key, { ...row })
    return { error: null }
  }

  upsert(payload: IdempotencyRow) {
    this.rows.set(payload.key, { ...payload })
    return { error: null }
  }

  select(columns: string) {
    this.selectedColumns = columns
    if (!this.mode) {
      this.mode = 'select'
    }
    return this
  }

  update(values: Partial<IdempotencyRow>) {
    this.mode = 'update'
    this.updateValues = values
    return this
  }

  delete() {
    this.mode = 'delete'
    return this
  }

  eq(column: keyof IdempotencyRow, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  lt(column: keyof IdempotencyRow, value: string) {
    this.filters.push((row) => String(row[column]) < value)
    return this
  }

  maybeSingle() {
    const matches = [...this.rows.values()].filter((row) => this.filters.every((fn) => fn(row)))

    if (this.mode === 'update') {
      if (matches.length === 0) {
        return { data: null, error: null }
      }

      const target = matches[0]
      const updated: IdempotencyRow = {
        ...target,
        ...this.updateValues
      }
      this.rows.set(updated.key, updated)
      return {
        data: this.selectedColumns === 'key' ? { key: updated.key } : updated,
        error: null
      }
    }

    if (this.mode === 'delete') {
      if (matches.length === 0) {
        return { error: null }
      }

      for (const row of matches) {
        this.rows.delete(row.key)
      }
      return { error: null }
    }

    if (matches.length === 0) {
      return { data: null, error: null }
    }

    const row = matches[0]
    if (this.selectedColumns === 'request_hash, response, expires_at') {
      return {
        data: {
          request_hash: row.request_hash,
          response: row.response,
          expires_at: row.expires_at
        },
        error: null
      }
    }

    if (this.selectedColumns === 'request_hash, response') {
      return {
        data: {
          request_hash: row.request_hash,
          response: row.response
        },
        error: null
      }
    }

    if (this.selectedColumns === 'key') {
      return { data: { key: row.key }, error: null }
    }

    return { data: row, error: null }
  }
}

class IdempotencySupabaseMock {
  private readonly rows = new Map<string, IdempotencyRow>()

  from(table: string) {
    if (table !== 'idempotency_keys') {
      throw new Error(`Unexpected table: ${table}`)
    }
    return new IdempotencyTableQuery(this.rows)
  }

  seed(row: IdempotencyRow) {
    this.rows.set(row.key, { ...row })
  }

  get(key: string): IdempotencyRow | undefined {
    return this.rows.get(key)
  }
}

describe('computeIdempotencyRequestHash', () => {
  it('produces the same hash for semantically identical payloads', () => {
    const a = {
      customer: {
        first_name: 'Pete',
        mobile_number: '+447700900123'
      },
      seats: 4,
      event_id: 'abc'
    }

    const b = {
      event_id: 'abc',
      seats: 4,
      customer: {
        mobile_number: '+447700900123',
        first_name: 'Pete'
      }
    }

    expect(computeIdempotencyRequestHash(a)).toBe(computeIdempotencyRequestHash(b))
  })
})

describe('getIdempotencyKey', () => {
  it('returns trimmed key values', () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '   test-key-123   '
      }
    })

    expect(getIdempotencyKey(request)).toBe('test-key-123')
  })

  it('returns null when the header is missing', () => {
    const request = new Request('https://example.com', { method: 'POST' })
    expect(getIdempotencyKey(request)).toBeNull()
  })
})

describe('idempotency key lifecycle', () => {
  it('treats expired keys as new during lookup', async () => {
    const supabase = new IdempotencySupabaseMock()
    supabase.seed({
      key: 'expired-key',
      request_hash: 'hash-a',
      response: { state: 'processed' },
      expires_at: new Date(Date.now() - 60_000).toISOString()
    })

    const lookup = await lookupIdempotencyKey(
      supabase as unknown as Parameters<typeof lookupIdempotencyKey>[0],
      'expired-key',
      'hash-a'
    )

    expect(lookup).toEqual({ state: 'new' })
  })

  it('reclaims expired claim rows for a fresh request', async () => {
    const supabase = new IdempotencySupabaseMock()
    supabase.seed({
      key: 'reclaim-key',
      request_hash: 'old-hash',
      response: { state: 'processing' },
      expires_at: new Date(Date.now() - 60_000).toISOString()
    })

    const claim = await claimIdempotencyKey(
      supabase as unknown as Parameters<typeof claimIdempotencyKey>[0],
      'reclaim-key',
      'new-hash',
      1
    )

    expect(claim).toEqual({ state: 'claimed' })
    expect(supabase.get('reclaim-key')?.request_hash).toBe('new-hash')
    expect(supabase.get('reclaim-key')?.response).toEqual({ state: 'processing' })
  })

  it('keeps active processing keys in progress', async () => {
    const supabase = new IdempotencySupabaseMock()
    supabase.seed({
      key: 'processing-key',
      request_hash: 'same-hash',
      response: { state: 'processing' },
      expires_at: new Date(Date.now() + 60_000).toISOString()
    })

    const claim = await claimIdempotencyKey(
      supabase as unknown as Parameters<typeof claimIdempotencyKey>[0],
      'processing-key',
      'same-hash',
      1
    )

    expect(claim).toEqual({ state: 'in_progress' })
  })
})
