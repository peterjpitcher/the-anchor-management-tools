import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * BK-048: the BOH 'Mark Confirmed' and the seat routes no longer bring a booking back without
 * checks. A cancelled or completed booking cannot be confirmed again at all; a no-show comes back
 * only when its table is free and its deposit still held (checkNoShowCanComeBack, tested in
 * tests/lib/staffStatusReinstate.test.ts).
 */

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  getTableBookingForFoh: vi.fn(),
  checkNoShowCanComeBack: vi.fn(),
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: mocks.permission,
  requireBohTableBookingPermission: mocks.permission,
}))
vi.mock('@/lib/foh/bookings', () => ({
  getTableBookingForFoh: mocks.getTableBookingForFoh,
  hasUnpaidRequiredDeposit: vi.fn(() => false),
}))
vi.mock('@/lib/table-bookings/reinstate-check', () => ({ checkNoShowCanComeBack: mocks.checkNoShowCanComeBack }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))

import { POST as postBohStatus } from '@/app/api/boh/table-bookings/[id]/status/route'
import { POST as postFohSeated } from '@/app/api/foh/bookings/[id]/seated/route'
import { createRecordingSupabase } from '../mocks/recordingSupabase'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

function bookingWith(status: string) {
  return {
    id: BOOKING_ID,
    customer_id: 'customer-1',
    booking_reference: 'TB-1',
    status,
    payment_status: null,
    booking_date: '2026-11-20',
    booking_time: '19:00:00',
    start_datetime: '2026-11-20T19:00:00.000Z',
    party_size: 4,
  }
}

function setUp(status: string) {
  const db = createRecordingSupabase({
    tables: { table_bookings: () => ({ data: { id: BOOKING_ID, status: 'confirmed' }, error: null }) },
  })
  mocks.permission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: db.client })
  mocks.getTableBookingForFoh.mockResolvedValue(bookingWith(status))
  mocks.logAuditEvent.mockResolvedValue(undefined)
  return db
}

function writes(db: ReturnType<typeof createRecordingSupabase>) {
  return db.queries.flatMap((query) => query.calls.filter((call) => call.method === 'update'))
}

function boh(action: string) {
  return postBohStatus(
    new NextRequest(`http://localhost/api/boh/table-bookings/${BOOKING_ID}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) },
  )
}

function fohSeat() {
  return postFohSeated(new NextRequest(`http://localhost/api/foh/bookings/${BOOKING_ID}/seated`, { method: 'POST' }), {
    params: Promise.resolve({ id: BOOKING_ID }),
  })
}

describe('bringing a booking back', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkNoShowCanComeBack.mockResolvedValue(null)
  })

  it.each(['cancelled', 'completed'])('BOH Mark Confirmed refuses a %s booking and changes nothing', async (status) => {
    const db = setUp(status)

    const response = await boh('confirmed')

    expect(response.status).toBe(409)
    expect(writes(db)).toEqual([])
  })

  it('BOH Mark Confirmed refuses a no-show whose table has gone, and changes nothing', async () => {
    const db = setUp('no_show')
    mocks.checkNoShowCanComeBack.mockResolvedValue('Its table is now booked by TB-OTHER at that time, so this booking cannot be put back. Move one of them first.')

    const response = await boh('confirmed')
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toMatch(/TB-OTHER/)
    expect(writes(db)).toEqual([])
  })

  it('BOH Mark Confirmed puts a no-show back once the checks pass', async () => {
    const db = setUp('no_show')

    const response = await boh('confirmed')

    expect(response.status).toBe(200)
    expect(mocks.checkNoShowCanComeBack).toHaveBeenCalledWith(db.client, expect.objectContaining({ id: BOOKING_ID, status: 'no_show' }))
    expect(writes(db)).toHaveLength(1)
  })

  it('BOH Seat Guests on a no-show runs the same checks', async () => {
    const db = setUp('no_show')
    mocks.checkNoShowCanComeBack.mockResolvedValue('The deposit on this booking has been refunded, so it cannot be put back without a new one. Make a new booking instead.')

    const response = await boh('seated')

    expect(response.status).toBe(409)
    expect(writes(db)).toEqual([])
  })

  it('FOH seating a no-show runs the same checks', async () => {
    const db = setUp('no_show')
    mocks.checkNoShowCanComeBack.mockResolvedValue('Its table is now booked by TB-OTHER at that time, so this booking cannot be put back. Move one of them first.')

    const response = await fohSeat()

    expect(response.status).toBe(409)
    expect(writes(db)).toEqual([])
  })

  it('does not run the no-show checks when seating a live booking', async () => {
    setUp('confirmed')

    const response = await fohSeat()

    expect(response.status).toBe(200)
    expect(mocks.checkNoShowCanComeBack).not.toHaveBeenCalled()
  })
})
