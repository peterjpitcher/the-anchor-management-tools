import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCutoverPreflight } from '../../scripts/insights/cutover-preflight'

type Row = Record<string, unknown>

const MANAGER = 'manager@example.com'

/**
 * A read-only fake of the Supabase client: select, eq, order, range and maybeSingle only.
 * Any write method throws, so a passing run proves the preflight never writes.
 */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = []
    let range: [number, number] | null = null
    const rows = () => (tables[table] ?? []).filter((row) => filters.every(([field, value]) => row[field] === value))
    const query: Record<string, unknown> = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters.push([field, value]); return query },
      order: () => query,
      range: (start: number, end: number) => { range = [start, end]; return query },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        const matched = rows()
        return Promise.resolve({ data: range ? matched.slice(range[0], range[1] + 1) : matched, error: null }).then(resolve)
      },
    }
    for (const method of ['insert', 'update', 'upsert', 'delete']) {
      query[method] = () => { throw new Error(`preflight attempted ${method} on ${table}`) }
    }
    return query
  }
  return {
    from,
    rpc: () => { throw new Error('preflight attempted an rpc') },
  } as never
}

async function run(tables: Record<string, Row[]>, env: Record<string, string | undefined>, now: Date) {
  const lines: string[] = []
  const result = await runCutoverPreflight({ db: fakeDb(tables), now, env, write: (line) => lines.push(line) })
  return { result, output: lines.join('\n'), lines }
}

describe('scripts/insights/cutover-preflight.ts', () => {
  it('passes when every report is sent, and shows recipient settings without addresses', async () => {
    const { result, output, lines } = await run({
      email_messages: [
        { id: 'r-old', comm_type: 'manager_weekly_report', status: 'sent', format: null, periodKey: '2026-09-11', acceptedAt: '2026-09-11T08:00:00Z', sources: [{ id: 'i-1' }] },
        { id: 'r-old-2', comm_type: 'manager_weekly_report', status: 'sent', format: null, periodKey: '2026-09-18', acceptedAt: '2026-09-18T08:00:00Z', sources: [] },
        { id: 'i-1', comm_type: 'manager_report_item', status: 'sent' },
      ],
      system_settings: [{ key: 'rota_manager_email', value: { value: ` ${MANAGER.toUpperCase()} ` } }],
    }, {
      MANAGER_EMAIL: MANAGER,
      CHECKLIST_MANAGER_EMAIL: MANAGER,
      RECRUITMENT_NOTIFICATION_EMAIL: 'someone-else@example.com',
    }, new Date('2026-09-18T09:00:00Z'))

    expect(result.attention).toEqual([])
    expect(lines.at(-1)).toMatch(/^PASS: /)
    expect(output).toContain('1. Weekly reports (email_messages, comm_type manager_weekly_report): 2')
    expect(output).toContain('    sent: 2')
    expect(output).toContain('    old format (no format field): 2')
    expect(output).toContain('Reports already recorded for the coming Friday (2026-09-25): 0')
    expect(output).toContain('    MANAGER_EMAIL: set, one valid address')
    expect(output).toContain('    CHECKLIST_MANAGER_EMAIL: same as MANAGER_EMAIL')
    expect(output).toContain('    RECRUITMENT_NOTIFICATION_EMAIL: different')
    expect(output).toContain('    PRIVATE_BOOKINGS_MANAGER_EMAIL: unset')
    expect(output).toContain('    ROTA_MANAGER_EMAIL: unset')
    expect(output).toContain('    system setting rota_manager_email: same as MANAGER_EMAIL')
    expect(output).not.toMatch(/@/)
  })

  it('flags an owed frozen report and splits old records into owed and superseded', async () => {
    const { result, output, lines } = await run({
      email_messages: [
        {
          id: 'r-owed', comm_type: 'manager_weekly_report', status: 'queued', format: null, periodKey: '2026-09-18', acceptedAt: null,
          sources: [{ id: 'i-1', checklistOutboxId: 'c-1', communicationId: 'a-1', leaveRequestId: 'l-1', leaveReminderKind: 'waiting' }],
        },
        { id: 'r-accepted', comm_type: 'manager_weekly_report', status: 'queued', format: 'insights', periodKey: '2026-09-25', acceptedAt: '2026-09-25T05:00:00Z', sources: [] },
        { id: 'i-1', comm_type: 'manager_report_item', status: 'queued' },
        { id: 'i-2', comm_type: 'manager_report_item', status: 'queued' },
        { id: 'i-3', comm_type: 'manager_report_item', status: 'sent' },
      ],
      checklist_email_outbox: [
        { id: 'c-1', status: 'held', email_type: 'value_breach', source_type: 'instance' },
        { id: 'c-2', status: 'held', email_type: 'system_alert', source_type: 'closing_night' },
        { id: 'c-3', status: 'sent', email_type: 'system_alert', source_type: 'mismatch' },
      ],
      recruitment_communications: [
        { id: 'a-1', type: 'manager_alert', delivery_status: 'queued' },
        { id: 'a-2', type: 'manager_alert', delivery_status: 'queued' },
        { id: 'a-3', type: 'manager_alert', delivery_status: 'sent' },
        { id: 'e-1', type: 'application_received', delivery_status: 'queued' },
      ],
      leave_requests: [
        { id: 'l-1', status: 'pending' },
        { id: 'l-2', status: 'pending' },
        { id: 'l-3', status: 'pending' },
        { id: 'l-4', status: 'approved' },
      ],
      leave_reminder_log: [{ request_id: 'l-3', reminder_kind: 'waiting' }],
    }, { MANAGER_EMAIL: 'two@example.com, three@example.com' }, new Date('2026-09-21T10:00:00Z'))

    expect(lines.at(-1)).toMatch(/^ATTENTION: /)
    expect(result.attention).toEqual([
      '1 frozen weekly report(s) not yet accepted by the provider',
      'a weekly report is already recorded for 2026-09-25, so no new report would be built that day',
      'MANAGER_EMAIL in .env.local is not one valid address',
    ])
    expect(output).toContain('Frozen and not yet accepted by the provider (still owed; delivery sends it first): 1')
    expect(output).toContain('    ids: r-owed')
    expect(output).toContain('Accepted, sources not yet finalised (delivery finalises without resending): 1')
    expect(output).toContain('    insights: 1')
    expect(output).toContain('2. Old queued report items (email_messages, manager_report_item, queued): 2')
    expect(output).toContain('Superseded by the insights report (left as is, nothing reads them): 1')
    expect(output).toContain('3. Held checklist emails (checklist_email_outbox, held): 2')
    expect(output).toContain('    system_alert / closing_night: 1')
    expect(output).toContain('4. Recruitment manager alerts still queued (recruitment_communications, manager_alert): 2')
    expect(output).toContain('5. Pending leave requests: 3; with no leave_reminder_log row: 2')
    expect(output).toContain('    ids: l-1, l-2')
    expect(output).toContain('Reports already recorded for the coming Friday (2026-09-25): 1')
    expect(output).toContain('    MANAGER_EMAIL: set, but not one valid address (delivery would refuse to send)')
    expect(output).toContain('    system setting rota_manager_email: unset')
    expect(output).not.toMatch(/@/)
  })

  it('treats a Friday before 06:00 London as the coming Friday itself', async () => {
    // 04:30 UTC is 05:30 BST: today's report is not due yet.
    const { output } = await run({}, {}, new Date('2026-09-25T04:30:00Z'))
    expect(output).toContain('Reports already recorded for the coming Friday (2026-09-25): 0')
    expect(output).toContain('    MANAGER_EMAIL: unset (the report falls back to its built-in default address)')
  })

  it('makes no write call in its source', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'scripts/insights/cutover-preflight.ts'), 'utf8')
    for (const call of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(', 'writeFile', 'sendEmail', 'sendSMS']) {
      expect(source).not.toContain(call)
    }
  })
})
