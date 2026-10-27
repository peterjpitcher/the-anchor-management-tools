import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: vi.fn().mockResolvedValue(undefined) } }))

import { AuditService } from '@/services/audit'
import { hashGuestToken } from '@/lib/guest/tokens'
import { updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'

/**
 * BK-040 and BK-091 (customer bookings review of 24 October 2026): a guest growing their own booking.
 *
 * The manage link looked for one free table big enough. No table seats more than six, so every
 * party growing to seven or more was refused with "we could not process that request". It also
 * ignored step-free and high-chair needs, wrote the guest's window over the table's (dropping the
 * turnaround), was never checked against the kitchen pacing limit, and left no audit row.
 */

const BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000001'
const TABLE_SIX = 'bbbbbbbb-0000-4000-8000-000000000006'
const TABLE_A = 'bbbbbbbb-0000-4000-8000-00000000000a'
const TABLE_B = 'bbbbbbbb-0000-4000-8000-00000000000b'

// Saturday 14 November 2026, GMT. 19:00 to 21:00, the table held to 21:15.
const START = '2026-11-14T19:00:00.000Z'
const GUEST_END = '2026-11-14T21:00:00.000Z'
const TABLE_END = '2026-11-14T21:15:00.000Z'

type Db = FakeSupabase & { rpc: ReturnType<typeof vi.fn> }

function seed(options: {
  needs?: { requires_accessible_table?: boolean; high_chair_count?: number }
  candidates?: Array<{ table_ids: string[]; rank: number | null; reason_code: string | null }>
  pacing?: { enabled: boolean; otherCovers?: number }
} = {}): Db {
  const pacing = options.pacing ?? { enabled: false }
  const otherCovers = pacing.otherCovers ?? 0
  const db = createFakeSupabase({
    guest_tokens: [{
      hashed_token: hashGuestToken('raw-token'),
      action_type: 'manage',
      customer_id: CUSTOMER_ID,
      table_booking_id: BOOKING_ID,
      expires_at: '2026-11-16T19:00:00.000Z',
      consumed_at: null,
    }],
    table_bookings: [
      {
        id: BOOKING_ID,
        customer_id: CUSTOMER_ID,
        booking_reference: 'TB-GROW',
        status: 'confirmed',
        party_size: 6,
        committed_party_size: 6,
        special_requirements: null,
        booking_type: 'regular',
        booking_purpose: 'food',
        booking_date: '2026-11-14',
        booking_time: '19:00:00',
        start_datetime: START,
        end_datetime: GUEST_END,
        is_outside_seating: false,
        requires_accessible_table: options.needs?.requires_accessible_table ?? false,
        high_chair_count: options.needs?.high_chair_count ?? 0,
        payment_status: null,
        deposit_amount: null,
        deposit_amount_locked: null,
        deposit_waived: false,
        booking_period_id: null,
        booking_period_name: null,
      },
      ...(otherCovers > 0
        ? [{
            id: 'other-booking',
            booking_date: '2026-11-14',
            booking_time: '19:00:00',
            booking_purpose: 'food',
            party_size: otherCovers,
            committed_party_size: otherCovers,
            status: 'confirmed',
            left_at: null,
            hold_expires_at: null,
            payment_status: null,
          }]
        : []),
    ],
    tables: [{ id: TABLE_SIX, table_number: '6', name: 'Six', capacity: 6 }],
    booking_table_assignments: [
      { id: 'assignment-1', table_booking_id: BOOKING_ID, table_id: TABLE_SIX, start_datetime: START, end_datetime: TABLE_END },
    ],
    system_settings: [
      { key: 'table_booking_max_party_online', value: { value: 20 } },
      { key: 'kitchen_pacing_enabled', value: { value: pacing.enabled } },
      { key: 'kitchen_pacing_window_minutes', value: { value: 30 } },
      { key: 'kitchen_pace_covers_regular', value: { value: 25 } },
      { key: 'kitchen_walk_in_reserve_regular', value: { value: 6 } },
    ],
    special_hours: [],
  }) as Db

  db.rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    if (fn === 'find_table_allocation_candidates') {
      return Promise.resolve({
        data: options.candidates ?? [
          { table_ids: [TABLE_A, TABLE_B], rank: 1, reason_code: null },
          { table_ids: [TABLE_SIX], rank: null, reason_code: 'too_large_for_table' },
        ],
        error: null,
      })
    }
    if (fn === 'move_table_booking_assignments_v05') {
      return Promise.resolve({ data: { state: 'moved', table_ids: args.p_table_ids }, error: null })
    }
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } })
  })
  return db
}

function rpcCalls(db: Db, name: string) {
  return db.rpc.mock.calls.filter(([fn]) => fn === name).map(([, args]) => args)
}

async function grow(db: Db, newPartySize: number) {
  return updateTableBookingByRawToken(db as never, {
    rawToken: 'raw-token',
    action: 'update',
    newPartySize,
    appBaseUrl: 'https://management.orangejelly.co.uk',
  })
}

function partySize(db: Db): number {
  return db.tables.table_bookings.find((row) => row.id === BOOKING_ID)?.party_size
}

describe('a guest growing their own booking', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'))
    vi.clearAllMocks()
  })
  afterEach(() => vi.useRealTimers())

  it('joins tables for a party of seven, keeping the turnaround', async () => {
    const db = seed()

    const result = await grow(db, 7)

    expect(result).toMatchObject({ state: 'updated', old_party_size: 6, new_party_size: 7 })
    expect(partySize(db)).toBe(7)
    expect(rpcCalls(db, 'find_table_allocation_candidates')).toEqual([
      expect.objectContaining({
        p_start_at: START,
        p_end_at: TABLE_END,
        p_party_size: 7,
        p_purpose: 'food',
        p_channel: 'online',
        p_exclude_booking: BOOKING_ID,
        p_preferred_table_ids: [TABLE_SIX],
        p_requires_accessible_table: false,
        p_high_chair_count: 0,
      }),
    ])
    expect(rpcCalls(db, 'move_table_booking_assignments_v05')).toEqual([
      { p_table_booking_id: BOOKING_ID, p_table_ids: [TABLE_A, TABLE_B], p_start_datetime: START, p_end_datetime: TABLE_END },
    ])
  })

  it('asks the picker for a step-free table with room for the high chair', async () => {
    const db = seed({ needs: { requires_accessible_table: true, high_chair_count: 1 } })

    await grow(db, 7)

    expect(rpcCalls(db, 'find_table_allocation_candidates')[0]).toMatchObject({
      p_requires_accessible_table: true,
      p_high_chair_count: 1,
    })
  })

  it('says there is no table, and changes nothing, when nothing fits', async () => {
    const db = seed({ candidates: [{ table_ids: [TABLE_SIX], rank: null, reason_code: 'too_large_for_table' }] })

    const result = await grow(db, 7)

    expect(result).toEqual({ state: 'blocked', reason: 'no_table' })
    expect(partySize(db)).toBe(6)
    expect(rpcCalls(db, 'move_table_booking_assignments_v05')).toEqual([])
  })

  it('records the change against the booking as the guest\'s own', async () => {
    const db = seed()

    await grow(db, 7)

    expect(AuditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'table_booking.party_size_changed_by_guest',
      resource_type: 'table_booking',
      resource_id: BOOKING_ID,
      additional_info: expect.objectContaining({ source: 'guest_manage_link', previousPartySize: 6, newPartySize: 7 }),
    }))
  })

  it('refuses an increase that takes a busy kitchen window over its limit', async () => {
    // A Saturday ceiling of 25 - 6 = 19 covers; 15 already booked at 19:00, so 15 + 7 is over.
    const db = seed({ pacing: { enabled: true, otherCovers: 15 } })

    const result = await grow(db, 7)

    expect(result).toEqual({ state: 'blocked', reason: 'slot_full' })
    expect(partySize(db)).toBe(6)
    expect(AuditService.logAuditEvent).not.toHaveBeenCalled()
  })

  it('lets the increase through when the window has room, or the party is alone in it', async () => {
    expect((await grow(seed({ pacing: { enabled: true, otherCovers: 12 } }), 7)).state).toBe('updated')
    expect((await grow(seed({ pacing: { enabled: true, otherCovers: 0 } }), 7)).state).toBe('updated')
  })
})
