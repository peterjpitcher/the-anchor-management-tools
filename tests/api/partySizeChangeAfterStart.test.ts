import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireFohPermission: vi.fn(),
  updateSeats: vi.fn(),
  applyTransition: vi.fn(),
  sendNotice: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireBohTableBookingPermission: mocks.requireFohPermission,
  requireFohPermission: mocks.requireFohPermission,
  tableBookingsManagerCheck: vi.fn(() => async () => false),
}))
vi.mock('@/lib/events/staff-seat-updates', () => ({
  updateTableBookingPartySizeWithLinkedEventSeats: mocks.updateSeats,
  mapSeatUpdateBlockedReason: (reason: string) => reason,
  PartySizeUpdateFailedAfterMoveError: class extends Error {},
  ChristmasCourseValidationError: class extends Error {},
}))
vi.mock('@/lib/table-bookings/staff-deposit-transitions', () => ({
  applyPartySizeDepositTransition: mocks.applyTransition,
  PARTY_SIZE_DEPOSIT_COLUMNS: 'id, party_size, status, payment_status',
}))
vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingRescheduledNotificationIfAllowed: mocks.sendNotice,
}))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => true) }))
vi.mock('@/lib/table-bookings/preorder', () => ({ syncPreorderCovers: vi.fn(async () => ({ removed: [] })) }))
vi.mock('@/lib/table-bookings/party-limit', () => ({
  PARTY_SIZE_INPUT_CEILING: 100,
  readStaffPartyLimit: vi.fn(async () => 60),
  staffChristmasPartyLimitMessage: () => 'too many',
  staffPartyLimitMessage: () => 'too many',
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.orangejelly.co.uk' }))

import { POST as postFohPartySize } from '@/app/api/foh/bookings/[id]/party-size/route'
import { effectivePartySizeSendSms } from '@/lib/table-bookings/party-size-change'

/**
 * Owner decisions, 22 November 2026. Once a booking has started the guest is standing in front of
 * staff, so a party-size change from the floor says nothing to them. And a party that is already
 * seated is passed to the deposit step as seated, so growing to 15 or more is not blocked.
 */

const BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const START = '2026-11-21T19:00:00.000Z'

function supabase(row: Record<string, unknown>) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: {
              id: BOOKING_ID,
              party_size: 12,
              committed_party_size: 12,
              status: 'confirmed',
              payment_status: null,
              customer_id: 'customer-1',
              booking_date: '2026-11-21',
              booking_type: 'regular',
              start_datetime: START,
              booking_period_id: null,
              seated_at: null,
              left_at: null,
              ...row,
            },
            error: null,
          })),
        })),
      })),
    })),
  }
}

async function changeTo(partySize: number, row: Record<string, unknown>, body: Record<string, unknown> = {}) {
  mocks.requireFohPermission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: supabase(row) })
  const response = await postFohPartySize(
    new NextRequest(`https://management.orangejelly.co.uk/api/foh/bookings/${BOOKING_ID}/party-size`, {
      method: 'POST',
      body: JSON.stringify({ party_size: partySize, ...body }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) }
  )
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  mocks.updateSeats.mockResolvedValue({
    state: 'updated',
    table_booking_id: BOOKING_ID,
    event_booking_id: null,
    old_party_size: 12,
    new_party_size: 16,
    delta: 4,
    updated_booking: { id: BOOKING_ID, party_size: 16, committed_party_size: 16, updated_at: START },
  })
  mocks.applyTransition.mockResolvedValue({ state: 'unchanged' })
  mocks.sendNotice.mockResolvedValue({ status: 'sent', channel: 'email', fallbackUsed: false, error: null })
})
afterEach(() => vi.useRealTimers())

describe('a staff party-size change once the booking has started', () => {
  it('tells the guest before the booking starts', async () => {
    vi.setSystemTime(new Date('2026-11-21T15:00:00.000Z'))

    const { status } = await changeTo(16, {})

    expect(status).toBe(200)
    expect(mocks.updateSeats).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sendSms: true }))
    expect(mocks.applyTransition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sendSms: true, seatedNow: false }))
    expect(mocks.sendNotice).toHaveBeenCalledTimes(1)
  })

  it('messages nobody after the booking has started', async () => {
    vi.setSystemTime(new Date('2026-11-21T19:20:00.000Z'))

    const { status } = await changeTo(16, {})

    expect(status).toBe(200)
    expect(mocks.updateSeats).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sendSms: false }))
    expect(mocks.applyTransition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sendSms: false }))
    expect(mocks.sendNotice).not.toHaveBeenCalled()
  })

  it('messages nobody for a party seated early, and passes it on as seated', async () => {
    vi.setSystemTime(new Date('2026-11-21T18:45:00.000Z'))

    await changeTo(16, { seated_at: '2026-11-21T18:40:00.000Z' })

    expect(mocks.applyTransition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sendSms: false, seatedNow: true }))
    expect(mocks.sendNotice).not.toHaveBeenCalled()
  })

  it('does not treat a party that has left as seated', async () => {
    vi.setSystemTime(new Date('2026-11-21T18:45:00.000Z'))

    await changeTo(16, { seated_at: '2026-11-21T18:40:00.000Z', left_at: '2026-11-21T18:44:00.000Z' })

    expect(mocks.applyTransition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ seatedNow: false }))
  })

  it('keeps an explicit choice from the screen', () => {
    const started = { startIso: START, seatedNow: false, nowMs: Date.parse('2026-11-21T19:20:00.000Z') }
    expect(effectivePartySizeSendSms({ ...started, requested: true })).toBe(true)
    expect(effectivePartySizeSendSms({ ...started, requested: false })).toBe(false)
    expect(effectivePartySizeSendSms({ ...started, requested: undefined })).toBe(false)
    expect(effectivePartySizeSendSms({ startIso: START, seatedNow: false, nowMs: Date.parse('2026-11-21T10:00:00.000Z'), requested: undefined })).toBe(true)
  })
})
