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

  it.each([
    ['value_breach', 'instance', 'checklist_alerts'],
    ['weekly_summary', 'week', 'checklist_summary'],
    ['system_alert', 'closing_night', 'checklist_alerts'],
    ['system_alert', 'season', 'checklist_alerts'],
    ['system_alert', 'generation_run', null],
  ])('processes %s from %s once across concurrent workers', async (emailType, sourceType, section) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T10:58:35.000Z'))

    const db = new FakeOutboxDb({
      id: 'outbox-1',
      email_type: emailType,
      source_type: sourceType,
      source_id: 'instance-1',
      idempotency_key: 'value_breach:instance-1',
      to_addresses: [section ? 'manager@example.com' : 'peter@example.com'],
      subject: 'Checklist alert: Cellar Cooler is above the limit (15 degC)',
      body_html: '<p>Alert</p>',
      status: 'pending',
      attempts: 0,
      next_attempt_at: '2026-07-26T10:58:03.000Z',
      created_at: '2026-07-26T10:58:03.000Z',
    })
    const send = vi.fn().mockResolvedValue({ success: true, messageId: 'message-1' })
    const queue = vi.fn().mockResolvedValue({ success: true, queued: true, emailMessageId: 'queue-1' })

    const results = await Promise.all([
      runOutboxProcess({ db: db as never, send, queue }),
      runOutboxProcess({ db: db as never, send, queue }),
    ])

    if (section) {
      expect(send).not.toHaveBeenCalled()
      expect(queue).toHaveBeenCalledTimes(1)
      expect(queue).toHaveBeenCalledWith(expect.objectContaining({
        section, key: 'outbox-1', to: 'manager@example.com',
        metadata: expect.objectContaining({ checklist_outbox_id: 'outbox-1' }),
      }))
      expect(db.rows[0]).toMatchObject({ status: 'held', sent_at: null, message_id: null })
      expect(results.map((result) => result.queued).sort()).toEqual([0, 1])
      expect(results.map((result) => result.sent)).toEqual([0, 0])
    } else {
      expect(queue).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'peter@example.com', idempotencyKey: 'checklist:outbox-1', commType: 'checklist_alert',
      }))
      expect(db.rows[0]).toMatchObject({ status: 'sent', message_id: 'message-1' })
      expect(results.map((result) => result.sent).sort()).toEqual([0, 1])
    }
  })
  it('keeps a failed manager queue entry pending for retry without sending directly', async () => {
    const db = new FakeOutboxDb({
      id: 'outbox-1', email_type: 'value_breach', source_type: 'instance',
      subject: 'Temperature alert', to_addresses: ['manager@example.com'],
      status: 'pending', next_attempt_at: null, attempts: 0,
    })
    const send = vi.fn()
    const queue = vi.fn().mockResolvedValue({ success: false, error: 'queue unavailable' })
    const results = await Promise.all([
      runOutboxProcess({ db: db as never, send, queue }),
      runOutboxProcess({ db: db as never, send, queue }),
    ])
    expect(send).not.toHaveBeenCalled()
    expect(db.rows[0]).toMatchObject({ status: 'pending', attempts: 1, error_message: 'queue unavailable' })
    expect(db.rows[0].sent_at).toBeUndefined()
    expect(results.map(result => result.retried).sort()).toEqual([0, 1])
  })

})
