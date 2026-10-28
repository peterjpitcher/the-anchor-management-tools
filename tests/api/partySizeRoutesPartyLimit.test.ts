import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * BK-146, owner decision D30: one party limit for every table booking. Both staff party-size
 * routes read it from table_booking_max_party_online, the setting the booking functions use, and
 * refuse a bigger party before changing anything. They were hard-limited to 20 in the schema.
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
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example' }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { POST as postFoh } from '@/app/api/foh/bookings/[id]/party-size/route'
import { POST as postBoh } from '@/app/api/boh/table-bookings/[id]/party-size/route'

const ID = '00000000-0000-4000-8000-000000000001'

function signedIn(limit: number) {
  mocks.permission.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    supabase: {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === 'system_settings'
                ? { data: { value: { value: limit } }, error: null }
                : { data: { id: ID, party_size: 8, status: 'confirmed' }, error: null },
          }),
        }),
      }),
    },
  })
}

function request(partySize: number): NextRequest {
  return new NextRequest(`https://management.example/api/x/${ID}/party-size`, {
    method: 'POST',
    body: JSON.stringify({ party_size: partySize }),
  })
}

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
})
