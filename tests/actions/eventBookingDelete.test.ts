import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * deleteExpiredEventBooking (owner request, 18 November 2026): a lapsed payment hold can be
 * deleted from an event's attendee list by hand, but never one with money or history behind it.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
const audit = vi.hoisted(() => ({ logAuditEvent: vi.fn() }))
vi.mock('@/app/actions/audit', () => audit)
const rbac = vi.hoisted(() => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/rbac', () => rbac)
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'manager-1', email: 'manager@example.com' } }, error: null }) },
  }),
}))
const admin = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => admin)
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { deleteExpiredEventBooking } from '@/app/actions/event-booking-delete'

const BOOKING_ID = '275ac4a2-a8c5-49fd-b9ef-6b94033f4acf'

type Filter = [string, string, unknown]
type Call = { table: string; op: 'select' | 'delete'; filters: Filter[] }

type Rows = {
  booking?: Record<string, unknown> | null
  payments?: Array<{ id: string; status: string }>
  refundRequests?: unknown[]
  transfers?: unknown[]
  checkIns?: unknown[]
  exceptions?: unknown[]
  deleted?: unknown[]
}

function fakeDb(rows: Rows) {
  const calls: Call[] = []
  const answer = (call: Call): { data: unknown; error: null } => {
    switch (call.table) {
      case 'bookings':
        if (call.op === 'delete') return { data: rows.deleted ?? [{ id: BOOKING_ID }], error: null }
        return { data: rows.booking === undefined ? expiredBooking() : rows.booking, error: null }
      case 'payments':
        return { data: rows.payments ?? [], error: null }
      case 'event_booking_refund_requests':
        return { data: rows.refundRequests ?? [], error: null }
      case 'event_ticket_transfers':
        return { data: rows.transfers ?? [], error: null }
      case 'event_check_ins':
        return { data: rows.checkIns ?? [], error: null }
      case 'event_payment_exceptions':
        return { data: rows.exceptions ?? [], error: null }
      default:
        throw new Error(`unexpected table ${call.table}`)
    }
  }
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] }
    calls.push(call)
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.delete = () => {
      call.op = 'delete'
      return builder
    }
    builder.eq = (column: string, value: unknown) => {
      call.filters.push(['eq', column, value])
      return builder
    }
    builder.or = (expr: string) => {
      call.filters.push(['or', expr, null])
      return builder
    }
    builder.limit = () => builder
    builder.maybeSingle = async () => answer(call)
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(answer(call)).then(resolve, reject)
    return builder
  }
  return { client: { from }, calls }
}

function expiredBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    event_id: 'event-1',
    customer_id: 'customer-1',
    seats: 8,
    status: 'expired',
    source: 'website',
    created_at: '2026-11-16T10:00:00Z',
    expired_at: '2026-11-17T10:00:00Z',
    ...overrides,
  }
}

function deleteCall(calls: Call[]): Call | undefined {
  return calls.find((call) => call.table === 'bookings' && call.op === 'delete')
}

describe('deleteExpiredEventBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rbac.checkUserPermission.mockResolvedValue(true)
  })

  it('deletes an expired booking with only failed payment attempts, and audits it first', async () => {
    const db = fakeDb({ payments: [{ id: 'p1', status: 'failed' }, { id: 'p2', status: 'void' }] })
    admin.createAdminClient.mockReturnValue(db.client)

    const result = await deleteExpiredEventBooking({ bookingId: BOOKING_ID })

    expect(result).toEqual({ success: true, data: { booking_id: BOOKING_ID, event_id: 'event-1' } })
    const del = deleteCall(db.calls)
    expect(del?.filters).toEqual([
      ['eq', 'id', BOOKING_ID],
      ['eq', 'status', 'expired'],
    ])
    expect(audit.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'delete',
        resource_type: 'event_booking',
        resource_id: BOOKING_ID,
        additional_info: expect.objectContaining({
          event_id: 'event-1',
          customer_id: 'customer-1',
          seats: 8,
          failed_payment_rows_deleted: 2,
        }),
      }),
    )
  })

  it('refuses without the events manage permission', async () => {
    rbac.checkUserPermission.mockResolvedValue(false)
    const db = fakeDb({})
    admin.createAdminClient.mockReturnValue(db.client)

    const result = await deleteExpiredEventBooking({ bookingId: BOOKING_ID })

    expect(result).toEqual({ error: 'You do not have permission to delete event bookings.' })
    expect(db.calls).toHaveLength(0)
  })

  it.each(['confirmed', 'pending_payment', 'cancelled'])('refuses a %s booking', async (status) => {
    const db = fakeDb({ booking: expiredBooking({ status }) })
    admin.createAdminClient.mockReturnValue(db.client)

    const result = await deleteExpiredEventBooking({ bookingId: BOOKING_ID })

    expect(result).toEqual({ error: 'Only a booking whose payment hold ran out (Expired) can be deleted.' })
    expect(deleteCall(db.calls)).toBeUndefined()
  })

  it.each([
    ['a succeeded payment', { payments: [{ id: 'p1', status: 'succeeded' }] }, 'payment against it'],
    ['a pending payment', { payments: [{ id: 'p1', status: 'pending' }] }, 'payment against it'],
    ['a refund request', { refundRequests: [{ id: 'r1' }] }, 'refund request'],
    ['a ticket transfer', { transfers: [{ id: 't1' }] }, 'ticket transfer'],
    ['a check-in', { checkIns: [{ id: 'c1' }] }, 'checked in'],
    ['a payment exception', { exceptions: [{ id: 'e1' }] }, 'payment issue'],
  ] as Array<[string, Rows, string]>)('refuses an expired booking with %s', async (_label, rows, message) => {
    const db = fakeDb(rows)
    admin.createAdminClient.mockReturnValue(db.client)

    const result = await deleteExpiredEventBooking({ bookingId: BOOKING_ID })

    expect('error' in result && result.error).toContain(message)
    expect(deleteCall(db.calls)).toBeUndefined()
    expect(audit.logAuditEvent).not.toHaveBeenCalled()
  })

  it('reports a booking that changed between reading and deleting', async () => {
    const db = fakeDb({ deleted: [] })
    admin.createAdminClient.mockReturnValue(db.client)

    const result = await deleteExpiredEventBooking({ bookingId: BOOKING_ID })

    expect(result).toEqual({ error: 'This booking changed while you were looking at it. Refresh the page.' })
  })

  it('reports a booking that no longer exists', async () => {
    const db = fakeDb({ booking: null })
    admin.createAdminClient.mockReturnValue(db.client)

    const result = await deleteExpiredEventBooking({ bookingId: BOOKING_ID })

    expect(result).toEqual({ error: 'Booking not found. Refresh the page.' })
  })

  it('rejects an id that is not a uuid', async () => {
    const result = await deleteExpiredEventBooking({ bookingId: 'not-a-uuid' })
    expect(result).toEqual({ error: 'Invalid booking id.' })
  })
})
