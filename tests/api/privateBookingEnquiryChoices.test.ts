import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../helpers/fakeSupabaseDb'

// BK-188: the room, the hire hours and the reply choice the website forms send arrive as
// fields, are kept on the booking, and reach the manager email, instead of only the notes.
//
// 20260811100100_revoke_anon_execute_and_public_reads.sql revoked anon EXECUTE
// on create_private_booking_transaction, stating that this route already
// reached it through createAdminClient. It did not: the admin client was used
// for idempotency and analytics only, and createBooking fell back to its
// default cookie-session client, which for an API-key caller is the anon role.
// From 11 August 2026 every enquiry from the brand site died on a permission
// error and was returned to the guest as a 500. This test fails if the admin
// client stops being passed.

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => state.db.client,
}))

const createBooking = vi.fn()

vi.mock('@/services/private-bookings', () => ({
  PrivateBookingService: {
    createBooking: (...args: unknown[]) => createBooking(...args),
  },
}))

vi.mock('@/lib/api/idempotency', () => ({
  getIdempotencyKey: () => 'test-idempotency-key',
  computeIdempotencyRequestHash: (payload: unknown) => JSON.stringify(payload),
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  markIdempotencyClaimCommitted: vi.fn().mockResolvedValue(undefined),
  persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
  releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: () => async () => null,
}))

// Authentication is proved in privateBookingEnquiryAuth.test.ts. Here the guard
// is passed straight through so the cases can look at what the handler does.
vi.mock('@/lib/api/auth', () => ({
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request)
  ),
}))

vi.mock('@/lib/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatPhoneForStorage: (phone: string) => phone,
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/communications/web-enquiry', () => ({
  recordPrivateBookingWebEnquiryCommunication: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendManagerPrivateBookingCreatedEmail: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/consent', () => ({
  ConsentService: { applyBookingContactConsent: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { POST } from '@/app/api/private-booking-enquiry/route'
import { sendManagerPrivateBookingCreatedEmail } from '@/lib/private-bookings/manager-notifications'

const ROOM = '20000000-0000-4000-8000-000000000001'

function enquiry(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/private-booking-enquiry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
    body: JSON.stringify(body),
  })
}

const VALID = { phone: '+447700900000', name: 'Alice Booker', date: '2026-12-05', time: '19:00', group_size: 30 }

beforeEach(() => {
  vi.clearAllMocks()
  state.db = createFakeDb({
    venue_spaces: [{ id: ROOM, name: 'Function Room' }],
    private_bookings: [{ id: 'pb-1', customer_id: 'cust-1', communication_preference: null, requested_space_id: null }],
  })
  createBooking.mockResolvedValue({ id: 'pb-1', customer_id: 'cust-1', end_time: '00:00' })
})

describe('the choices a website enquiry carries', () => {
  it('turns hire hours and a start time into the end time, across midnight', async () => {
    const response = await POST(enquiry({ ...VALID, hire_hours: 5 }) as never)
    expect(response.status).toBe(201)
    expect(createBooking.mock.calls[0][0]).toMatchObject({ start_time: '19:00', end_time: '00:00' })
  })

  it('sets no end time without a start time', async () => {
    await POST(enquiry({ phone: VALID.phone, name: VALID.name, date: VALID.date, hire_hours: 4 }) as never)
    expect(createBooking.mock.calls[0][0].end_time).toBeUndefined()
  })

  it('keeps the room asked for and the reply choice on the booking, and tells the manager', async () => {
    await POST(enquiry({ ...VALID, space_id: ROOM, hire_hours: 4, reply_preference: 'Email' }) as never)

    expect(state.db.rows('private_bookings')[0]).toMatchObject({ requested_space_id: ROOM, communication_preference: 'email' })
    expect(sendManagerPrivateBookingCreatedEmail).toHaveBeenCalledWith(expect.objectContaining({
      enquiry: { roomName: 'Function Room', hireHours: 4, replyPreference: 'email' },
    }))
  })

  it('treats "No preference" as no choice, and leaves out a room it does not know', async () => {
    await POST(enquiry({ ...VALID, space_id: '20000000-0000-4000-8000-000000000099', reply_preference: 'No preference' }) as never)

    expect(state.db.rows('private_bookings')[0]).toMatchObject({ requested_space_id: null, communication_preference: null })
    expect(sendManagerPrivateBookingCreatedEmail).toHaveBeenCalledWith(expect.objectContaining({
      enquiry: { roomName: null, hireHours: null, replyPreference: null },
    }))
  })

  it('matches the room the short form names, by name', async () => {
    await POST(enquiry({ ...VALID, room_name: 'function room' }) as never)
    expect(state.db.rows('private_bookings')[0]).toMatchObject({ requested_space_id: ROOM })
  })

  it('never refuses an enquiry over a room id it cannot read', async () => {
    const response = await POST(enquiry({ ...VALID, space_id: 'dining-room' }) as never)
    expect(response.status).toBe(201)
    expect(state.db.rows('private_bookings')[0]).toMatchObject({ requested_space_id: null })
  })

  it('refuses hours it cannot use, with words a guest can read', async () => {
    const response = await POST(enquiry({ ...VALID, hire_hours: 40 }) as never)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Please call 01753 682707 so we can plan a hire this long with you')
    expect(createBooking).not.toHaveBeenCalled()
  })

  it('still accepts the enquiry the live website sends today, with none of the new fields', async () => {
    const response = await POST(enquiry(VALID) as never)
    expect(response.status).toBe(201)
    expect(createBooking.mock.calls[0][0].end_time).toBeUndefined()
  })
})
