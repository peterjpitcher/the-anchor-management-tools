import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverManagerReport } from '@/lib/manager-report/delivery'
import { queueManagerReportEmail } from '@/lib/manager-report/queue'
import { managerReportPeriod } from '@/lib/manager-report/schedule'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { EmailOptions } from '@/lib/email/emailService'

const mocks = vi.hoisted(() => ({ admin: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn(() => { throw new Error('No real transport allowed') }) }))
vi.mock('@/lib/manager-report/render', () => ({
  renderManagerReport: ({ entries }: { entries: { subject: string }[] }) => ({
    subject: `Weekly report: ${entries.length}`, html: entries.map(e => e.subject).join('<br>'),
    text: entries.map(e => e.subject).join('\n'),
    attachment: { filename: 'details.html', contentType: 'text/html', content: '<p>All details</p>' },
  }),
}))

type Row = Record<string, unknown>
interface Failure { table: string; operation: string; matches?: (payload: Row) => boolean }
class MemoryDb {
  rows: Record<string, Row[]> = { email_messages: [], cron_job_runs: [], recruitment_communications: [], checklist_email_outbox: [], leave_reminder_log: [] }
  failures: Failure[] = []
  calls: { table: string; operation: string; payload: Row }[] = []
  from = (table: string): MemoryQuery => new MemoryQuery(this, table)
  asDb(): ReturnType<typeof createAdminClient> { return this as unknown as ReturnType<typeof createAdminClient> }
}
class MemoryQuery implements PromiseLike<{ data: Row[] | Row | null; error: { code?: string; message: string } | null }> {
  operation = 'select'; payload: Row = {}; filters: ((row: Row) => boolean)[] = []
  max = Infinity; singleResult = false; ignore = false; conflict = 'id'; sort = ''
  constructor(private db: MemoryDb, private table: string) {}
  select(): this { return this }
  insert(row: Row): this { this.operation = 'insert'; this.payload = row; return this }
  upsert(row: Row, options: { ignoreDuplicates?: boolean; onConflict?: string } = {}): this {
    this.operation = 'upsert'; this.payload = row; this.ignore = options.ignoreDuplicates ?? false; this.conflict = options.onConflict ?? 'id'; return this
  }
  update(row: Row): this { this.operation = 'update'; this.payload = row; return this }
  eq(key: string, value: unknown): this { this.filters.push(row => row[key] === value); return this }
  gt(key: string, value: string): this { this.filters.push(row => String(row[key]) > value); return this }
  lte(key: string, value: string): this { this.filters.push(row => String(row[key]) <= value); return this }
  in(key: string, values: unknown[]): this { this.filters.push(row => values.includes(row[key])); return this }
  order(key: string): this { this.sort = key; return this }
  limit(value: number): this { this.max = value; return this }
  single(): this { this.singleResult = true; return this }
  maybeSingle(): this { this.singleResult = true; return this }
  then<TResult1 = { data: Row[] | Row | null; error: { code?: string; message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | Row | null; error: { code?: string; message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => {
      this.db.calls.push({ table: this.table, operation: this.operation, payload: structuredClone(this.payload) })
      const failIndex = this.db.failures.findIndex(f => f.table === this.table && f.operation === this.operation && (!f.matches || f.matches(this.payload)))
      if (failIndex >= 0) {
        this.db.failures.splice(failIndex, 1)
        return { data: null, error: { message: 'Injected database failure' } }
      }
      const rows = this.db.rows[this.table]
      let results: Row[]
      if (this.operation === 'insert' || this.operation === 'upsert') {
        const duplicate = rows.find(row => this.table === 'cron_job_runs'
          ? row.job_name === this.payload.job_name && row.run_key === this.payload.run_key
          : this.conflict.split(',').every(key => row[key] === this.payload[key]))
        if (duplicate && this.operation === 'insert') return { data: null, error: { code: '23505', message: 'Duplicate' } }
        if (duplicate) {
          if (!this.ignore) Object.assign(duplicate, structuredClone(this.payload))
          results = this.ignore ? [] : [duplicate]
        } else {
          const row = { id: `generated-${rows.length}`, created_at: '2026-09-04T07:00:00.000Z', ...structuredClone(this.payload) }
          rows.push(row); results = [row]
        }
      } else {
        results = rows.filter(row => this.filters.every(filter => filter(row)))
        if (this.operation === 'update') for (const row of results) Object.assign(row, structuredClone(this.payload))
        if (this.sort) results.sort((a, b) => String(a[this.sort]).localeCompare(String(b[this.sort])))
        results = results.slice(0, this.max)
      }
      return { data: structuredClone(this.singleResult ? results[0] ?? null : results), error: null }
    }).then(onfulfilled, onrejected)
  }
}

let db: MemoryDb
let date: Date
let send: ReturnType<typeof vi.fn<(options: EmailOptions) => Promise<{ success: boolean; messageId?: string; error?: string }>>>
function run() { return deliverManagerReport({ db: db.asDb(), send, now: () => date }) }
async function queue(key = 'booking-1', metadata?: Row, to = 'manager@example.test') {
  return queueManagerReportEmail({ section: 'table_bookings', key, to, subject: `Booking ${key}`, html: '<p>Booking</p>', metadata })
}
const reportRows = () => db.rows.email_messages.filter(row => row.comm_type === 'manager_weekly_report')
const itemRows = () => db.rows.email_messages.filter(row => row.comm_type === 'manager_report_item')

beforeEach(() => {
  db = new MemoryDb(); date = new Date('2026-09-04T08:00:00Z')
  send = vi.fn(async () => ({ success: true, messageId: 'provider-1' }))
  mocks.admin.mockReturnValue(db.asDb())
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://management.example.test')
  vi.stubEnv('EMAIL_FROM_ADDRESS', 'reports@example.test')
  vi.stubEnv('MANAGER_EMAIL', 'manager@example.test')
})

describe('manager report queue', () => {
  it('atomically deduplicates recipient/source/section without resetting sent items', async () => {
    const first = await queue()
    itemRows()[0].status = 'sent'
    const retry = await queue(undefined, undefined, ' Manager@Example.Test ')
    expect(retry.emailMessageId).toBe(first.emailMessageId)
    expect(itemRows()).toHaveLength(1)
    expect(itemRows()[0].status).toBe('sent')
    await queue('booking-1', undefined, 'other@example.test')
    expect(itemRows()).toHaveLength(2)
  })
  it('reports persistence failure and invalid input truthfully', async () => {
    db.failures.push({ table: 'email_messages', operation: 'upsert' })
    expect(await queue()).toMatchObject({ success: false, error: 'Injected database failure' })
    expect(await queue('')).toMatchObject({ success: false })
    expect(await queue('bad-recipient', undefined, 'one@example.test,other.test')).toMatchObject({ success: false })
    expect(itemRows()).toHaveLength(0)
  })
})

describe('Friday local schedule', () => {
  it.each([
    ['2026-09-04T07:59:59Z', false], ['2026-09-04T08:00:00Z', true],
    ['2026-01-02T08:59:59Z', false], ['2026-01-02T09:00:00Z', true],
    ['2026-09-04T22:00:00Z', true], ['2026-09-04T23:00:00Z', false],
    ['2026-09-05T09:00:00Z', false],
  ])('%s has eligibility %s', (value, expected) => expect(Boolean(managerReportPeriod(new Date(value)))).toBe(expected))
  it('keeps both report boundaries at 09:00 through the DST transition', () => {
    expect(managerReportPeriod(new Date('2026-04-03T08:00:00Z'))).toMatchObject({
      periodStart: '2026-03-27T09:00:00.000Z', periodEnd: '2026-04-03T08:00:00.000Z',
    })
  })
})

describe('durable delivery', () => {
  it('skips outside Friday and sends an empty weekly report once', async () => {
    date = new Date('2026-09-05T08:00:00Z')
    expect(await run()).toMatchObject({ success: true, skipped: 'outside_friday_window' })
    expect(db.calls).toHaveLength(0)
    date = new Date('2026-09-04T08:00:00Z')
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(send.mock.calls[0][0].subject).toBe('Weekly report: 0')
    await run()
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('sends one report per recipient, freezing sender, attachment and membership', async () => {
    await queue('one'); await queue('two'); await queue('three', undefined, 'other@example.test')
    expect(await run()).toMatchObject({ success: true, sent: 2 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toMatchObject({ provider: 'resend', from: 'reports@example.test',
      attachments: [{ content: Buffer.from('<p>All details</p>').toString('base64') }] })
    expect(itemRows().every(row => row.status === 'sent')).toBe(true)
    expect(await run()).toMatchObject({ success: true, sent: 0 })
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('paginates beyond the database page limit', async () => {
    for (let i = 0; i < 1001; i++) await queue(`booking-${i}`)
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(send.mock.calls[0][0].subject).toBe('Weekly report: 1001')
    expect(itemRows().filter(row => row.status === 'sent')).toHaveLength(1001)
  })
  it('excludes simultaneous attempts using the unique lease and CAS stale takeover', async () => {
    await queue()
    db.rows.cron_job_runs.push({ id: 'old-lock', job_name: 'manager-weekly-report', run_key: 'delivery', status: 'running', started_at: '2026-09-04T07:00:00Z' })
    const results = await Promise.all([run(), run()])
    expect(results.some(result => result.skipped === 'already_running')).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('retries provider failure with the identical immutable payload and keeps late arrivals for next week', async () => {
    await queue('first')
    send.mockResolvedValueOnce({ success: false, error: 'Provider unavailable' })
    expect(await run()).toMatchObject({ success: false })
    const firstPayload = structuredClone(send.mock.calls[0][0])
    expect(itemRows()[0].status).toBe('queued')
    await queue('late')
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'changed@example.test')
    date = new Date('2026-09-04T09:00:00Z')
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(send.mock.calls[1][0]).toEqual(firstPayload)
    expect(itemRows().filter(row => row.status === 'queued')).toHaveLength(1)
    date = new Date('2026-09-11T08:00:00Z')
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(itemRows().every(row => row.status === 'sent')).toBe(true)
  })
  it('reuses the same provider key and payload after acceptance persistence fails', async () => {
    await queue()
    db.failures.push({ table: 'email_messages', operation: 'update', matches: payload => Boolean((payload.metadata as Row)?.acceptedAt) })
    expect(await run()).toMatchObject({ success: false })
    expect(itemRows()[0].status).toBe('queued')
    date = new Date('2026-09-04T09:00:00Z')
    expect(await run()).toMatchObject({ success: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0])
  })
  it('finalises recorded acceptance without calling provider again after item update failure', async () => {
    await queue()
    db.failures.push({ table: 'email_messages', operation: 'update', matches: payload => payload.status === 'sent' && !payload.metadata })
    expect(await run()).toMatchObject({ success: false })
    date = new Date('2026-09-11T08:00:00Z')
    expect(await run()).toMatchObject({ success: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(itemRows()[0].status).toBe('sent')
  })
  it('blocks ambiguous sends outside the provider deduplication window, preserving backlog', async () => {
    await queue()
    send.mockResolvedValueOnce({ success: false, error: 'Network timeout' })
    await run()
    date = new Date('2026-09-11T08:00:00Z')
    await queue('next-week')
    expect(await run()).toMatchObject({ success: false, error: expect.stringContaining('needs provider reconciliation') })
    expect(send).toHaveBeenCalledTimes(1)
    expect(itemRows().every(row => row.status === 'queued')).toBe(true)
  })
  it('treats a provider id as acceptance even when the transport log reports failure', async () => {
    await queue()
    send.mockResolvedValueOnce({ success: false, messageId: 'accepted-provider-id', error: 'Logging failed' })
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(itemRows()[0].status).toBe('sent')
    await run()
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('does not send when the immutable payload could not be persisted', async () => {
    await queue()
    db.failures.push({ table: 'email_messages', operation: 'insert' })
    expect(await run()).toMatchObject({ success: false })
    expect(send).not.toHaveBeenCalled()
    expect(itemRows()[0].status).toBe('queued')
    expect(db.rows.cron_job_runs[0]).toMatchObject({ status: 'failed', error_message: 'Injected database failure' })
    expect(await run()).toMatchObject({ success: true, sent: 1 })
  })
  it('retries source finalisation failure without sending the accepted payload again', async () => {
    db.rows.checklist_email_outbox.push({ id: 'checklist', status: 'held' })
    await queue('references', { checklist_outbox_id: 'checklist' })
    db.failures.push({ table: 'checklist_email_outbox', operation: 'update' })
    expect(await run()).toMatchObject({ success: false })
    expect(itemRows()[0].status).toBe('queued')
    expect(await run()).toMatchObject({ success: true })
    expect(send).toHaveBeenCalledTimes(1)
    expect(db.rows.checklist_email_outbox[0].status).toBe('sent')
  })
  it('finalises recruitment, checklist and holiday ledgers only after provider acceptance', async () => {
    db.rows.recruitment_communications.push({ id: 'communication', delivery_status: 'queued' })
    db.rows.checklist_email_outbox.push({ id: 'checklist', status: 'held' })
    await queue('references', { communication_id: 'communication', checklist_outbox_id: 'checklist', leave_request_id: 'leave', leave_reminder_kind: 'pending' })
    send.mockResolvedValueOnce({ success: false, error: 'Unavailable' })
    await run()
    expect(db.rows.leave_reminder_log).toHaveLength(0)
    expect(db.rows.checklist_email_outbox[0].status).toBe('held')
    expect(db.rows.recruitment_communications[0].delivery_status).toBe('queued')
    expect(await run()).toMatchObject({ success: true })
    expect(db.rows.leave_reminder_log[0]).toMatchObject({ request_id: 'leave', reminder_kind: 'pending', sent_to: ['manager@example.test'] })
    expect(db.rows.checklist_email_outbox[0].status).toBe('sent')
    expect(db.rows.recruitment_communications[0].delivery_status).toBe('sent')
    expect(reportRows()[0].status).toBe('sent')
  })
})
