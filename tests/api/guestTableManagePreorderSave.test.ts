import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkGuestTokenThrottle: vi.fn(),
  getTableManagePreviewByRawToken: vi.fn(),
  loadPreorderOrder: vi.fn(),
  savePreorderCover: vi.fn(),
  syncPreorderCovers: vi.fn(),
  logAuditEvent: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: mocks.checkGuestTokenThrottle }))
vi.mock('@/lib/table-bookings/manage-booking', () => ({
  getTableManagePreviewByRawToken: mocks.getTableManagePreviewByRawToken,
  updateTableBookingByRawToken: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/table-bookings/preorder', async () => {
  const actual = await vi.importActual<typeof import('@/lib/table-bookings/preorder')>('@/lib/table-bookings/preorder')
  return {
    ...actual,
    loadPreorderOrder: mocks.loadPreorderOrder,
    savePreorderCover: mocks.savePreorderCover,
    syncPreorderCovers: mocks.syncPreorderCovers,
  }
})

import { POST } from '@/app/g/[token]/table-manage/action/route'
import { PreorderCourseLimitError } from '@/lib/table-bookings/preorder'

const STAMP = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' }

function saveRequest(fields: Record<string, string>) {
  return new NextRequest('http://localhost/g/raw-token/table-manage/action', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'preorder', ...fields }),
  })
}

describe('guest pre-order save route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // 3 November 2026, before the noon cutoff for a 12 December booking.
    vi.setSystemTime(new Date('2026-11-03T10:00:00.000Z'))
    mocks.createAdminClient.mockReturnValue({ from: vi.fn() })
    mocks.checkGuestTokenThrottle.mockResolvedValue({ allowed: true })
    mocks.getTableManagePreviewByRawToken.mockResolvedValue({
      state: 'ready',
      table_booking_id: 'booking-1',
      status: 'confirmed',
    })
    mocks.syncPreorderCovers.mockResolvedValue({ partySize: 4, coverCount: 4, added: 0, removed: [] })
    mocks.loadPreorderOrder.mockResolvedValue({
      tableBookingId: 'booking-1',
      bookingReference: 'TB-FIXTURE',
      bookingDate: '2026-12-12',
      bookingTime: '19:00',
      partySize: 1,
      requiresPreorder: true,
      hasGuestSeats: true,
      bookingAllergies: [],
      periodId: 'period-1',
      periodName: 'Christmas dinner 2026',
      preorderCutoffDays: 7,
      courseCounts: [2],
      covers: [
        { id: 'cover-1', tableBookingId: 'booking-1', ordinal: 1, guestName: null, dietaryNote: null, courseCount: 2, selections: [], ...STAMP },
      ],
    })
  })

  it('tells the guest a 2 course seat cannot take a starter and a dessert, instead of blaming the menu', async () => {
    mocks.savePreorderCover.mockRejectedValue(new PreorderCourseLimitError(1, 2))

    const response = await POST(
      saveRequest({
        seat_1_main: '11111111-1111-4111-8111-111111111111',
        seat_1_starter: '22222222-2222-4222-8222-222222222222',
        seat_1_dessert: '33333333-3333-4333-8333-333333333333',
      }),
      { params: Promise.resolve({ token: 'raw-token' }) },
    )

    expect(response.status).toBe(303)
    const location = new URL(response.headers.get('location') || '')
    expect(location.searchParams.get('preorder')).toBe('error')
    expect(location.searchParams.get('seat')).toBe('1')
    expect(location.searchParams.get('reason')).toBe('courses')
  })

  it('keeps the general reason for any other failed seat', async () => {
    mocks.savePreorderCover.mockRejectedValue(new Error('Fixture dish has been taken off the menu.'))

    const response = await POST(saveRequest({ seat_1_main: '11111111-1111-4111-8111-111111111111' }), {
      params: Promise.resolve({ token: 'raw-token' }),
    })

    const location = new URL(response.headers.get('location') || '')
    expect(location.searchParams.get('seat')).toBe('1')
    expect(location.searchParams.get('reason')).toBeNull()
  })

  // BK-149: guest saves are audited like staff saves, by seat number and dish id only.
  it('audits a guest save with seat numbers and dish ids, never the name or the dietary note', async () => {
    mocks.savePreorderCover.mockResolvedValue({})

    await POST(
      saveRequest({
        seat_1_name: 'Fixture Seat Name',
        seat_1_note: 'Fixture dietary note',
        seat_1_main: '11111111-1111-4111-8111-111111111111',
        seat_1_dessert: '33333333-3333-4333-8333-333333333333',
      }),
      { params: Promise.resolve({ token: 'raw-token' }) },
    )

    expect(mocks.logAuditEvent).toHaveBeenCalledTimes(1)
    const audit = mocks.logAuditEvent.mock.calls[0][0]
    expect(audit).toEqual(
      expect.objectContaining({
        resource_type: 'table_booking_preorder',
        resource_id: 'booking-1',
        operation_status: 'success',
        additional_info: {
          booking_reference: 'TB-FIXTURE',
          seats_saved: [1],
          dish_ids: ['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'],
          source: 'guest_manage_page',
        },
      }),
    )
    expect(JSON.stringify(audit)).not.toContain('Fixture Seat Name')
    expect(JSON.stringify(audit)).not.toContain('Fixture dietary note')
  })

  it('writes no audit row when nothing changed', async () => {
    await POST(saveRequest({ seat_1_main: '' }), { params: Promise.resolve({ token: 'raw-token' }) })

    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })

  // BK-148 and owner decision D23: a party all on 1 course has nothing to pre-order, but each guest's
  // name and dietary note save to their seat from the guest page.
  it("saves a 1 course guest's name and dietary note on a party with nothing to pre-order", async () => {
    mocks.savePreorderCover.mockResolvedValue({})
    mocks.loadPreorderOrder.mockResolvedValue({
      tableBookingId: 'booking-1',
      bookingReference: 'TB-FIXTURE',
      bookingDate: '2026-12-12',
      bookingTime: '19:00',
      partySize: 1,
      requiresPreorder: false,
      hasGuestSeats: true,
      bookingAllergies: [],
      periodId: 'period-1',
      periodName: 'Christmas dinner 2026',
      preorderCutoffDays: 7,
      courseCounts: [1],
      covers: [
        { id: 'cover-1', tableBookingId: 'booking-1', ordinal: 1, guestName: null, dietaryNote: null, courseCount: 1, selections: [], ...STAMP },
      ],
    })

    const response = await POST(saveRequest({ seat_1_name: 'Sam', seat_1_note: 'No dairy' }), {
      params: Promise.resolve({ token: 'raw-token' }),
    })

    expect(new URL(response.headers.get('location') || '').searchParams.get('preorder')).toBe('saved')
    expect(mocks.savePreorderCover).toHaveBeenCalledWith(expect.anything(), {
      coverId: 'cover-1',
      guestName: 'Sam',
      dietaryNote: 'No dairy',
    })
  })
})
