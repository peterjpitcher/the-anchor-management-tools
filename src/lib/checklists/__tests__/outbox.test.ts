import { afterEach, describe, expect, it, vi } from 'vitest'
import { runOutboxProcess } from '@/lib/checklists/jobs/outbox'

type OutboxRow = Record<string, unknown> & {
  id: string
  status: string
  next_attempt_at: string | null
}

type Filter = {
  field: string
  value: unknown
}

class FakeQuery {
  private operation: 'select' | 'update' | 'upsert' | null = null
  private patch: Record<string, unknown> | null = null
  private filters: Filter[] = []
  private maxRows: number | null = null

  constructor(private readonly db: FakeOutboxDb) {}

  select() {
    if (!this.operation) this.operation = 'select'
    return this
  }

  update(patch: Record<string, unknown>) {
    this.operation = 'update'
    this.patch = patch
    return this
  }

  upsert() {
    this.operation = 'upsert'
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value })
    return this
  }

  is(field: string, value: unknown) {
    this.filters.push({ field, value })
    return this
  }

  or() {
    return this
  }

  order() {
    return this
  }

  limit(value: number) {
    this.maxRows = value
    return this
  }

  maybeSingle() {
    return this.execute().then(({ data, error }) => ({
      data: Array.isArray(data) ? data[0] ?? null : data,
      error,
    }))
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private matches(row: OutboxRow) {
    return this.filters.every(({ field, value }) => row[field] === value)
  }

  private async execute(): Promise<{ data: OutboxRow[] | null; error: null }> {
    if (this.operation === 'select') {
      const rows = this.db.rows.filter((row) => this.matches(row))
      const selected = this.maxRows == null ? rows : rows.slice(0, this.maxRows)
      return this.db.releaseSelectTogether(selected.map((row) => ({ ...row })))
    }

    if (this.operation === 'update' && this.patch) {
      const updated: OutboxRow[] = []
      for (const row of this.db.rows) {
        if (!this.matches(row)) continue
        Object.assign(row, this.patch)
        updated.push({ ...row })
      }
      return { data: updated, error: null }
    }

    return { data: null, error: null }
  }
}

class FakeOutboxDb {
  readonly rows: OutboxRow[]
  private selectWaiters: Array<() => void> = []

  constructor(row: OutboxRow) {
    this.rows = [row]
  }

  from(table: string) {
    if (table !== 'checklist_email_outbox') throw new Error(`Unexpected table: ${table}`)
    return new FakeQuery(this)
  }

  async releaseSelectTogether(rows: OutboxRow[]): Promise<{ data: OutboxRow[]; error: null }> {
    await new Promise<void>((resolve) => {
      this.selectWaiters.push(resolve)
      if (this.selectWaiters.length === 2) {
        const waiters = this.selectWaiters.splice(0)
        waiters.forEach((release) => release())
      }
    })
    return { data: rows, error: null }
  }
}

describe('runOutboxProcess', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // Manager checklist alerts are no longer written to the outbox (the weekly insights report
  // covers them), so everything left is sent immediately and nothing is held for a report.
  it.each([
    ['system_alert', 'generation_run', 'peter@example.com'],
    ['system_alert', 'mismatch', 'peter@example.com'],
    ['system_alert', 'season', 'manager@example.com'],
  ])('sends %s from %s once across concurrent workers', async (emailType, sourceType, to) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T10:58:35.000Z'))

    const db = new FakeOutboxDb({
      id: 'outbox-1',
      email_type: emailType,
      source_type: sourceType,
      source_id: 'source-1',
      idempotency_key: `${sourceType}:source-1`,
      to_addresses: [to],
      subject: 'Checklist generation failed for 2026-07-26',
      body_html: '<p>Alert</p>',
      status: 'pending',
      attempts: 0,
      next_attempt_at: '2026-07-26T10:58:03.000Z',
      created_at: '2026-07-26T10:58:03.000Z',
    })
    const send = vi.fn().mockResolvedValue({ success: true, messageId: 'message-1' })

    const results = await Promise.all([
      runOutboxProcess({ db: db as never, send }),
      runOutboxProcess({ db: db as never, send }),
    ])

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to, idempotencyKey: 'checklist:outbox-1', commType: 'checklist_alert',
    }))
    expect(db.rows[0]).toMatchObject({ status: 'sent', message_id: 'message-1' })
    expect(db.rows[0].status).not.toBe('held')
    expect(results.map((result) => result.sent).sort()).toEqual([0, 1])
    expect(results.every((result) => !('queued' in result))).toBe(true)
  })

  it('keeps a failed send pending for retry with backoff', async () => {
    const db = new FakeOutboxDb({
      id: 'outbox-1', email_type: 'system_alert', source_type: 'generation_run',
      subject: 'Checklist generation failed', to_addresses: ['peter@example.com'],
      status: 'pending', next_attempt_at: null, attempts: 0,
    })
    const send = vi.fn().mockResolvedValue({ success: false, error: 'provider unavailable' })
    const results = await Promise.all([
      runOutboxProcess({ db: db as never, send }),
      runOutboxProcess({ db: db as never, send }),
    ])
    expect(send).toHaveBeenCalledTimes(1)
    expect(db.rows[0]).toMatchObject({ status: 'pending', attempts: 1, error_message: 'provider unavailable' })
    expect(db.rows[0].sent_at).toBeUndefined()
    expect(results.map(result => result.retried).sort()).toEqual([0, 1])
  })

})
