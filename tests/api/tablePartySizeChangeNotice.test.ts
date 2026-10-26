import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireBohTableBookingPermission: vi.fn(),
  requireFohPermission: vi.fn(),
  updateSeats: vi.fn(),
  applyTransition: vi.fn(),
  sendNotice: vi.fn(),
  isMessagingFlagOn: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireBohTableBookingPermission: mocks.requireBohTableBookingPermission,
  requireFohPermission: mocks.requireFohPermission,
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
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: mocks.isMessagingFlagOn }))
vi.mock('@/lib/table-bookings/preorder', () => ({ syncPreorderCovers: vi.fn(async () => ({ removed: [] })) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.orangejelly.co.uk' }))

import { POST as postBohPartySize } from '@/app/api/boh/table-bookings/[id]/party-size/route'

/**
 * BK-091: when staff change a table booking's party size, the guest was told nothing unless the
 * change crossed the deposit threshold. The amended-booking notice now goes, behind the messaging
 * flag table_party_size_change_notice (off until the owner has read it), and the route says whether
 * the guest was reached.
 */

const BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const START = '2026-11-14T19:00:00.000Z'

function supabase() {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: {
              id: BOOKING_ID,
              party_size: 4,
              committed_party_size: 4,
              status: 'confirmed',
              payment_status: null,
              customer_id: 'customer-1',
              booking_date: '2026-11-14',
              booking_type: 'regular',
              start_datetime: START,
              booking_period_id: null,
            },
            error: null,
          })),
        })),
      })),
    })),
  }
}

async function changeTo(partySize: number, body: Record<string, unknown> = {}) {
  const response = await postBohPartySize(
    new NextRequest(`https://management.orangejelly.co.uk/api/boh/table-bookings/${BOOKING_ID}/party-size`, {
      method: 'POST',
      body: JSON.stringify({ party_size: partySize, ...body }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) }
  )
  return { status: response.status, body: await response.json() }
}

describe('a staff party-size change tells the guest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireBohTableBookingPermission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: supabase() })
    mocks.updateSeats.mockResolvedValue({
      state: 'updated',
      table_booking_id: BOOKING_ID,
      event_booking_id: null,
      old_party_size: 4,
      new_party_size: 6,
      delta: 2,
      sms_sent: false,
      sms: null,
      event_id: null,
      updated_booking: { id: BOOKING_ID, party_size: 6, committed_party_size: 6, updated_at: '2026-11-01T10:00:00.000Z' },
    })
    mocks.applyTransition.mockResolvedValue({ state: 'unchanged' })
    mocks.sendNotice.mockResolvedValue({ status: 'sent', channel: 'email', fallbackUsed: false, error: null })
    mocks.isMessagingFlagOn.mockResolvedValue(true)
  })

  it('sends the amended notice with the old party size, and reports it', async () => {
    const { status, body } = await changeTo(6)

    expect(status).toBe(200)
    expect(mocks.isMessagingFlagOn).toHaveBeenCalledWith('table_party_size_change_notice')
    expect(mocks.sendNotice).toHaveBeenCalledWith(expect.anything(), {
      tableBookingId: BOOKING_ID,
      previous: { startDateTime: START, partySize: 4 },
    })
    expect(body.partySizeNotification).toEqual({ status: 'sent', channel: 'email', fallbackUsed: false, error: null })
  })

  it('reports a guest who could not be reached', async () => {
    mocks.sendNotice.mockResolvedValue({ status: 'no_channel', channel: null, fallbackUsed: false, error: 'no_channel_available' })

    const { body } = await changeTo(6)

    expect(body.partySizeNotification).toMatchObject({ status: 'no_channel' })
  })

  it('sends nothing while the flag is off', async () => {
    mocks.isMessagingFlagOn.mockResolvedValue(false)

    const { body } = await changeTo(6)

    expect(mocks.sendNotice).not.toHaveBeenCalled()
    expect(body.partySizeNotification).toBeNull()
  })

  it('sends nothing when staff chose not to notify the guest', async () => {
    await changeTo(6, { send_sms: false })

    expect(mocks.sendNotice).not.toHaveBeenCalled()
  })

  it('sends nothing more when the deposit request already went on this change', async () => {
    mocks.applyTransition.mockResolvedValue({
      state: 'deposit_required',
      depositUrl: 'https://management.orangejelly.co.uk/g/raw/table-payment',
      depositAmount: 160,
      holdExpiresAt: START,
      smsSent: false,
      notification: { status: 'sent', channel: 'email', fallbackUsed: false, error: null },
    })

    await changeTo(16)

    expect(mocks.sendNotice).not.toHaveBeenCalled()
  })
})
