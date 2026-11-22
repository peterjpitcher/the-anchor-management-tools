import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fakeSupabase'

/**
 * The end-of-day no-show sweep (owner decision, 22 November 2026): which bookings it takes and
 * which it leaves, that a night running past midnight is not swept until it closes, that an
 * unreadable set of hours sweeps nothing, and that a second run changes nothing. Run against the
 * in-memory fake database with the real plan builder and trading-day rule.
 *
 * Every instant is written in UTC so the file reads the same in both test zones.
 */

const { logError, auditOrThrow } = vi.hoisted(() => ({
  logError: vi.fn(),
  auditOrThrow: vi.fn(async (_params: Record<string, unknown>) => undefined),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEventOrThrow: auditOrThrow, logAuditEvent: vi.fn() } }))

import { tradingDayInForce } from '@/lib/business-hours/trading-day'
import type { TradingHours } from '@/lib/business-hours/open-now'
import { runNoShowSweep } from '@/lib/table-bookings/no-show-sweep'

const TO_10PM: TradingHours = { opens: '12:00', closes: '22:00' }
const TO_1AM: TradingHours = { opens: '12:00', closes: '01:00' }

function booking(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    booking_reference: `TB-${id}`,
    customer_id: 'customer-1',
    status: 'confirmed',
    booking_date: '2026-11-21',
    booking_time: '19:00:00',
    start_datetime: '2026-11-21T19:00:00.000Z',
    end_datetime: '2026-11-21T21:00:00.000Z',
    seated_at: null,
    left_at: null,
    no_show_at: null,
    no_show_marked_at: null,
    no_show_marked_by: null,
    event_booking_id: null,
    payment_status: null,
    deposit_waived: false,
    party_size: 4,
    committed_party_size: 4,
    paypal_deposit_capture_id: null,
    booking_type: 'regular',
    ...overrides,
  }
}

function sweep(
  db: FakeSupabase,
  nowIso: string,
  hours: { yesterday: TradingHours; today: TradingHours } = { yesterday: TO_10PM, today: TO_10PM }
) {
  const now = new Date(nowIso)
  return runNoShowSweep({ db: db as never, now, tradingDay: async () => tradingDayInForce(now, hours) })
}

const row = (db: FakeSupabase, id: string) => db.tables.table_bookings.find((candidate) => candidate.id === id)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('end-of-day no-show sweep', () => {
  // 00:05 London on Sunday 22 November 2026 (GMT): Saturday 21 November has ended.
  const JUST_AFTER_MIDNIGHT = '2026-11-22T00:05:00Z'

  it("marks yesterday's confirmed bookings with no outcome, as nobody, and audits each one", async () => {
    const db = createFakeSupabase({
      table_bookings: [
        booking('open'),
        booking('open-2', { booking_time: '20:00:00', start_datetime: '2026-11-21T20:00:00.000Z' }),
      ],
    })

    const result = await sweep(db, JUST_AFTER_MIDNIGHT)

    expect(result).toMatchObject({ state: 'ran', tradingDay: '2026-11-22', considered: 2, marked: 2, errors: 0 })
    expect(row(db, 'open')).toMatchObject({
      status: 'no_show',
      no_show_at: '2026-11-22T00:05:00.000Z',
      no_show_marked_at: '2026-11-22T00:05:00.000Z',
      no_show_marked_by: null,
    })
    expect(auditOrThrow).toHaveBeenCalledTimes(2)
    const auditRow = auditOrThrow.mock.calls[0][0]
    expect(auditRow).toMatchObject({
      operation_type: 'table_booking.no_show',
      resource_type: 'table_booking',
      resource_id: 'open',
      additional_info: { source: 'end_of_day_sweep', automatic: true, booking_date: '2026-11-21' },
    })
    // Nobody pressed anything, and the nil system id is refused by the audit log.
    expect(auditRow.user_id).toBeUndefined()
  })

  it('leaves everything that has an outcome, is not confirmed, is for an event, or is for today', async () => {
    const db = createFakeSupabase({
      table_bookings: [
        booking('seated', { seated_at: '2026-11-21T19:05:00.000Z' }),
        booking('left', { left_at: '2026-11-21T21:00:00.000Z' }),
        booking('already', { status: 'no_show', no_show_at: '2026-11-21T20:00:00.000Z', no_show_marked_by: 'staff-1' }),
        booking('cancelled', { status: 'cancelled' }),
        booking('completed', { status: 'completed' }),
        booking('awaiting-payment', {
          status: 'pending_payment',
          payment_status: 'pending',
          party_size: 16,
          committed_party_size: 16,
        }),
        booking('card-capture', { status: 'pending_card_capture' }),
        booking('event-table', { event_booking_id: 'event-booking-1' }),
        booking('today', { booking_date: '2026-11-22', start_datetime: '2026-11-22T19:00:00.000Z' }),
        booking('too-old', { booking_date: '2026-11-14', start_datetime: '2026-11-14T19:00:00.000Z' }),
      ],
    })
    const before = JSON.stringify(db.tables.table_bookings)

    const result = await sweep(db, JUST_AFTER_MIDNIGHT)

    expect(result).toMatchObject({ state: 'ran', considered: 0, marked: 0 })
    expect(JSON.stringify(db.tables.table_bookings)).toBe(before)
    expect(auditOrThrow).not.toHaveBeenCalled()
  })

  it('moves no money: a paid deposit stays exactly as it was', async () => {
    const db = createFakeSupabase({
      table_bookings: [
        booking('paid-deposit', {
          party_size: 16,
          committed_party_size: 16,
          payment_status: 'completed',
          paypal_deposit_capture_id: 'CAP-1',
        }),
        // Confirmed but still owing a deposit: the deposit timeout only reads pending_payment,
        // so nothing else would ever clear this one from the strip.
        booking('confirmed-owing', { party_size: 16, committed_party_size: 16, payment_status: 'pending' }),
      ],
    })

    const result = await sweep(db, JUST_AFTER_MIDNIGHT)

    expect(result).toMatchObject({ considered: 2, marked: 2 })
    // No refund, no charge. Only the status and the marks change.
    expect(row(db, 'paid-deposit')).toMatchObject({
      status: 'no_show',
      payment_status: 'completed',
      paypal_deposit_capture_id: 'CAP-1',
    })
    expect(row(db, 'confirmed-owing')).toMatchObject({ status: 'no_show', payment_status: 'pending' })
  })

  it('catches up the last seven days after a missed run, the same window as the strip', async () => {
    const db = createFakeSupabase({
      table_bookings: [
        booking('seven-days', { booking_date: '2026-11-15', start_datetime: '2026-11-15T19:00:00.000Z' }),
        booking('eight-days', { booking_date: '2026-11-14', start_datetime: '2026-11-14T19:00:00.000Z' }),
      ],
    })

    await sweep(db, JUST_AFTER_MIDNIGHT)

    expect(row(db, 'seven-days')?.status).toBe('no_show')
    expect(row(db, 'eight-days')?.status).toBe('confirmed')
  })

  it('does not sweep a night that runs past midnight until it has closed', async () => {
    // New Year's Eve, open to 1am. A table at 00:15 belongs to 31 December and starts on 1 January.
    const seed = () =>
      createFakeSupabase({
        table_bookings: [
          booking('nye-evening', { booking_date: '2026-12-31', start_datetime: '2026-12-31T19:00:00.000Z' }),
          booking('nye-after-midnight', {
            booking_date: '2026-12-31',
            booking_time: '00:15:00',
            start_datetime: '2027-01-01T00:15:00.000Z',
          }),
        ],
      })
    const hours = { yesterday: TO_1AM, today: { opens: null, closes: null, is_closed: true } as TradingHours }

    const stillOpen = seed()
    const during = await sweep(stillOpen, '2027-01-01T00:30:00Z', hours)
    expect(during).toMatchObject({ state: 'ran', tradingDay: '2026-12-31', considered: 0, marked: 0 })
    expect(row(stillOpen, 'nye-evening')?.status).toBe('confirmed')

    const closed = seed()
    const after = await sweep(closed, '2027-01-01T01:05:00Z', hours)
    expect(after).toMatchObject({ state: 'ran', tradingDay: '2027-01-01', considered: 2, marked: 2 })
    expect(row(closed, 'nye-after-midnight')?.status).toBe('no_show')
  })

  it('follows London, not UTC, in summer time', async () => {
    // Saturday 11 July 2026 (BST). 22:30 UTC is 23:30 London, still Saturday; 23:05 UTC is Sunday.
    const seed = () =>
      createFakeSupabase({
        table_bookings: [booking('july', { booking_date: '2026-07-11', start_datetime: '2026-07-11T18:00:00.000Z' })],
      })

    const before = seed()
    await sweep(before, '2026-07-11T22:30:00Z')
    expect(row(before, 'july')?.status).toBe('confirmed')

    const after = seed()
    await sweep(after, '2026-07-11T23:05:00Z')
    expect(row(after, 'july')?.status).toBe('no_show')
  })

  it('sweeps nothing when the opening hours cannot be read', async () => {
    const db = createFakeSupabase({ table_bookings: [booking('open')] })
    const now = new Date(JUST_AFTER_MIDNIGHT)

    const result = await runNoShowSweep({
      db: db as never,
      now,
      tradingDay: async () => ({ date: '2026-11-22', until: now, unreadable: true }),
    })

    expect(result).toEqual({ state: 'held', reason: 'hours_unreadable' })
    expect(row(db, 'open')?.status).toBe('confirmed')
  })

  it('is safe to run twice: the second run finds nothing and changes nothing', async () => {
    const db = createFakeSupabase({ table_bookings: [booking('open')] })

    await sweep(db, JUST_AFTER_MIDNIGHT)
    const afterFirst = JSON.stringify(db.tables.table_bookings)
    const second = await sweep(db, '2026-11-22T01:00:00Z')

    expect(second).toMatchObject({ state: 'ran', considered: 0, marked: 0 })
    expect(JSON.stringify(db.tables.table_bookings)).toBe(afterFirst)
    expect(auditOrThrow).toHaveBeenCalledTimes(1)
  })

  it('counts a booking it could not write, and carries on', async () => {
    const db = createFakeSupabase({ table_bookings: [booking('open')] })
    db.failures.push({ table: 'table_bookings', op: 'update', error: { message: 'boom' } })

    const result = await sweep(db, JUST_AFTER_MIDNIGHT)

    expect(result).toMatchObject({ state: 'ran', marked: 0, errors: 1 })
    expect(logError).toHaveBeenCalled()
  })
})
