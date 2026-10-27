import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * BK-016: the booker adds or corrects each guest's name and answers from their manage link,
 * until online sales close, confirming everyone is happy to share their details (BK-017).
 */

const GUEST_A = '44444444-4444-4444-8444-444444444441'
const GUEST_B = '44444444-4444-4444-8444-444444444442'
const QUESTION = '22222222-2222-4222-8222-222222222222'

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: vi.fn(), rpc: vi.fn() }) }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/lib/events/manage-booking', () => ({
  getEventManagePreviewByRawToken: mocks.preview,
  createSeatIncreaseCheckoutByManageToken: vi.fn(),
  getEventRefundPolicy: vi.fn(),
  processEventRefund: vi.fn(),
  updateEventBookingSeatsByRawToken: vi.fn(),
}))
vi.mock('@/lib/events/guest-details-server', () => ({ loadBookingGuestDetails: mocks.load, saveBookingGuestDetails: mocks.save }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/google-calendar-events', () => ({ syncPubOpsEventCalendarByBookingId: vi.fn(), syncPubOpsEventCalendarByEventId: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { POST } from '@/app/g/[token]/manage-booking/action/route'

function form(fields: Array<[string, string]>) {
  return new NextRequest('http://localhost/g/raw-token/manage-booking/action', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams([['intent', 'update_guest_details'], ...fields]),
  })
}

const filled: Array<[string, string]> = [
  ['guest_id', GUEST_A], ['guest_name_0', 'Ann Guest'], [`answer_0_${QUESTION}`, 'Peanuts'],
  ['guest_id', GUEST_B], ['guest_name_1', 'Bo Guest'], [`answer_1_${QUESTION}`, ''],
  ['details_confirmed', 'yes'],
]

function stateOf(response: Response): Record<string, string> {
  return Object.fromEntries(new URL(response.headers.get('location') ?? '').searchParams)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.preview.mockResolvedValue({
    state: 'ready', booking_id: 'booking-1', customer_id: 'customer-1', event_id: 'event-1', status: 'confirmed',
    event_start_datetime: '2099-11-20T19:00:00Z', payment_mode: 'prepaid', seats: 2,
  })
  mocks.load.mockResolvedValue({ booking: { id: 'booking-1', attendees: [] }, questions: [], event: { salesCutoff: null } })
  mocks.save.mockResolvedValue({ ok: true, eventId: 'event-1', guestCount: 2, created: true, questionsAdded: 0 })
})

describe('guest manage link: guest details', () => {
  it('saves each guest in order, stamped with the booker\'s confirmation', async () => {
    const response = await POST(form(filled), { params: Promise.resolve({ token: 'raw-token' }) })
    expect(stateOf(response)).toEqual({ state: 'guest_details_saved' })
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), 'booking-1', [
      { id: GUEST_A, name: 'Ann Guest', answers: { [QUESTION]: 'Peanuts' } },
      { id: GUEST_B, name: 'Bo Guest', answers: { [QUESTION]: '' } },
    ], { confirmedAt: expect.any(String) })
  })

  it('records the change with counts only', async () => {
    await POST(form(filled), { params: Promise.resolve({ token: 'raw-token' }) })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'event_booking', resource_id: 'booking-1',
      additional_info: { field: 'guest_details', actor: 'guest_manage_link', guest_count: 2, created: true },
    }))
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toMatch(/Peanuts|Ann Guest/)
  })

  it('needs the booker to confirm everyone is happy to share their details', async () => {
    const response = await POST(form(filled.filter(([key]) => key !== 'details_confirmed')), { params: Promise.resolve({ token: 'raw-token' }) })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'guest_details_unconfirmed' })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('is closed once online sales have closed', async () => {
    mocks.load.mockResolvedValue({ booking: { id: 'booking-1', attendees: [] }, questions: [], event: { salesCutoff: '2000-01-01T00:00:00Z' } })
    const response = await POST(form(filled), { params: Promise.resolve({ token: 'raw-token' }) })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'guest_details_closed' })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('refuses a guest with no name before saving anything', async () => {
    const response = await POST(form(filled.map(([key, value]) => [key, key === 'guest_name_1' ? ' ' : value])), { params: Promise.resolve({ token: 'raw-token' }) })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'guest_details_invalid' })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('says the booking changed when someone else saved first', async () => {
    mocks.save.mockResolvedValue({ ok: false, error: 'Someone else changed this booking. Refresh before saving.', reason: 'conflict' })
    const response = await POST(form(filled), { params: Promise.resolve({ token: 'raw-token' }) })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'guest_details_changed' })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
