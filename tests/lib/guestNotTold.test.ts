import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-177 (customer bookings review, 24 October 2026): when a staff cancellation reached nobody, the
 * screen said so for a few seconds, with no number and no record that anyone rang. Walk-ins (in the
 * building) are now skipped; anyone else stays listed, with their number, until someone has rung.
 */

const mocks = vi.hoisted(() => ({
  refundTableBookingDeposit: vi.fn(),
  sendCancelled: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/table-bookings/deposit-alerts', () => ({ alertTableDepositNeedsAPerson: vi.fn() }))
vi.mock('@/lib/table-bookings/refunds', () => ({ refundTableBookingDeposit: mocks.refundTableBookingDeposit }))
vi.mock('@/lib/table-bookings/bookings', () => ({ sendTableBookingCancelledSmsIfAllowed: mocks.sendCancelled }))

import { listGuestsNotTold, markGuestToldByPhone, recordGuestNotTold } from '@/lib/table-bookings/guest-not-told'
import { refundAndNotifyOnCancel } from '@/lib/table-bookings/cancel-notify'
import { createRecordingSupabase } from '../mocks/recordingSupabase'

const NOT_REACHED = { status: 'no_channel' as const, channel: null, fallbackUsed: false, error: 'no_channel_available' }

function inserts(db: ReturnType<typeof createRecordingSupabase>) {
  return db.queries
    .filter((query) => query.table === 'audit_logs')
    .flatMap((query) => query.calls.filter((call) => call.method === 'insert').map((call) => call.args[0] as Record<string, unknown>))
}

function bookingSource(source: string) {
  return createRecordingSupabase({ tables: { table_bookings: () => ({ data: { source }, error: null }) } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refundTableBookingDeposit.mockResolvedValue({ refunded: false, reason: 'no_deposit' })
})

describe('recording a guest who was not told', () => {
  it('records a phone or website booking, with ids only', async () => {
    const db = bookingSource('website')

    expect(await recordGuestNotTold(db.client as never, { bookingId: 'b-1', outcome: NOT_REACHED, source: 'foh_cancel' })).toBe('recorded')

    const [row] = inserts(db)
    expect(row).toMatchObject({
      operation_type: 'table_booking.guest_not_told',
      resource_type: 'table_booking',
      resource_id: 'b-1',
      additional_info: { comm_type: 'table_booking_cancelled', outcome: 'no_channel', source: 'foh_cancel' },
    })
    expect(JSON.stringify(row)).not.toMatch(/\+44|@/)
  })

  it('skips a walk-in, who is in the building', async () => {
    const db = bookingSource('walk-in')

    expect(await recordGuestNotTold(db.client as never, { bookingId: 'b-1', outcome: NOT_REACHED, source: 'foh_cancel' })).toBe('walk_in')
    expect(inserts(db)).toEqual([])
  })

  it('records nothing when the guest was reached', async () => {
    const db = bookingSource('website')
    const sent = { status: 'sent' as const, channel: 'email' as const, fallbackUsed: false, error: null }

    expect(await recordGuestNotTold(db.client as never, { bookingId: 'b-1', outcome: sent, source: 'foh_cancel' })).toBe('not_needed')
    expect(db.queries).toEqual([])
  })
})

describe('the staff cancel path', () => {
  it('drops the warning for a walk-in', async () => {
    mocks.sendCancelled.mockResolvedValue(NOT_REACHED)
    const db = bookingSource('walk-in')

    const result = await refundAndNotifyOnCancel(db.client as never, {
      bookingId: 'b-1', bookingReference: 'TB-1', bookingDate: '2026-11-20', customerId: 'c-1', source: 'foh_cancel', staffCancel: true,
    })

    expect(result.notification).toBeNull()
  })

  it('keeps the warning and records it for anyone else', async () => {
    mocks.sendCancelled.mockResolvedValue(NOT_REACHED)
    const db = bookingSource('phone')

    const result = await refundAndNotifyOnCancel(db.client as never, {
      bookingId: 'b-1', bookingReference: 'TB-1', bookingDate: '2026-11-20', customerId: 'c-1', source: 'foh_cancel', staffCancel: true,
    })

    expect(result.notification).toEqual(NOT_REACHED)
    expect(inserts(db)).toHaveLength(1)
  })

  it("leaves the guest's own cancellation alone", async () => {
    mocks.sendCancelled.mockResolvedValue(NOT_REACHED)
    const db = bookingSource('phone')

    await refundAndNotifyOnCancel(db.client as never, {
      bookingId: 'b-1', bookingReference: 'TB-1', bookingDate: '2026-11-20', customerId: 'c-1', source: 'guest_manage_link',
    })

    expect(inserts(db)).toEqual([])
  })
})

describe('the list of guests still to ring', () => {
  function listDb(auditRows: Array<{ resource_id: string; operation_type: string; created_at: string }>) {
    return createRecordingSupabase({
      tables: {
        audit_logs: () => ({ data: auditRows, error: null }),
        table_bookings: (query) => {
          const ids = (query.calls.find((call) => call.method === 'in')?.args[1] ?? []) as string[]
          return {
            data: ids.map((id) => ({
              id,
              booking_reference: `TB-${id}`,
              booking_date: '2026-11-20',
              booking_time: '19:00:00',
              customers: { first_name: 'Sam', last_name: 'Guest', mobile_e164: '+447700900123', mobile_number: '07700 900123' },
            })),
            error: null,
          }
        },
      },
    })
  }

  it('lists a guest not told until someone has rung, with their number', async () => {
    const items = await listGuestsNotTold(
      listDb([
        { resource_id: 'a', operation_type: 'table_booking.guest_not_told', created_at: '2026-10-26T10:00:00Z' },
        { resource_id: 'b', operation_type: 'table_booking.guest_not_told', created_at: '2026-10-26T11:00:00Z' },
        { resource_id: 'b', operation_type: 'table_booking.guest_told_by_phone', created_at: '2026-10-26T11:30:00Z' },
      ]).client as never
    )

    expect(items).toEqual([
      {
        bookingId: 'a',
        bookingReference: 'TB-a',
        bookingDate: '2026-11-20',
        bookingTime: '19:00:00',
        guestName: 'Sam Guest',
        phone: '07700 900123',
        since: '2026-10-26T10:00:00Z',
      },
    ])
  })

  it('lists a booking again when it is cancelled again after a call', async () => {
    const items = await listGuestsNotTold(
      listDb([
        { resource_id: 'a', operation_type: 'table_booking.guest_not_told', created_at: '2026-10-26T10:00:00Z' },
        { resource_id: 'a', operation_type: 'table_booking.guest_told_by_phone', created_at: '2026-10-26T10:30:00Z' },
        { resource_id: 'a', operation_type: 'table_booking.guest_not_told', created_at: '2026-10-26T12:00:00Z' },
      ]).client as never
    )

    expect(items.map((item) => item.bookingId)).toEqual(['a'])
  })

  it('records who rang, and says so when it could not be saved', async () => {
    const ok = createRecordingSupabase({ tables: { audit_logs: () => ({ data: null, error: null }) } })
    await markGuestToldByPhone(ok.client as never, { bookingId: 'a', userId: 'user-1' })
    expect(inserts(ok)[0]).toMatchObject({ user_id: 'user-1', operation_type: 'table_booking.guest_told_by_phone', resource_id: 'a' })

    const failing = createRecordingSupabase({ tables: { audit_logs: () => ({ data: null, error: { message: 'boom' } }) } })
    await expect(markGuestToldByPhone(failing.client as never, { bookingId: 'a', userId: 'user-1' })).rejects.toThrow('boom')
  })
})
