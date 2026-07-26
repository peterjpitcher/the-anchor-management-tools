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

  it('sends a pending row once when two outbox jobs process it concurrently', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T10:58:35.000Z'))

    const db = new FakeOutboxDb({
      id: 'outbox-1',
      email_type: 'value_breach',
      source_type: 'instance',
      source_id: 'instance-1',
      idempotency_key: 'value_breach:instance-1',
      to_addresses: ['manager@example.com'],
      subject: 'Checklist alert: Cellar Cooler is above the limit (15 degC)',
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
      idempotencyKey: 'checklist:outbox-1',
      commType: 'checklist_alert',
    }))
    expect(db.rows[0]).toMatchObject({ status: 'sent', message_id: 'message-1' })
    expect(results.map((result) => result.sent).sort()).toEqual([0, 1])
  })
})
