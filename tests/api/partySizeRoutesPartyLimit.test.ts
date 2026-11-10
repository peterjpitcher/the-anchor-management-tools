import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * BK-146, owner decision D30: one party limit for every table booking. Both staff party-size
 * routes read it from table_booking_max_party_online, the setting the booking functions use, and
 * refuse a bigger party before changing anything. They were hard-limited to 20 in the schema.
 *
 * Owner decisions of 10 November 2026: a Christmas booking takes the staff Christmas limit
 * (christmas_staff_max_party, 60) instead, and the limit only stops a party growing past it. Before,
 * the ordinary 20 was checked before the booking was read, so staff could not change a Christmas
 * party of 21 or more at all, not even to make it smaller.
 */

const mocks = vi.hoisted(() => ({ permission: vi.fn(), update: vi.fn() }))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: mocks.permission,
  requireBohTableBookingPermission: mocks.permission,
  tableBookingsManagerCheck: () => async () => true,
}))
vi.mock('@/lib/events/staff-seat-updates', () => ({
  mapSeatUpdateBlockedReason: (reason?: string) => reason || 'blocked',
  updateTableBookingPartySizeWithLinkedEventSeats: mocks.update,
  ChristmasCourseValidationError: class ChristmasCourseValidationError extends Error {},
  PartySizeUpdateFailedAfterMoveError: class PartySizeUpdateFailedAfterMoveError extends Error {},
}))
vi.mock('@/lib/table-bookings/staff-deposit-transitions', () => ({
  applyPartySizeDepositTransition: vi.fn(),
  PARTY_SIZE_DEPOSIT_COLUMNS: 'id, party_size, status',
}))
vi.mock('@/lib/table-bookings/preorder', () => ({ syncPreorderCovers: vi.fn() }))
vi.mock('@/lib/table-bookings/bookings', () => ({ sendTableBookingRescheduledNotificationIfAllowed: vi.fn() }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example' }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { POST as postFoh } from '@/app/api/foh/bookings/[id]/party-size/route'
import { POST as postBoh } from '@/app/api/boh/table-bookings/[id]/party-size/route'

const ID = '00000000-0000-4000-8000-000000000001'

function signedIn(
  limit: number,
  options: { christmasLimit?: number; booking?: Record<string, unknown> } = {}
) {
  const settings: Record<string, number | undefined> = {
    table_booking_max_party_online: limit,
    christmas_staff_max_party: options.christmasLimit,
  }
  mocks.permission.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    supabase: {
      from: (table: string) => ({
        select: () => ({
          eq: (_column: string, key: string) => ({
            maybeSingle: async () =>
              table === 'system_settings'
                ? { data: settings[key] === undefined ? null : { value: { value: settings[key] } }, error: null }
                : { data: { id: ID, party_size: 8, status: 'confirmed', ...options.booking }, error: null },
          }),
        }),
      }),
    },
  })
}

function request(partySize: number, extra: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(`https://management.example/api/x/${ID}/party-size`, {
    method: 'POST',
    body: JSON.stringify({ party_size: partySize, ...extra }),
  })
}

function updated(oldSize: number, newSize: number) {
  return {
    state: 'updated',
    table_booking_id: ID,
    event_booking_id: null,
    old_party_size: oldSize,
    new_party_size: newSize,
    delta: newSize - oldSize,
    sms_sent: false,
    sms: null,
    event_id: null,
    updated_booking: { id: ID, party_size: newSize, committed_party_size: newSize, updated_at: null },
  }
}

const CHRISTMAS_24 = { party_size: 24, booking_type: 'christmas' }

describe.each([
  ['FOH', postFoh],
  ['BOH', postBoh],
] as const)('%s party-size route', (_label, post) => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses a party over the limit and changes nothing', async () => {
    signedIn(20)
    const response = await post(request(21), { params: Promise.resolve({ id: ID }) })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Table bookings are for up to 20 guests. A bigger group is a private booking.')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('follows the setting, not a number of its own', async () => {
    signedIn(12)
    expect((await post(request(13), { params: Promise.resolve({ id: ID }) })).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('lets staff make an ordinary booking above the limit smaller', async () => {
    signedIn(20, { booking: { party_size: 24 } })
    mocks.update.mockResolvedValue(updated(24, 22))
    const response = await post(request(22), { params: Promise.resolve({ id: ID }) })

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ partySize: 22 }))
  })

  it('lets staff lower a Christmas party of 24, which the ordinary limit of 20 used to refuse', async () => {
    signedIn(20, { booking: CHRISTMAS_24 })
    mocks.update.mockResolvedValue(updated(24, 22))
    const response = await post(request(22, { christmas_course_counts: Array(22).fill(1) }), { params: Promise.resolve({ id: ID }) })

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ partySize: 22, christmasMaxPartySize: 60 })
    )
  })

  it('lets staff raise a Christmas party above 20 and above the online 26, up to the staff limit of 60', async () => {
    signedIn(20, { booking: CHRISTMAS_24 })
    mocks.update.mockResolvedValue(updated(24, 26))
    expect((await post(request(26, { christmas_course_counts: Array(26).fill(1) }), { params: Promise.resolve({ id: ID }) })).status).toBe(200)

    mocks.update.mockResolvedValue(updated(24, 60))
    expect((await post(request(60, { christmas_course_counts: Array(60).fill(1) }), { params: Promise.resolve({ id: ID }) })).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledTimes(2)
  })

  it('refuses a Christmas party grown past the staff limit, in Christmas words, and changes nothing', async () => {
    signedIn(20, { booking: CHRISTMAS_24 })
    const response = await post(request(61, { christmas_course_counts: Array(61).fill(1) }), { params: Promise.resolve({ id: ID }) })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Christmas bookings are for up to 60 guests. A bigger group is a private booking.')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('reads the staff Christmas limit from its setting', async () => {
    signedIn(20, { booking: CHRISTMAS_24, christmasLimit: 45 })
    expect((await post(request(46), { params: Promise.resolve({ id: ID }) })).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()

    mocks.update.mockResolvedValue(updated(24, 45))
    expect((await post(request(45), { params: Promise.resolve({ id: ID }) })).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ christmasMaxPartySize: 45 }))
  })
})
