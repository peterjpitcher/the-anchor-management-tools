import { describe, expect, it } from 'vitest'
import { buildSmsDedupContext, claimSmsIdempotency, evaluateSmsSafetyLimits } from '@/lib/sms/safety'

type IdempotencyRow = {
  key: string
  request_hash: string
  expires_at: string
}

class IdempotencyKeysQuery {
  private mode: 'select' | 'update' | null = null
  private filters: Array<(row: IdempotencyRow) => boolean> = []
  private updateValues: Partial<IdempotencyRow> = {}
  private selectedColumns: string | null = null

  constructor(private readonly rows: Map<string, IdempotencyRow>) {}

  insert(payload: { key: string; request_hash: string; expires_at: string }) {
    if (this.rows.has(payload.key)) {
      return {
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint'
        }
      }
    }

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
      const existing = matches[0]
      const updated = { ...existing, ...this.updateValues }
      this.rows.set(updated.key, updated)
      return {
        data: this.selectedColumns === 'key' ? { key: updated.key } : updated,
        error: null
      }
    }

    if (matches.length === 0) {
      return { data: null, error: null }
    }

    const row = matches[0]
    if (this.selectedColumns === 'request_hash, expires_at') {
      return {
        data: {
          request_hash: row.request_hash,
          expires_at: row.expires_at
        },
        error: null
      }
    }

    return { data: row, error: null }
  }
}

class SupabaseSmsIdempotencyMock {
  private readonly rows = new Map<string, IdempotencyRow>()

  from(table: string) {
    if (table !== 'idempotency_keys') {
      throw new Error(`Unexpected table ${table}`)
    }
    return new IdempotencyKeysQuery(this.rows)
  }

  seed(row: IdempotencyRow) {
    this.rows.set(row.key, { ...row })
  }

  get(key: string) {
    return this.rows.get(key)
  }
}

describe('buildSmsDedupContext', () => {
  it('returns null when template_key is missing', () => {
    expect(
      buildSmsDedupContext({
        to: '+447700900123',
        customerId: 'customer-1',
        body: 'hello',
        metadata: { event_id: 'event-1' }
      })
    ).toBeNull()
  })

  it('builds stable key for same template and identity context', () => {
    const first = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'hello world',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1',
        event_id: 'event-1'
      }
    })

    const second = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'hello world',
      metadata: {
        event_id: 'event-1',
        event_booking_id: 'booking-1',
        template_key: 'event_review_followup'
      }
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.key).toBe(second?.key)
    expect(first?.requestHash).toBe(second?.requestHash)
  })

  it('changes request hash when body changes but keeps dedupe key', () => {
    const first = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'first body',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1'
      }
    })

    const second = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'second body',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1'
      }
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.key).toBe(second?.key)
    expect(first?.requestHash).not.toBe(second?.requestHash)
  })

  it('changes dedupe key when bulk campaign id changes', () => {
    const first = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'campaign message',
      metadata: {
        template_key: 'bulk_sms_campaign',
        bulk_job_id: 'bulk-job-1'
      }
    })

    const second = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'campaign message',
      metadata: {
        template_key: 'bulk_sms_campaign',
        bulk_job_id: 'bulk-job-2'
      }
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.key).not.toBe(second?.key)
  })

  it('does not change dedupe context when only queue job metadata changes', () => {
    const first = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'queued reminder',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1',
        queue_job_id: 'job-a'
      }
    })

    const second = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'queued reminder',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1',
        queue_job_id: 'job-b'
      }
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.key).toBe(second?.key)
    expect(first?.requestHash).toBe(second?.requestHash)
  })

  it('does not change dedupe context when only legacy job_id metadata changes', () => {
    const first = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'queued reminder',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1',
        job_id: 'job-a'
      }
    })

    const second = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'queued reminder',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1',
        job_id: 'job-b'
      }
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.key).toBe(second?.key)
    expect(first?.requestHash).toBe(second?.requestHash)
  })
})

describe('claimSmsIdempotency', () => {
  it('reclaims expired rows instead of treating them as active duplicates', async () => {
    const context = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'first body',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1'
      }
    })

    expect(context).not.toBeNull()

    const supabase = new SupabaseSmsIdempotencyMock()
    supabase.seed({
      key: context!.key,
      request_hash: 'old-hash',
      expires_at: new Date(Date.now() - 60_000).toISOString()
    })

    const result = await claimSmsIdempotency(
      supabase as unknown as Parameters<typeof claimSmsIdempotency>[0],
      context!
    )

    expect(result).toBe('claimed')
    expect(supabase.get(context!.key)?.request_hash).toBe(context!.requestHash)
  })

  it('fails closed in production when the idempotency table is unavailable', async () => {
    const context = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'missing table test',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1'
      }
    })

    expect(context).not.toBeNull()

    const previousNodeEnv = process.env.NODE_ENV
    const previousAllowMissingTables = process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    process.env.NODE_ENV = 'production'
    delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    try {
      const result = await claimSmsIdempotency(
        {
          from(table: string) {
            if (table !== 'idempotency_keys') {
              throw new Error(`Unexpected table ${table}`)
            }

            return {
              insert() {
                return {
                  error: {
                    code: '42P01',
                    message: 'relation \"idempotency_keys\" does not exist'
                  }
                }
              }
            }
          }
        } as unknown as Parameters<typeof claimSmsIdempotency>[0],
        context!
      )

      expect(result).toBe('conflict')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }

      if (previousAllowMissingTables === undefined) {
        delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES
      } else {
        process.env.SMS_SAFETY_ALLOW_MISSING_TABLES = previousAllowMissingTables
      }
    }
  })

  it('ignores allow-missing-tables config in production when the idempotency table is unavailable', async () => {
    const context = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'missing table allowMissingTables override test',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1'
      }
    })

    expect(context).not.toBeNull()

    const previousNodeEnv = process.env.NODE_ENV
    const previousAllowMissingTables = process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    process.env.NODE_ENV = 'production'
    process.env.SMS_SAFETY_ALLOW_MISSING_TABLES = 'true'

    try {
      const result = await claimSmsIdempotency(
        {
          from(table: string) {
            if (table !== 'idempotency_keys') {
              throw new Error(`Unexpected table ${table}`)
            }

            return {
              insert() {
                return {
                  error: {
                    code: '42P01',
                    message: 'relation \"idempotency_keys\" does not exist'
                  }
                }
              }
            }
          }
        } as unknown as Parameters<typeof claimSmsIdempotency>[0],
        context!
      )

      expect(result).toBe('conflict')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }

      if (previousAllowMissingTables === undefined) {
        delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES
      } else {
        process.env.SMS_SAFETY_ALLOW_MISSING_TABLES = previousAllowMissingTables
      }
    }
  })

  it('fails closed in production when duplicate-key lookup cannot read idempotency table', async () => {
    const context = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'missing table lookup test',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1'
      }
    })

    expect(context).not.toBeNull()

    const previousNodeEnv = process.env.NODE_ENV
    const previousAllowMissingTables = process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    process.env.NODE_ENV = 'production'
    delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    try {
      const result = await claimSmsIdempotency(
        {
          from(table: string) {
            if (table !== 'idempotency_keys') {
              throw new Error(`Unexpected table ${table}`)
            }

            return {
              insert() {
                return {
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint'
                  }
                }
              },
              select() {
                return this
              },
              eq() {
                return this
              },
              maybeSingle() {
                return {
                  data: null,
                  error: {
                    code: '42P01',
                    message: 'relation "idempotency_keys" does not exist'
                  }
                }
              }
            }
          }
        } as unknown as Parameters<typeof claimSmsIdempotency>[0],
        context!
      )

      expect(result).toBe('conflict')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }

      if (previousAllowMissingTables === undefined) {
        delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES
      } else {
        process.env.SMS_SAFETY_ALLOW_MISSING_TABLES = previousAllowMissingTables
      }
    }
  })

  it('fails closed in production when reclaiming expired idempotency rows cannot write', async () => {
    const context = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'missing table reclaim test',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1'
      }
    })

    expect(context).not.toBeNull()

    const previousNodeEnv = process.env.NODE_ENV
    const previousAllowMissingTables = process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    process.env.NODE_ENV = 'production'
    delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    try {
      const duplicateThenMissingOnReclaim = {
        mode: 'select',
        insert() {
          return {
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint'
            }
          }
        },
        select() {
          if (this.mode !== 'update') {
            this.mode = 'select'
          }
          return this
        },
        update() {
          this.mode = 'update'
          return this
        },
        eq() {
          return this
        },
        lt() {
          return this
        },
        maybeSingle() {
          if (this.mode === 'update') {
            return {
              data: null,
              error: {
                code: '42P01',
                message: 'relation "idempotency_keys" does not exist'
              }
            }
          }

          return {
            data: {
              request_hash: 'old-hash',
              expires_at: new Date(Date.now() - 60_000).toISOString()
            },
            error: null
          }
        }
      }

      const result = await claimSmsIdempotency(
        {
          from(table: string) {
            if (table !== 'idempotency_keys') {
              throw new Error(`Unexpected table ${table}`)
            }

            return duplicateThenMissingOnReclaim
          }
        } as unknown as Parameters<typeof claimSmsIdempotency>[0],
        context!
      )

      expect(result).toBe('conflict')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }

      if (previousAllowMissingTables === undefined) {
        delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES
      } else {
        process.env.SMS_SAFETY_ALLOW_MISSING_TABLES = previousAllowMissingTables
      }
    }
  })
})

describe('evaluateSmsSafetyLimits', () => {
  it('fails closed in production when the messages table is unavailable', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousAllowMissingTables = process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    process.env.NODE_ENV = 'production'
    delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    try {
      const result = await evaluateSmsSafetyLimits(
        {
          from(table: string) {
            if (table !== 'messages') {
              throw new Error(`Unexpected table ${table}`)
            }

            return {
              select() {
                return this
              },
              eq() {
                return this
              },
              gte() {
                return Promise.resolve({
                  count: null,
                  error: {
                    code: '42P01',
                    message: 'relation \"messages\" does not exist'
                  }
                })
              }
            }
          }
        } as unknown as Parameters<typeof evaluateSmsSafetyLimits>[0],
        {
          to: '+447700900123',
          customerId: 'customer-1'
        }
      )

      expect(result.allowed).toBe(false)
      if (result.allowed) {
        throw new Error('Expected unavailable safety result')
      }
      expect(result.code).toBe('safety_unavailable')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }

      if (previousAllowMissingTables === undefined) {
        delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES
      } else {
        process.env.SMS_SAFETY_ALLOW_MISSING_TABLES = previousAllowMissingTables
      }
    }
  })

  it('ignores allow-missing-tables config in production when the messages table is unavailable', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousAllowMissingTables = process.env.SMS_SAFETY_ALLOW_MISSING_TABLES

    process.env.NODE_ENV = 'production'
    process.env.SMS_SAFETY_ALLOW_MISSING_TABLES = 'true'

    try {
      const result = await evaluateSmsSafetyLimits(
        {
          from(table: string) {
            if (table !== 'messages') {
              throw new Error(`Unexpected table ${table}`)
            }

            return {
              select() {
                return this
              },
              eq() {
                return this
              },
              gte() {
                return Promise.resolve({
                  count: null,
                  error: {
                    code: '42P01',
                    message: 'relation \"messages\" does not exist'
                  }
                })
              }
            }
          }
        } as unknown as Parameters<typeof evaluateSmsSafetyLimits>[0],
        {
          to: '+447700900123',
          customerId: 'customer-1'
        }
      )

      expect(result.allowed).toBe(false)
      if (result.allowed) {
        throw new Error('Expected unavailable safety result')
      }
      expect(result.code).toBe('safety_unavailable')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }

      if (previousAllowMissingTables === undefined) {
        delete process.env.SMS_SAFETY_ALLOW_MISSING_TABLES
      } else {
        process.env.SMS_SAFETY_ALLOW_MISSING_TABLES = previousAllowMissingTables
      }
    }
  })
})
