import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Both staff party-size routes (FOH and BOH) for a Christmas party (BK-054, owner decision D21):
 * they pass on who is leaving, ask the permission check only through the shared helper, report the
 * leaving guests' dishes so staff can tell the booker, and audit a change after the deadline as late.
 */

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  managerCheck: vi.fn(),
  update: vi.fn(),
  deposit: vi.fn(),
  sync: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: mocks.permission,
  requireBohTableBookingPermission: mocks.permission,
  tableBookingsManagerCheck: (auth: unknown) => {
    const check = async () => true
    mocks.managerCheck(auth, check)
    return check
  },
}))
vi.mock('@/lib/events/staff-seat-updates', () => ({
  mapSeatUpdateBlockedReason: (reason?: string) => reason || 'blocked',
  updateTableBookingPartySizeWithLinkedEventSeats: mocks.update,
  ChristmasCourseValidationError: class ChristmasCourseValidationError extends Error {},
  PartySizeUpdateFailedAfterMoveError: class PartySizeUpdateFailedAfterMoveError extends Error {},
}))
vi.mock('@/lib/table-bookings/staff-deposit-transitions', () => ({
  applyPartySizeDepositTransition: mocks.deposit,
  PARTY_SIZE_DEPOSIT_COLUMNS: 'id, party_size, status',
}))
vi.mock('@/lib/table-bookings/preorder', () => ({ syncPreorderCovers: mocks.sync }))
// The amended notice to the guest (BK-091) sits behind a messaging flag, off here.
vi.mock('@/lib/table-bookings/bookings', () => ({ sendTableBookingRescheduledNotificationIfAllowed: vi.fn() }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example' }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { POST as postFoh } from '@/app/api/foh/bookings/[id]/party-size/route'
import { POST as postBoh } from '@/app/api/boh/table-bookings/[id]/party-size/route'

const ID = '00000000-0000-4000-8000-000000000001'

const routes = [
  ['FOH', postFoh, 'foh'],
  ['BOH', postBoh, 'boh'],
] as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: ID, party_size: 8, status: 'confirmed', booking_type: 'christmas', booking_period_id: 'period-1', booking_period_name: 'Christmas dinner 2026' },
              error: null,
            }),
          }),
        }),
      }),
    },
  })
  mocks.update.mockResolvedValue({
    state: 'updated',
    table_booking_id: ID,
    event_booking_id: null,
    old_party_size: 8,
    new_party_size: 7,
    delta: -1,
    sms_sent: false,
    sms: null,
    event_id: null,
    updated_booking: { id: ID, party_size: 7, committed_party_size: 7, updated_at: null },
    late_change: true,
    removed_covers: [{ id: 'cover-2', ordinal: 2, guestName: 'Dave', courses: [{ course: 'main', itemName: 'Turkey' }] }],
  })
  mocks.deposit.mockResolvedValue({ state: 'manual_review', depositAmount: 80, message: 'Check the deposit.' })
  mocks.sync.mockResolvedValue({ partySize: 7, coverCount: 7, added: 0, removed: [] })
  mocks.audit.mockResolvedValue(undefined)
})

describe.each(routes)('%s party-size route on a Christmas party', (_label, post, source) => {
  async function send(body: Record<string, unknown>) {
    const response = await post(new NextRequest(`http://localhost/api/x/${ID}/party-size`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: ID }) })
    return { status: response.status, body: await response.json() }
  }

  it('passes on who is leaving and lets only the manager check decide a late change', async () => {
    const { status } = await send({ party_size: 7, christmas_course_counts: [3, 2, 3, 1, 1, 1, 1], removed_seats: [2] })

    expect(status).toBe(200)
    const input = mocks.update.mock.calls[0][1]
    expect(input).toMatchObject({ partySize: 7, christmasCourseCounts: [3, 2, 3, 1, 1, 1, 1], christmasRemovedSeats: [2] })
    expect(input.canMakeLateChristmasChange).toBe(mocks.managerCheck.mock.calls[0][1])
  })

  it("reports the leaving guest's dishes and audits the change as late", async () => {
    const { body } = await send({ party_size: 7, christmas_course_counts: [3, 2, 3, 1, 1, 1, 1], removed_seats: [2] })

    expect(body.lateChange).toBe(true)
    expect(body.preorderRemoved).toEqual([{ id: 'cover-2', ordinal: 2, guestName: 'Dave', courses: [{ course: 'main', itemName: 'Turkey' }] }])
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'table_booking.party_size_changed',
      additional_info: expect.objectContaining({ source, seats_removed: [2], late_change: true }),
    }))
  })

  it('refuses a seat list that cannot be a party', async () => {
    const { status } = await send({ party_size: 7, christmas_course_counts: [1, 1, 1, 1, 1, 1, 1], removed_seats: [0] })
    expect(status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
