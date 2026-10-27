import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The door check-in kiosk on paid nights and its privacy (BK-032, BK-011, BK-202; owner decision
 * D12): unpaid guests and walk-ins on a night paid in advance are sent to the bar, the kiosk books
 * no walk-in on a night that asks required questions, and a lookup returns only what the screen
 * shows, for this event's bookers only.
 */
const state = vi.hoisted(() => ({
  event: {} as Record<string, unknown>,
  customer: null as Record<string, unknown> | null,
  booking: null as Record<string, unknown> | null,
  checkIn: null as Record<string, unknown> | null,
  items: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ table: string; row: unknown }>,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'staff-1', email: 's@example.test' } } }) } }) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/consent/staff-capture', () => ({ recordStaffReadOutConsent: vi.fn() }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn(async () => ({ customerId: 'customer-1' })) }))
vi.mock('@/lib/unified-job-queue', () => ({ jobQueue: { enqueue: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
const { createBooking } = vi.hoisted(() => ({ createBooking: vi.fn() }))
vi.mock('@/services/event-bookings', () => ({ EventBookingService: { createBooking, normalizeBookingMode: () => 'general' } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => {
  const builder: Record<string, unknown> = {}
  const rows = (): unknown => {
    if (table === 'events') return state.event
    if (table === 'customers') return state.customer ? [state.customer] : []
    if (table === 'bookings') return state.booking
    if (table === 'event_check_ins') return state.checkIn
    if (table === 'booking_items') return state.items
    return null
  }
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'not', 'update', 'neq', 'gte', 'lte', 'lt', 'gt', 'is', 'upsert', 'delete']) builder[method] = () => builder
  builder.insert = (row: unknown) => { state.inserts.push({ table, row }); return builder }
  builder.single = async () => ({ data: { id: 'new-id' }, error: null })
  builder.maybeSingle = async () => ({ data: rows(), error: null })
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null })
  return builder
} }) }))

import { lookupEventGuest, registerKnownGuest, registerNewGuest } from '@/app/actions/event-check-in'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const baseEvent = { id: EVENT_ID, name: 'Tasting Night', date: '2026-11-20', time: '19:00', category_id: null, event_type: null, category: null }
const customer = { id: CUSTOMER_ID, first_name: 'Sam', last_name: 'Lee', mobile_number: '+447700900123', mobile_e164: '+447700900123', email: 'sam@example.test' }

beforeEach(() => {
  vi.clearAllMocks()
  state.event = { ...baseEvent, payment_mode: 'prepaid', collect_guest_details: null, booking_questions: [] }
  state.customer = customer
  state.booking = null
  state.checkIn = null
  state.items = []
  state.inserts = []
})

describe('kiosk lookup (BK-202)', () => {
  it('treats a known customer with no booking for this event as a new guest, revealing nothing', async () => {
    const result = await lookupEventGuest({ eventId: EVENT_ID, phone: '07700900123' })
    expect(result).toEqual({ success: true, status: 'unknown', normalizedPhone: '+447700900123' })
  })

  it('returns only an id and "Sam L." for a booker, never the email or mobile', async () => {
    state.event = { ...state.event, payment_mode: 'cash_only' }
    state.booking = { id: 'booking-1', seats: 2, status: 'confirmed', attendees: [] }
    const result = await lookupEventGuest({ eventId: EVENT_ID, phone: '07700900123' })
    if (!result.success || result.status !== 'known') throw new Error('expected a known guest')
    expect(result.data.customer).toEqual({ id: CUSTOMER_ID, displayName: 'Sam L.' })
    expect(JSON.stringify(result)).not.toContain('sam@example.test')
    expect(JSON.stringify(result.data)).not.toContain('+447700900123')
  })
})

describe('kiosk on a night paid in advance (BK-032, D12)', () => {
  it('tells an unpaid booker what is due and sends them to the bar', async () => {
    state.booking = { id: 'booking-1', seats: 2, status: 'pending_payment', attendees: [] }
    state.items = [{ quantity: 2, unit_price: 40 }]
    const result = await lookupEventGuest({ eventId: EVENT_ID, phone: '07700900123' })
    if (!result.success || result.status !== 'known') throw new Error('expected a known guest')
    expect(result.data.booking?.paymentDue).toEqual({ message: "Payment due: £80.00. Please see the bar and we'll check you in." })
  })

  it('will not check in an unpaid booker', async () => {
    state.booking = { id: 'booking-1', seats: 2, status: 'pending_payment', attendees: [] }
    const result = await registerKnownGuest({ eventId: EVENT_ID, phone: '07700900123', customerId: CUSTOMER_ID })
    expect(result).toEqual({ success: false, error: "Payment is due for this booking. Please see the bar and we'll check you in." })
    expect(state.inserts).toEqual([])
  })

  it('books no walk-in and sends them to the bar', async () => {
    const result = await registerNewGuest({ eventId: EVENT_ID, phone: '07700900999', firstName: 'Jo' })
    expect(result).toEqual({ success: false, error: "Tickets for tonight are paid for in advance. Please see the bar and we'll get you booked in." })
    expect(createBooking).not.toHaveBeenCalled()
    expect(state.inserts).toEqual([])
  })

  it('books no walk-in on a pay-on-arrival night that asks every guest a required question (BK-011)', async () => {
    state.event = { ...state.event, payment_mode: 'cash_only', collect_guest_details: true,
      booking_questions: [{ id: '33333333-3333-4333-8333-333333333333', label: 'Any allergies?', type: 'text', required: true }] }
    const result = await registerNewGuest({ eventId: EVENT_ID, phone: '07700900999', firstName: 'Jo' })
    expect(result).toEqual({ success: false, error: 'We need a few details from everyone tonight. Please see the bar to book.' })
    expect(createBooking).not.toHaveBeenCalled()
  })
})
