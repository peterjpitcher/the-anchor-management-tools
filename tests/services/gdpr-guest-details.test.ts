import { describe, it, expect, vi, beforeEach } from 'vitest'

/*
 * BK-081 and BK-017, customer bookings review of 24 October 2026.
 *
 * Each ticket on a paid event carries the guest's name and their answers to the event's
 * questions (the 20 November tasting night asks about allergies). An erasure cleared the
 * booking's names and notes but left those answers, the ticket lines' copy of the names and the
 * audit log's copy of the guest's phone and email. And a guest's own request for their data could
 * not be answered: the export only ever covered the signed-in staff member.
 */

type Row = Record<string, unknown>
type Filter = ['in' | 'eq', string, unknown] | ['or', string]
type Write = { table: string; op: 'update' | 'delete'; values?: Row; filters: Filter[] }

const state = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => state.client,
}))

import { GdprService } from '@/services/gdpr'

const CUSTOMER = '11111111-1111-4111-8111-111111111111'
const OTHER_CUSTOMER = '22222222-2222-4222-8222-222222222222'
const BOOKING = '33333333-3333-4333-8333-333333333333'
const OTHER_BOOKING = '44444444-4444-4444-8444-444444444444'
const QUESTION = '55555555-5555-4555-8555-555555555555'

const GUESTS = [
  {
    id: '66666666-6666-4666-8666-666666666661',
    name: 'Jo Guest',
    ticket_type_id: null,
    answers: [{ question_id: QUESTION, label: 'Any allergies?', type: 'text', required: true, value: 'Peanuts' }],
  },
  {
    id: '66666666-6666-4666-8666-666666666662',
    name: 'Sam Friend',
    ticket_type_id: null,
    answers: [{ question_id: QUESTION, label: 'Any allergies?', type: 'text', required: true, value: 'None' }],
  },
]

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter[0] === 'in') return (filter[2] as unknown[]).includes(row[filter[1]])
    if (filter[0] === 'eq') return row[filter[1]] === filter[2]
    return filter[1].split(',').some((clause) => {
      const [column, operator, ...rest] = clause.split('.')
      const value = rest.join('.')
      if (operator === 'eq') return String(row[column] ?? '') === value
      if (operator === 'ilike') return String(row[column] ?? '').toLowerCase().includes(value.replace(/%/g, '').toLowerCase())
      return false
    })
  })
}

function createFakeClient(data: Record<string, Row[]>) {
  const writes: Write[] = []
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

  const client = {
    writes,
    rpcCalls,
    from(table: string) {
      const filters: Filter[] = []
      let write: Write | null = null
      const rows = () => (data[table] ?? []).filter((row) => matches(row, filters))
      const builder = {
        select: () => builder,
        update: (values: Row) => {
          write = { table, op: 'update', values, filters }
          writes.push(write)
          return builder
        },
        delete: () => {
          write = { table, op: 'delete', filters }
          writes.push(write)
          return builder
        },
        in: (column: string, values: unknown[]) => { filters.push(['in', column, values]); return builder },
        eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return builder },
        or: (clauses: string) => { filters.push(['or', clauses]); return builder },
        not: () => builder,
        overlaps: () => builder,
        order: () => builder,
        lt: () => builder,
        neq: () => builder,
        range: (from: number, to: number) => Promise.resolve({ data: rows().slice(from, to + 1), error: null }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(
            write ? { data: null, error: null, count: rows().length } : { data: rows(), error: null },
          ).then(onFulfilled, onRejected),
      }
      return builder
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: fn === 'gdpr_scrub_audit_logs_v01' ? 2 : null, error: null })
    },
    storage: { from: () => ({ remove: () => Promise.resolve({ error: null }) }) },
  }
  return client
}

function seed(): Record<string, Row[]> {
  return {
    customers: [
      { id: CUSTOMER, first_name: 'Jo', last_name: 'Guest', email: 'jo@example.com', mobile_e164: '+447700900123', mobile_number: '+447700900123', mobile_number_raw: null },
      { id: OTHER_CUSTOMER, first_name: 'Ali', last_name: 'Other', email: null, mobile_e164: '+447700900999', mobile_number: '+447700900999', mobile_number_raw: null },
    ],
    bookings: [
      { id: BOOKING, customer_id: CUSTOMER, seats: 2, attendees: GUESTS, attendee_names: ['Jo Guest', 'Sam Friend'], notes: 'Window seat' },
      { id: OTHER_BOOKING, customer_id: OTHER_CUSTOMER, seats: 1, attendees: [], attendee_names: null, notes: null },
    ],
    booking_items: [
      { id: 'item-1', booking_id: BOOKING, attendee_names: ['Jo Guest', 'Sam Friend'], quantity: 2, unit_price: 40 },
      { id: 'item-2', booking_id: OTHER_BOOKING, attendee_names: ['Ali Other'], quantity: 1, unit_price: 40 },
    ],
    audit_logs: [
      { id: 'audit-1', resource_type: 'customer', resource_id: CUSTOMER, created_at: '2026-10-01T10:00:00Z' },
      { id: 'audit-2', resource_type: 'event_booking', resource_id: BOOKING, created_at: '2026-10-02T10:00:00Z' },
      { id: 'audit-3', resource_type: 'customer', resource_id: OTHER_CUSTOMER, created_at: '2026-10-03T10:00:00Z' },
    ],
  }
}

function writesTo(client: ReturnType<typeof createFakeClient>, table: string) {
  return client.writes.filter((write) => write.table === table && write.op === 'update')
}

describe('GDPR erasure of event guest details', () => {
  beforeEach(() => {
    state.client = null
  })

  it('clears every ticket\'s guest names and answers on the erased guest\'s bookings', async () => {
    const client = createFakeClient(seed())
    state.client = client
    const subject = await GdprService.resolveErasureSubject(CUSTOMER)
    expect(subject?.customerIds).toEqual([CUSTOMER])

    await GdprService.deleteUserData(subject!)

    const bookingWrites = writesTo(client, 'bookings')
    expect(bookingWrites).toHaveLength(1)
    expect(bookingWrites[0].values).toMatchObject({ attendees: [], attendee_names: null, notes: null })
    expect(bookingWrites[0].filters).toEqual([['in', 'id', [BOOKING]]])
  })

  it('clears the ticket lines\' copy of the guest names', async () => {
    const client = createFakeClient(seed())
    state.client = client
    await GdprService.deleteUserData((await GdprService.resolveErasureSubject(CUSTOMER))!)

    const itemWrites = writesTo(client, 'booking_items')
    expect(itemWrites).toHaveLength(1)
    expect(itemWrites[0].values).toEqual({ attendee_names: [] })
    expect(itemWrites[0].filters).toEqual([['in', 'booking_id', [BOOKING]]])
  })

  it('asks the database to take the guest\'s details out of the audit log, by id only', async () => {
    const client = createFakeClient(seed())
    state.client = client
    const result = await GdprService.deleteUserData((await GdprService.resolveErasureSubject(CUSTOMER))!)

    expect(client.rpcCalls).toEqual([
      { fn: 'gdpr_scrub_audit_logs_v01', args: { p_customer_ids: [CUSTOMER], p_booking_ids: [BOOKING] } },
    ])
    expect(result.counts.auditLogs).toBe(2)
    expect(result.message).toContain('audit log rows: 2')
  })

  it('says so when the audit log could not be cleared, rather than reporting a clean erasure', async () => {
    const client = createFakeClient(seed())
    client.rpc = (fn: string, args: Record<string, unknown>) => {
      client.rpcCalls.push({ fn, args })
      return Promise.resolve({ data: null, error: { message: 'function gdpr_scrub_audit_logs_v01 does not exist' } }) as never
    }
    state.client = client
    const result = await GdprService.deleteUserData((await GdprService.resolveErasureSubject(CUSTOMER))!)

    expect(result.auditScrubFailed).toBe(true)
    expect(result.message).toContain('The audit log could not be cleared')
    expect(result.message).toContain(CUSTOMER)
  })
})

describe('GDPR export for a guest\'s data request', () => {
  beforeEach(() => {
    state.client = null
  })

  it('finds the guest by phone and exports their bookings with each ticket\'s names and answers', async () => {
    const client = createFakeClient(seed())
    state.client = client
    const subject = await GdprService.resolveErasureSubject('07700 900123')
    expect(subject?.customerIds).toEqual([CUSTOMER])

    const result = await GdprService.exportSubjectData(subject!, 'manager-id')
    const parsed = JSON.parse(result.data) as Record<string, Row[]>

    expect(parsed.customers.map((row) => row.id)).toEqual([CUSTOMER])
    expect(parsed.eventBookings.map((row) => row.id)).toEqual([BOOKING])
    expect(parsed.eventBookings[0].attendees).toEqual(GUESTS)
    expect(parsed.eventBookingItems.map((row) => row.id)).toEqual(['item-1'])
    expect(parsed.auditLogs.map((row) => row.id).sort()).toEqual(['audit-1', 'audit-2'])
    expect(result.requestedBy).toBe('manager-id')
    expect(result.fileName).toMatch(new RegExp(`^gdpr-export-${CUSTOMER}-\\d{4}-\\d{2}-\\d{2}\\.json$`))
  })

  it('covers the same tables an erasure clears', async () => {
    const client = createFakeClient(seed())
    state.client = client
    const result = await GdprService.exportSubjectData((await GdprService.resolveErasureSubject(CUSTOMER))!)
    const parsed = JSON.parse(result.data) as Record<string, unknown>

    expect(Object.keys(parsed)).toEqual(expect.arrayContaining([
      'customers', 'customerConsents', 'eventBookings', 'eventBookingItems', 'bookingReminders',
      'tableBookings', 'tableBookingItems', 'preorderCovers', 'privateBookings', 'privateBookingSms',
      'parkingBookings', 'pendingBookings', 'smsPromoContext', 'reviewFeedback', 'messages',
      'emailMessages', 'unmatchedCommunications', 'webhookLogs', 'auditLogs',
    ]))
    // It reads, and never writes.
    expect(client.writes).toEqual([])
    expect(client.rpcCalls).toEqual([])
  })
})
