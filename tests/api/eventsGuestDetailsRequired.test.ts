import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * BK-014, customer bookings review of 24 October 2026. The website worked out for itself whether
 * to ask for each ticket's name and answers, and its rule disagreed with the booking route and the
 * database. /api/events now hands it the answer, from the event's own setting.
 */

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: (req: Request, key: unknown) => Promise<Response>, _permissions: string[], req?: Request) => handler(req ?? new Request('http://localhost/api/events'), {})),
  createApiResponse: vi.fn((data: unknown, status = 200) => Response.json({ success: true, data }, { status })),
  createErrorResponse: vi.fn((message: string, code: string, status = 400) => Response.json({ success: false, error: { code, message } }, { status })),
  createCorsPreflightResponse: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/events/route'
import { FakeDb } from '../lib/insights/helpers/fake-db'

const event = (id: string, payment_mode: string, collect_guest_details: boolean | null) => ({
  id, name: id, slug: id, date: '2099-11-20', time: '19:00', booking_mode: 'general', capacity: 40,
  event_status: 'scheduled', bookings_enabled: true, price: 45, is_free: payment_mode === 'free',
  payment_mode, collect_guest_details, booking_questions: [], event_faqs: [], category: null,
})

describe('events list guest_details_required', () => {
  beforeEach(() => vi.clearAllMocks())

  it('says whether to ask for each guest, from the event setting and its default', async () => {
    const events = [
      event('prepaid-default', 'prepaid', null),
      event('arrival-default', 'cash_only', null),
      event('arrival-switched-on', 'cash_only', true),
      event('prepaid-switched-off', 'prepaid', false),
      event('free', 'free', null),
    ]
    const db = new FakeDb({ events, event_ticket_types: [] })
    db.rpcHandlers.get_event_capacity_snapshot_v05 = () => events.map((row) => ({
      event_id: row.id, capacity: 40, seats_remaining: 40, total_remaining: 40, is_full: false,
    }))
    vi.mocked(createAdminClient).mockReturnValue(db.asDb())

    const response = await GET(new NextRequest('https://management.orangejelly.co.uk/api/events'))
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { events: Array<{ id: string; guest_details_required: boolean }> } }
    expect(Object.fromEntries(body.data.events.map((row) => [row.id, row.guest_details_required]))).toEqual({
      'prepaid-default': true,
      'arrival-default': false,
      'arrival-switched-on': true,
      'prepaid-switched-off': false,
      free: false,
    })
  })
})

// BK-035, BK-089 (owner decision D11): one "can a guest book this online now?" answer, so the
// website hides the form whenever AMS would refuse.
describe('events list bookable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is false when Accept bookings is off, sales have closed or the night is closed, and true otherwise', async () => {
    const events = [
      event('open', 'cash_only', null),
      { ...event('switched-off', 'cash_only', null), bookings_enabled: false },
      { ...event('sales-closed', 'cash_only', null), booking_cutoff_at: '2020-01-01T00:00:00.000Z' },
      { ...event('reinstated-but-closed', 'cash_only', null), booking_open: false },
    ]
    const db = new FakeDb({ events, event_ticket_types: [] })
    db.rpcHandlers.get_event_capacity_snapshot_v05 = () => events.map((row) => ({
      event_id: row.id, capacity: 40, seats_remaining: 40, total_remaining: 40, is_full: false,
    }))
    vi.mocked(createAdminClient).mockReturnValue(db.asDb())

    const response = await GET(new NextRequest('https://management.orangejelly.co.uk/api/events'))
    const body = await response.json() as { data: { events: Array<{ id: string; bookable: boolean; booking_closed_reason: string | null; bookings_enabled: boolean }> } }
    const byId = Object.fromEntries(body.data.events.map((row) => [row.id, [row.bookable, row.booking_closed_reason]]))
    expect(byId).toEqual({
      open: [true, null],
      'switched-off': [false, 'bookings_disabled'],
      'sales-closed': [false, 'sales_closed'],
      'reinstated-but-closed': [false, 'booking_closed'],
    })
    // The fields the live website reads today keep their meaning.
    expect(body.data.events.find((row) => row.id === 'sales-closed')?.bookings_enabled).toBe(true)
  })
})
