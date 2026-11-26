import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Staff turn a confirmed regular booking into a Christmas booking where only some seats are having
 * Christmas dinner (owner requirement, 26 November 2026): 12 seats, 9 dinners, GBP 90 deposit.
 *
 * The database change itself is proven by scripts/testing/christmas-diner-count-postgres.py. Here:
 * the route asks the database once with the right arguments, sends exactly ONE deposit request
 * through the email-first path with the diner wording, says the booking stays confirmed, and maps
 * every database refusal to a 409 with its own sentence and no message sent.
 */

const mocks = vi.hoisted(() => ({
  requireBohTableBookingPermission: vi.fn(),
  notify: vi.fn(),
  createTablePaymentToken: vi.fn(),
  audit: vi.fn(async () => undefined),
}))

vi.mock('@/lib/foh/api-auth', () => ({ requireBohTableBookingPermission: mocks.requireBohTableBookingPermission }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.orangejelly.co.uk' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: mocks.audit } }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: (body: string) => body }))
vi.mock('@/lib/sms/bulk', () => ({ getSmartFirstName: (name: string) => name }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/table-bookings/bookings', () => ({ createTablePaymentToken: mocks.createTablePaymentToken }))
vi.mock('@/lib/guest/guest-short-link', () => ({
  buildGuestShortLink: vi.fn(async () => ({ url: 'https://l.the-anchor.pub/pay123', shortened: true })),
}))
vi.mock('@/lib/table-bookings/guest-notify', () => ({
  GUEST_CHANNEL_COLUMNS: 'id, first_name, email, mobile_e164, mobile_number',
  notifyTableBookingGuestEmailFirst: mocks.notify,
}))

import { POST } from '@/app/api/boh/table-bookings/[id]/convert-to-christmas/route'

const BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000009'
const START = '2026-12-12T13:00:00.000Z'

function convertedRow(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    table_booking_id: BOOKING_ID,
    booking_reference: 'TB-XMAS9',
    customer_id: 'customer-1',
    status: 'confirmed',
    party_size: 12,
    christmas_diner_count: 9,
    christmas_course_counts: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    start_datetime: START,
    hold_expires_at: START,
    deposit_amount: 90,
    deposit_rule: 'period',
    deposit_basis: 'per_head',
    deposit_rate: 10,
    deposit_refund_cutoff_days: 7,
    booking_period_name: 'Christmas 2026',
    cover_count: 9,
    ...overrides,
  }
}

function seed(rpcResult: { data: unknown; error: unknown }) {
  const db = createFakeSupabase({
    customers: [{ id: 'customer-1', first_name: 'Sam', email: 'sam@example.com', mobile_e164: '+447700900123', mobile_number: null }],
    table_bookings: [{
      id: BOOKING_ID,
      booking_reference: 'TB-XMAS9',
      booking_date: '2026-12-12',
      booking_time: '13:00:00',
      start_datetime: START,
      deposit_refund_cutoff_days: 7,
    }],
  }) as ReturnType<typeof createFakeSupabase> & { rpc: ReturnType<typeof vi.fn> }
  db.rpc = vi.fn(async () => rpcResult)
  mocks.requireBohTableBookingPermission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: db })
  return db
}

async function convert(body: unknown) {
  const response = await POST(
    new NextRequest(`https://management.orangejelly.co.uk/api/boh/table-bookings/${BOOKING_ID}/convert-to-christmas`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: BOOKING_ID }) }
  )
  return { status: response.status, body: await response.json() }
}

describe('converting a booking to Christmas dinner for some of its seats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTablePaymentToken.mockImplementation(async (_db: unknown, input: { holdExpiresAt: string }) => ({
      rawToken: 'raw',
      url: 'https://management.orangejelly.co.uk/g/raw/table-payment',
      expiresAt: input.holdExpiresAt,
    }))
    mocks.notify.mockResolvedValue({ status: 'sent', channel: 'email', fallbackUsed: false })
  })

  it('asks the database once, sends ONE deposit request for 9 dinners, and stays confirmed', async () => {
    const db = seed({ data: convertedRow(), error: null })

    const { status, body } = await convert({ christmas_diners: 9, internal_note: '3 children on the kids menu' })

    expect(status).toBe(200)
    expect(db.rpc).toHaveBeenCalledTimes(1)
    expect(db.rpc).toHaveBeenCalledWith('convert_table_booking_to_christmas_v01', {
      p_booking_id: BOOKING_ID,
      p_christmas_diners: 9,
      p_internal_note: '3 children on the kids menu',
    })
    expect(body.data).toMatchObject({
      state: 'deposit_required',
      stillConfirmed: true,
      partySize: 12,
      christmasDiners: 9,
      depositAmount: 90,
      warning: null,
    })

    // The payment link lasts until the booking starts: the deposit is owed, not a hold.
    expect(mocks.createTablePaymentToken).toHaveBeenCalledTimes(1)
    expect(mocks.createTablePaymentToken.mock.calls[0][1]).toMatchObject({ holdExpiresAt: START, tableBookingId: BOOKING_ID })

    expect(mocks.notify).toHaveBeenCalledTimes(1)
    const sent = mocks.notify.mock.calls[0][0]
    expect(sent.templateKey).toBe('table_booking_pending_payment')
    expect(sent.idempotencyKey).toBe(`table_booking_pending_payment:christmas_conversion:${BOOKING_ID}:9000`)
    expect(sent.fallback.message).toBe('party_size_deposit_request')
    expect(sent.sms.body).toBe(
      'The Anchor: Hi Sam, your table for 12 people is now booked for Christmas dinner, with 9 of you having it. ' +
        "Your table is still booked. There's now a Christmas deposit of £90.00 (9 x GBP 10) to pay before your visit. " +
        'Pay here: https://l.the-anchor.pub/pay123'
    )
    for (const part of [sent.email.subject, sent.email.html, sent.email.text, sent.sms.body]) {
      expect(part).not.toMatch(/undefined|NaN|Invalid Date|£7\.50|party size has been updated/)
    }
    expect(sent.email.text).toContain('£90.00 (9 x GBP 10)')
    expect(sent.email.text).toContain('with 9 of you having it')
    expect(sent.email.text).toContain("There's a £10 deposit for each Christmas dinner, which comes off your bill.")

    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'table_booking.converted_to_christmas',
      resource_id: BOOKING_ID,
      new_values: expect.objectContaining({ christmas_diner_count: 9, deposit_amount: 90, party_size: 12 }),
    }))
  })

  it('says so, and keeps the conversion, when the message cannot be sent', async () => {
    seed({ data: convertedRow(), error: null })
    mocks.notify.mockResolvedValue({ status: 'failed', channel: null, fallbackUsed: false, error: 'provider down' })

    const { status, body } = await convert({ christmas_diners: 9 })

    expect(status).toBe(200)
    expect(body.data.stillConfirmed).toBe(true)
    expect(body.data.warning).toMatch(/could not be sent/)
  })

  it.each([
    ['Only confirmed bookings can be changed to Christmas dinner.'],
    ['Christmas dinner is for 4 or more people having it.'],
    ['This booking already has a deposit, so it cannot be changed to Christmas dinner here.'],
    ['Christmas dinner is not on offer for 3 Jan 2027.'],
  ])('refuses with the database sentence and sends nothing: %s', async (message) => {
    seed({ data: null, error: { code: '22023', message } })

    const { status, body } = await convert({ christmas_diners: 9 })

    expect(status).toBe(409)
    expect(body.error).toBe(message)
    expect(mocks.createTablePaymentToken).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('answers 404 for a booking that does not exist', async () => {
    seed({ data: null, error: { code: 'P0002', message: 'Booking not found' } })
    const { status } = await convert({ christmas_diners: 9 })
    expect(status).toBe(404)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('refuses a body without a whole number of diners before touching the database', async () => {
    const db = seed({ data: convertedRow(), error: null })
    for (const body of [{}, { christmas_diners: 0 }, { christmas_diners: 2.5 }, { christmas_diners: '9' }]) {
      const { status } = await convert(body)
      expect(status).toBe(400)
    }
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
