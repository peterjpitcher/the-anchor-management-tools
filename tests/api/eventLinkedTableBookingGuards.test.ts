import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * BK-074 (customer bookings review, 24 October 2026): a table booking made for an event booking is
 * the table half of one booking. Cancelling, no-showing, moving or deleting it on its own used to
 * leave the paid ticket confirmed with no seat. Every staff and guest path now refuses it, with the
 * rule and code the FOH time route already used.
 */

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  getTableBookingForFoh: vi.fn(),
  refundTableBookingDeposit: vi.fn(),
  sendCancelled: vi.fn(),
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
vi.mock('@/lib/table-bookings/refunds', () => ({ refundTableBookingDeposit: mocks.refundTableBookingDeposit }))
vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingCancelledSmsIfAllowed: mocks.sendCancelled,
  sendTableBookingRescheduledNotificationIfAllowed: vi.fn(),
}))
vi.mock('@/lib/table-bookings/deposit-alerts', () => ({ alertTableDepositNeedsAPerson: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/payments/stripe', () => ({ expireStripeCheckoutSession: vi.fn(), isStripeConfigured: vi.fn(() => false) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { POST as postFohCancel } from '@/app/api/foh/bookings/[id]/cancel/route'
import { POST as postFohNoShow } from '@/app/api/foh/bookings/[id]/no-show/route'
import { POST as postBohStatus } from '@/app/api/boh/table-bookings/[id]/status/route'
import { PATCH as patchBohBooking, DELETE as deleteBohBooking } from '@/app/api/boh/table-bookings/[id]/route'
import { getTableManagePreviewByRawToken, updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'
import { createRecordingSupabase } from '../mocks/recordingSupabase'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'
const EVENT_BOOKING_ID = '00000000-0000-4000-8000-0000000000e1'

const LINKED_ROW = {
  id: BOOKING_ID,
  customer_id: 'customer-1',
  booking_reference: 'TB-1',
  status: 'confirmed',
  payment_status: null,
  booking_date: '2036-12-12',
  booking_time: '19:00:00',
  duration_minutes: 120,
  start_datetime: '2036-12-12T19:00:00.000Z',
  end_datetime: '2036-12-12T21:00:00.000Z',
  party_size: 4,
  committed_party_size: 4,
  event_booking_id: EVENT_BOOKING_ID,
}

function setUp(row: Record<string, unknown> = LINKED_ROW) {
  const db = createRecordingSupabase({
    tables: {
      table_bookings: () => ({ data: row, error: null }),
      guest_tokens: () => ({
        data: { customer_id: 'customer-1', table_booking_id: BOOKING_ID, expires_at: '2036-12-13T00:00:00.000Z', consumed_at: null },
        error: null,
      }),
      booking_table_assignments: () => ({ data: [], error: null }),
    },
  })
  mocks.permission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: db.client })
  mocks.getTableBookingForFoh.mockResolvedValue(row)
  mocks.logAuditEvent.mockResolvedValue(undefined)
  return db
}

function writesTo(db: ReturnType<typeof createRecordingSupabase>) {
  return db.queries
    .filter((query) => query.table === 'table_bookings')
    .flatMap((query) => query.calls.filter((call) => call.method === 'update' || call.method === 'delete'))
}

const params = { params: Promise.resolve({ id: BOOKING_ID }) }

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
}

async function expectRefused(response: Response, db: ReturnType<typeof createRecordingSupabase>) {
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({
    error: 'This booking is tied to an event. Change it from the event instead.',
    code: 'event_linked',
  })
  expect(writesTo(db)).toEqual([])
  expect(mocks.refundTableBookingDeposit).not.toHaveBeenCalled()
  expect(mocks.sendCancelled).not.toHaveBeenCalled()
}

describe('event-linked table bookings are changed from the event (BK-074)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('FOH cancel refuses the table half of an event booking', async () => {
    const db = setUp()
    await expectRefused(await postFohCancel(jsonRequest(`http://localhost/api/foh/bookings/${BOOKING_ID}/cancel`, 'POST', { cancelled_by: 'venue' }), params), db)
  })

  it('FOH no-show refuses it', async () => {
    const db = setUp()
    await expectRefused(await postFohNoShow(jsonRequest(`http://localhost/api/foh/bookings/${BOOKING_ID}/no-show`, 'POST'), params), db)
  })

  it('BOH status refuses cancel and no-show', async () => {
    for (const action of ['cancelled', 'no_show']) {
      const db = setUp()
      await expectRefused(await postBohStatus(jsonRequest(`http://localhost/api/boh/table-bookings/${BOOKING_ID}/status`, 'POST', { action, cancelled_by: 'venue' }), params), db)
    }
  })

  it('BOH status still lets staff seat an event table', async () => {
    setUp()
    const response = await postBohStatus(jsonRequest(`http://localhost/api/boh/table-bookings/${BOOKING_ID}/status`, 'POST', { action: 'seated' }), params)
    const payload = await response.json()
    expect(payload.code).not.toBe('event_linked')
  })

  it('BOH edit refuses a new date or time', async () => {
    const db = setUp()
    await expectRefused(await patchBohBooking(jsonRequest(`http://localhost/api/boh/table-bookings/${BOOKING_ID}`, 'PATCH', {
      booking_date: '2036-12-13', booking_time: '19:00', duration_minutes: 120,
    }), params), db)
    const db2 = setUp()
    await expectRefused(await patchBohBooking(jsonRequest(`http://localhost/api/boh/table-bookings/${BOOKING_ID}`, 'PATCH', {
      booking_date: '2036-12-12', booking_time: '20:00', duration_minutes: 120,
    }), params), db2)
  })

  it('BOH delete refuses a live event table', async () => {
    const db = setUp()
    await expectRefused(await deleteBohBooking(jsonRequest(`http://localhost/api/boh/table-bookings/${BOOKING_ID}`, 'DELETE'), params), db)
  })

  it('an ordinary table booking is not refused by the event rule', async () => {
    setUp({ ...LINKED_ROW, event_booking_id: null })
    const response = await postFohNoShow(jsonRequest(`http://localhost/api/foh/bookings/${BOOKING_ID}/no-show`, 'POST'), params)
    const payload = await response.json()
    expect(payload.code).not.toBe('event_linked')
  })

  it('the guest manage link offers no change and refuses one', async () => {
    const db = setUp()
    const preview = await getTableManagePreviewByRawToken(db.client as never, 'raw-token')
    expect(preview).toMatchObject({ state: 'ready', event_linked: true, can_edit: false, can_cancel: false })

    const result = await updateTableBookingByRawToken(db.client as never, { rawToken: 'raw-token', action: 'cancel' })
    expect(result).toEqual({ state: 'blocked', reason: 'event_linked' })
    expect(writesTo(db)).toEqual([])
  })
})
