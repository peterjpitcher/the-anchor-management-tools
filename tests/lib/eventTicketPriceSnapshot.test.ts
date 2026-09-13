import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ items: vi.fn(), locked: true }))
vi.mock('@/lib/events/ticket-type-queries', () => ({
  loadBookingItems: mocks.items, getDefaultTicketTypeId: async () => 'standard', bookingItemsAreMultiType: () => false,
  loadBookingItemsWithTypes: vi.fn(),
}))
vi.mock('@/lib/guest/tokens', () => ({ hashGuestToken: () => 'fixture', createGuestToken: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/events/manage-booking', () => ({ createEventManageToken: vi.fn() }))
import { getEventPaymentPreviewByRawToken } from '@/lib/events/event-payments'

function client(): SupabaseClient {
  const expires = new Date(Date.now() + 600_000).toISOString()
  const rows: Record<string, object> = {
    guest_tokens: { id: 'token', event_booking_id: 'booking', customer_id: 'buyer', expires_at: expires },
    bookings: { id: 'booking', customer_id: 'buyer', event_id: 'event', seats: 2, status: 'pending_payment', hold_expires_at: expires, ticket_price_locked: mocks.locked },
    events: { id: 'event', name: 'Fixture', price: 45, payment_mode: 'prepaid', online_discount_type: 'fixed', online_discount_value: 5, online_discount_ends_at: '2000-01-01T00:00:00Z' },
  }
  return { from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: rows[table], error: null }) }
    return chain
  } } as unknown as SupabaseClient
}
beforeEach(() => {
  mocks.locked = true
  mocks.items.mockResolvedValue([{ quantity: 2, unit_price: 40, ticket_type_id: 'standard' }])
})
describe('held ticket payment price', () => {
  it('keeps the quoted total after the event discount expires', async () => {
    expect(await getEventPaymentPreviewByRawToken(client(), 'fixture')).toEqual(expect.objectContaining({ state: 'ready', totalAmount: 80, unitPrice: 40 }))
  })
  it('fails closed when the booked price cannot be read', async () => {
    mocks.items.mockRejectedValue(new Error('Unavailable'))
    await expect(getEventPaymentPreviewByRawToken(client(), 'fixture')).rejects.toThrow('Unavailable')
  })
  it('does not silently reprice a locked booking with missing items', async () => {
    mocks.items.mockResolvedValue([])
    await expect(getEventPaymentPreviewByRawToken(client(), 'fixture')).rejects.toThrow('booked ticket price')
  })
  it('preserves legacy single-ticket pricing instead of trusting old zero backfills', async () => {
    mocks.locked = false
    mocks.items.mockResolvedValue([{ quantity: 2, unit_price: 0, ticket_type_id: 'standard' }])
    expect(await getEventPaymentPreviewByRawToken(client(), 'fixture')).toEqual(expect.objectContaining({ state: 'ready', totalAmount: 90 }))
  })
})
