import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverManagerReport } from '@/lib/manager-report/delivery'
import { managerReportId } from '@/lib/manager-report/ids'
import { managerReportPeriod } from '@/lib/manager-report/schedule'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { EmailOptions } from '@/lib/email/emailService'
import type { InsightsReport, SectionKey } from '@/lib/insights/types'
import { buildFixtureReport } from '../insights/helpers/report-fixture'

const mocks = vi.hoisted(() => ({ admin: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn(() => { throw new Error('No real transport allowed') }) }))
vi.mock('@/lib/insights/registry', () => ({ buildWeeklyInsights: vi.fn(() => { throw new Error('No live report build allowed') }) }))

type Row = Record<string, unknown>
interface Failure { table: string; operation: string; matches?: (payload: Row) => boolean }

function readPath(row: Row, key: string): unknown {
  if (!key.includes('->>')) return row[key]
  const [column, field] = key.split('->>')
  const value = row[column]
  return value && typeof value === 'object' ? (value as Row)[field] : undefined
}

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
  eq(key: string, value: unknown): this { this.filters.push(row => readPath(row, key) === value); return this }
  gt(key: string, value: string): this { this.filters.push(row => String(row[key]) > value); return this }
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
          const row = { id: `generated-${rows.length}`, created_at: '2026-09-25T05:00:00.000Z', ...structuredClone(this.payload) }
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
let buildReport: ReturnType<typeof vi.fn<(now: Date, appUrl: string) => Promise<InsightsReport>>>
function run() { return deliverManagerReport({ db: db.asDb(), send, now: () => date, buildReport }) }
const reportRows = () => db.rows.email_messages.filter(row => row.comm_type === 'manager_weekly_report')

function legacyReport(periodKey: string, overrides: Row = {}, metadata: Row = {}): Row {
  const id = managerReportId(['manager_weekly_report', periodKey, 'manager@example.test'])
  const row = {
    id, to_address: 'manager@example.test', comm_type: 'manager_weekly_report', status: 'queued',
    subject: 'Old format', body_html: '<p>old</p>', body_text: 'old', created_at: `${periodKey}T08:00:00.000Z`,
    metadata: {
      periodKey,
      sources: [{ id: 'item-1', checklistOutboxId: 'checklist', communicationId: 'communication', leaveRequestId: 'leave', leaveReminderKind: 'waiting' }],
      payload: { to: 'manager@example.test', from: 'reports@example.test', subject: 'Old format', html: '<p>old</p>', provider: 'resend', idempotencyKey: `manager-weekly-report/${id}` },
      ...metadata,
    },
    ...overrides,
  }
  db.rows.email_messages.push(row)
  db.rows.email_messages.push({ id: 'item-1', comm_type: 'manager_report_item', status: 'queued', metadata: { section: 'table_bookings', key: 'b1' } })
  db.rows.checklist_email_outbox.push({ id: 'checklist', status: 'held' })
  db.rows.recruitment_communications.push({ id: 'communication', delivery_status: 'queued' })
  return row
}

beforeEach(() => {
  db = new MemoryDb()
  date = new Date('2026-09-25T05:00:00Z') // Friday 06:00 BST
  send = vi.fn(async () => ({ success: true, messageId: 'provider-1' }))
  buildReport = vi.fn(async (now: Date) => buildFixtureReport({ now }))
  mocks.admin.mockReturnValue(db.asDb())
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://management.example.test')
  vi.stubEnv('EMAIL_FROM_ADDRESS', 'reports@example.test')
  vi.stubEnv('MANAGER_EMAIL', 'Manager@Example.test')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('Friday 06:00 local schedule', () => {
  it.each([
    ['2026-09-25T04:59:59Z', false], ['2026-09-25T05:00:00Z', true],
    ['2026-01-02T05:59:59Z', false], ['2026-01-02T06:00:00Z', true],
    ['2026-09-25T22:00:00Z', true], ['2026-09-25T23:00:00Z', false],
    ['2026-09-26T06:00:00Z', false],
  ])('%s has eligibility %s', (value, expected) => expect(Boolean(managerReportPeriod(new Date(value)))).toBe(expected))

  it('keeps 06:00 London across the March clock change', () => {
    expect(managerReportPeriod(new Date('2026-04-03T05:00:00Z'))).toMatchObject({
      key: '2026-04-03', periodStart: '2026-03-27T06:00:00.000Z', periodEnd: '2026-04-03T05:00:00.000Z',
    })
  })
})

describe('weekly insights delivery', () => {
  it('skips outside Friday, then builds, freezes and sends one report', async () => {
    date = new Date('2026-09-26T05:00:00Z')
    expect(await run()).toMatchObject({ success: true, skipped: 'outside_friday_window' })
    expect(db.calls).toHaveLength(0)
    date = new Date('2026-09-25T05:00:00Z')
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0][0]
    expect(payload).toMatchObject({
      to: 'manager@example.test', from: 'reports@example.test', provider: 'resend', suppressionMode: 'fail_closed',
      idempotencyKey: `manager-weekly-report/${managerReportId(['insights_weekly_report', '2026-09-25', 'manager@example.test'])}`,
    })
    expect(payload.subject).toMatch(/^The Anchor weekly report, Fri 25 Sep: /)
    expect(payload.html).toContain('<ul')
    expect(payload.attachments).toBeUndefined()
    expect(buildReport).toHaveBeenCalledWith(date, 'https://management.example.test')
    expect(reportRows()).toHaveLength(1)
    expect(reportRows()[0]).toMatchObject({ status: 'sent', metadata: { periodKey: '2026-09-25', format: 'insights', sources: [] } })

    date = new Date('2026-09-25T06:00:00Z')
    expect(await run()).toMatchObject({ success: true, sent: 0, skipped: 'already_reported' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(buildReport).toHaveBeenCalledTimes(1)
  })

  it('holds the report back while a section is not checked, then sends it from 09:00 naming the sections', async () => {
    buildReport.mockImplementation(async (now: Date) => buildFixtureReport({ now, notChecked: ['cashing_up' as SectionKey] }))
    expect(await run()).toMatchObject({ success: true, sent: 0, skipped: 'waiting_for_sections', notCheckedSections: ['cashing_up'] })
    expect(reportRows()).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()

    date = new Date('2026-09-25T07:00:00Z') // 08:00 BST, still waiting
    expect(await run()).toMatchObject({ skipped: 'waiting_for_sections' })

    date = new Date('2026-09-25T08:00:00Z') // 09:00 BST
    expect(await run()).toMatchObject({ success: true, sent: 1, notCheckedSections: ['cashing_up'] })
    expect(send.mock.calls[0][0].html).toContain('⚪ Not checked: Cashing up')
  })

  it('uses a report built at a later hour once every section can be read', async () => {
    buildReport.mockImplementationOnce(async (now: Date) => buildFixtureReport({ now, notChecked: ['events' as SectionKey] }))
    expect(await run()).toMatchObject({ skipped: 'waiting_for_sections' })
    date = new Date('2026-09-25T06:00:00Z')
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(send.mock.calls[0][0].html).not.toContain('Not checked: Hosted events')
  })

  it('finishes an old-format frozen report for this Friday first and builds nothing new', async () => {
    const legacy = legacyReport('2026-09-25')
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toEqual((legacy.metadata as Row).payload)
    expect(buildReport).not.toHaveBeenCalled()
    expect(db.rows.checklist_email_outbox[0].status).toBe('sent')
    expect(db.rows.recruitment_communications[0].delivery_status).toBe('sent')
    expect(db.rows.leave_reminder_log[0]).toMatchObject({ request_id: 'leave', reminder_kind: 'waiting' })
    expect(db.rows.email_messages.find(row => row.id === 'item-1')?.status).toBe('sent')
  })

  it('finishes last week\'s old-format report, then sends this week\'s insights report', async () => {
    legacyReport('2026-09-18')
    expect(await run()).toMatchObject({ success: true, sent: 2 })
    expect(send.mock.calls.map(call => call[0].subject)).toEqual(['Old format', expect.stringMatching(/^The Anchor weekly report/)])
  })

  it('finalises an accepted old-format report without sending it again', async () => {
    legacyReport('2026-09-18', {}, { acceptedAt: '2026-09-18T08:00:05.000Z', providerMessageId: 'old-provider', firstAttemptAt: '2026-09-18T08:00:00.000Z' })
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].subject).toMatch(/^The Anchor weekly report/)
    expect(db.rows.checklist_email_outbox[0].status).toBe('sent')
  })

  it('treats an old-format report already sent today as this Friday\'s report', async () => {
    legacyReport('2026-09-25', { status: 'sent' })
    expect(await run()).toMatchObject({ success: true, sent: 0, skipped: 'already_reported' })
    expect(buildReport).not.toHaveBeenCalled()
  })

  it('ignores queued items from the old queue and leaves them as they are', async () => {
    db.rows.email_messages.push({ id: 'orphan', comm_type: 'manager_report_item', status: 'queued', metadata: { section: 'rota', key: 'x' } })
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(db.rows.email_messages.find(row => row.id === 'orphan')?.status).toBe('queued')
  })

  it('retries a provider failure with the identical frozen payload and never rebuilds it', async () => {
    send.mockResolvedValueOnce({ success: false, error: 'Provider unavailable' })
    expect(await run()).toMatchObject({ success: false, error: 'Provider unavailable' })
    const firstPayload = structuredClone(send.mock.calls[0][0])
    expect(reportRows()[0].status).toBe('queued')
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'changed@example.test')
    date = new Date('2026-09-25T06:00:00Z')
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(send.mock.calls[1][0]).toEqual(firstPayload)
    expect(buildReport).toHaveBeenCalledTimes(1)
  })

  it('blocks a new week while an earlier send is outside the provider deduplication window', async () => {
    send.mockResolvedValueOnce({ success: false, error: 'Network timeout' })
    await run()
    date = new Date('2026-10-02T05:00:00Z')
    expect(await run()).toMatchObject({ success: false, error: expect.stringContaining('needs provider reconciliation') })
    expect(send).toHaveBeenCalledTimes(1)
    expect(buildReport).toHaveBeenCalledTimes(1)
  })

  it('treats a provider id as acceptance even when the transport log reports failure', async () => {
    send.mockResolvedValueOnce({ success: false, messageId: 'accepted', error: 'Logging failed' })
    expect(await run()).toMatchObject({ success: true, sent: 1 })
    expect(reportRows()[0].status).toBe('sent')
  })

  it('does not send when the frozen payload could not be saved', async () => {
    db.failures.push({ table: 'email_messages', operation: 'insert' })
    expect(await run()).toMatchObject({ success: false })
    expect(send).not.toHaveBeenCalled()
    expect(db.rows.cron_job_runs[0]).toMatchObject({ status: 'failed', error_message: 'Injected database failure' })
    expect(await run()).toMatchObject({ success: true, sent: 1 })
  })

  it('fails without sending when the report build fails or the recipient is invalid', async () => {
    buildReport.mockRejectedValueOnce(new Error('Insights need a valid app URL'))
    expect(await run()).toMatchObject({ success: false, error: 'Insights need a valid app URL' })
    vi.stubEnv('MANAGER_EMAIL', 'one@example.test, two@example.test')
    expect(await run()).toMatchObject({ success: false, error: 'Manager report recipient is invalid' })
    expect(send).not.toHaveBeenCalled()
    expect(reportRows()).toHaveLength(0)
  })

  it('excludes simultaneous attempts using the unique lease and a stale takeover', async () => {
    db.rows.cron_job_runs.push({ id: 'old-lock', job_name: 'manager-weekly-report', run_key: 'delivery', status: 'running', started_at: '2026-09-25T04:00:00Z' })
    const results = await Promise.all([run(), run()])
    expect(results.some(result => result.skipped === 'already_running')).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
