import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'


const state = vi.hoisted(() => ({ db: null as any, itemsAtCheck: [] as string[][] }))

vi.mock('@/services/private-bookings/readiness', async (importOriginal) =>
  (await import('../helpers/readyHire')).readyHireReadiness(importOriginal))
vi.mock('@/services/private-bookings/contract-terms-check', () => ({
  withdrawOutOfDateContractRequests: vi.fn(async () => {
    // What the check would compare: the items as stored at the moment it runs.
    state.itemsAtCheck.push(state.db.tables.private_booking_items.map((row: { description: string }) => row.description))
    return null
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn(async () => ({ customerId: 'customer-1' })) }))
vi.mock('@/lib/private-bookings/messenger', () => ({
  sendPrivateBookingMessage: vi.fn(async () => ({ success: true, sent: true, channel: 'email' })),
}))
vi.mock('@/services/private-bookings/conflicts', () => ({
  getBookingConflictSummary: vi.fn(async () => []),
  getBookingSpaceIds: vi.fn(async () => []),
  findBookingConflicts: vi.fn(async () => []),
  checkCapacity: vi.fn(() => ({ ok: true })),
}))

import { PrivateBookingService } from '@/services/private-bookings'

/**
 * BK-154, D25: the contract-terms check must see the booking as it ends up. Switching on
 * high-power equipment adds a £25 electricity line after the save, which moves the price, so the
 * check runs after that line is written, and runs at all even when no other term changed.
 */

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1', status: 'confirmed', customer_id: 'customer-1', customer_first_name: 'Alex',
    customer_last_name: 'Smith', customer_name: 'Alex Smith', contact_phone: '+447700900123',
    contact_email: 'host@example.com', event_type: 'Birthday party', event_date: '2026-12-12',
    start_time: '19:00:00', end_time: '23:30:00', end_time_next_day: false, setup_date: null, setup_time: null,
    guest_count: 40, date_tbd: false, internal_notes: null, hold_expiry: null, deposit_amount: 250,
    deposit_paid_date: '2026-10-01', deposit_waived: false, deposit_confirmed_at: '2026-10-01T10:00:00.000Z',
    balance_due_date: '2026-11-28', calendar_event_id: null, risk_status: 'normal', high_power_equipment: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.itemsAtCheck = []
  state.db = createFakeSupabase({
    private_bookings: [bookingRow()],
    private_booking_items: [],
    private_booking_sms_queue: [],
    private_booking_audit: [],
    customers: [{ id: 'customer-1', email: 'alex@example.com', mobile_number: '+447700900123' }],
  })
  state.db.rpc = vi.fn(async () => ({ data: null, error: null }))
})

describe('the contract-terms check after a price-changing follow-up', () => {
  it('runs after the electricity line is added, so it sees the new price', async () => {
    await PrivateBookingService.updateBooking('booking-1', { high_power_equipment: true } as never, 'user-1')

    expect(state.itemsAtCheck).toEqual([[expect.stringMatching(/electric/i)]])
  })
})
