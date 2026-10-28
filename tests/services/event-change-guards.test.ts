import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EventService } from '@/services/events'
import { EMPTY_EVENT_BOOKING_IMPACT, type EventBookingImpact } from '@/lib/events/event-change-guard'

/*
 * Release 16 of the customer bookings review (BK-026, BK-027, BK-035, BK-036, BK-073; owner
 * decisions D8 and D9). EventService.updateEvent decides, before anything is written, whether an
 * edit goes through, needs a manager to confirm who it affects, or is refused.
 */

const impact = vi.hoisted(() => ({ value: null as EventBookingImpact | null, calls: 0 }))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/events/event-change-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/event-change-guard')>()
  return {
    ...actual,
    loadEventBookingImpact: vi.fn(async () => {
      impact.calls += 1
      return impact.value ?? actual.EMPTY_EVENT_BOOKING_IMPACT
    }),
  }
})

const current = {
  id: 'event',
  name: 'Quiz Night',
  date: '2099-09-25',
  time: '19:00:00',
  end_time: '22:00:00',
  slug: 'quiz-night-2099-09-25',
  event_status: 'scheduled',
  is_free: false,
  price: 5,
  payment_mode: 'cash_only',
  booking_mode: 'general',
  capacity: 60,
  short_description: 'A quiz',
  hero_image_url: 'https://example.com/a.png',
  thumbnail_image_url: 'https://example.com/a.png',
  poster_image_url: 'https://example.com/a.png',
}

function booked(overrides: Partial<EventBookingImpact> = {}): EventBookingImpact {
  return { ...EMPTY_EVENT_BOOKING_IMPACT, activeBookings: 3, activeSeats: 7, reachableByEmail: 2, unreachable: 1, ...overrides }
}

function clientFor(row: Record<string, unknown>) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Fixture stops before mutation' } })
  // The duplicate-slug check is the read that calls neq; it finds no other event.
  let slugCheck = false
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn(() => { slugCheck = true; return chain }),
    maybeSingle: vi.fn(async () => {
      const data = slugCheck ? null : row
      slugCheck = false
      return { data, error: null }
    }),
    in: vi.fn().mockResolvedValue({ count: 0, error: null }),
  }
  const from = vi.fn(() => chain)
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as unknown as SupabaseClient)
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof createAdminClient>)
  return { rpc }
}

describe('event change guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    impact.value = null
    impact.calls = 0
  })

  it('reads no booking counts for an edit that touches nothing guests rely on', async () => {
    const { rpc } = clientFor(current)
    await expect(EventService.updateEvent('event', { name: 'Quiz Night Special' })).rejects.toThrow('Failed to update event')
    expect(impact.calls).toBe(0)
    expect(rpc).toHaveBeenCalledWith('update_event_transaction', expect.anything())
  })

  it('refuses Cancelled or Postponed through a plain save, so a manager always sees who is affected first (BK-026)', async () => {
    const { rpc } = clientFor(current)
    await expect(EventService.updateEvent('event', { event_status: 'cancelled' })).rejects.toThrow('Use Cancel event')
    await expect(EventService.updateEvent('event', { event_status: 'postponed' })).rejects.toThrow('Use Postpone event')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lets the Cancel event action set the status once it has confirmed', async () => {
    impact.value = booked()
    const { rpc } = clientFor(current)
    await expect(EventService.updateEvent('event', { event_status: 'cancelled' }, { lifecycleAction: true, confirmedChanges: true })).rejects.toThrow('Failed to update event')
    expect(rpc.mock.calls[0][1].p_event_data.event_status).toBe('cancelled')
  })

  it('locks the payment method once anyone has booked (D9)', async () => {
    impact.value = booked()
    const { rpc } = clientFor(current)
    await expect(EventService.updateEvent('event', { payment_mode: 'prepaid' }, { confirmedChanges: true })).rejects.toThrow('payment method is locked')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lets the payment method change while nobody has booked', async () => {
    const { rpc } = clientFor(current)
    await expect(EventService.updateEvent('event', { payment_mode: 'prepaid' })).rejects.toThrow('Failed to update event')
    expect(rpc.mock.calls[0][1].p_event_data.payment_mode).toBe('prepaid')
  })

  it('asks a manager to confirm a date change that tells booked guests, and says who must be rung', async () => {
    impact.value = booked()
    const { rpc } = clientFor(current)
    const error = await EventService.updateEvent('event', { date: '2099-10-02' }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ name: 'EventChangeNeedsConfirmationError' })
    const lines = (error as { confirmations: string[] }).confirmations
    expect(lines[0]).toContain('3 bookings (7 seats) will be told the new date and time')
    expect(lines[0]).toContain('2 by email')
    expect(lines[0]).toContain('1 booking has no email or textable mobile, so ring that guest')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('saves the date change once the manager has confirmed it', async () => {
    impact.value = booked()
    const { rpc } = clientFor(current)
    await expect(EventService.updateEvent('event', { date: '2099-10-02' }, { confirmedChanges: true })).rejects.toThrow('Failed to update event')
    expect(rpc.mock.calls[0][1].p_event_data.date).toBe('2099-10-02')
  })

  it('confirms a price change on a booked night, which applies to new sales only', async () => {
    impact.value = booked()
    clientFor(current)
    const error = await EventService.updateEvent('event', { price: 8 }).catch((caught: unknown) => caught)
    expect((error as { confirmations: string[] }).confirmations).toEqual([
      '3 bookings (7 seats) keep the price they booked at. The new price applies to new sales only.',
    ])
  })

  it('confirms a ticket limit below the seats already sold', async () => {
    impact.value = booked()
    clientFor(current)
    const error = await EventService.updateEvent('event', { capacity: 5 }).catch((caught: unknown) => caught)
    expect((error as { confirmations: string[] }).confirmations[0]).toContain('7 seats are already sold, so a limit of 5 closes sales')
  })

  it('refuses to move a seated night with bookings until its tables can move with it (BK-073)', async () => {
    impact.value = booked({ seatedBookings: 2 })
    const { rpc } = clientFor({ ...current, booking_mode: 'table' })
    await expect(EventService.updateEvent('event', { date: '2099-10-02' }, { confirmedChanges: true })).rejects.toThrow('This event has seated bookings')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reopens bookings when a cancelled night is reinstated, after confirming refunds are not reversed (BK-035)', async () => {
    const { rpc } = clientFor({ ...current, event_status: 'cancelled' })
    const error = await EventService.updateEvent('event', { event_status: 'scheduled' }).catch((caught: unknown) => caught)
    expect((error as { confirmations: string[] }).confirmations[0]).toContain('refunds already made are not reversed')
    await expect(EventService.updateEvent('event', { event_status: 'scheduled' }, { confirmedChanges: true })).rejects.toThrow('Failed to update event')
    expect(rpc.mock.calls[0][1].p_event_data).toMatchObject({ event_status: 'scheduled', booking_open: true })
  })

  it('shows the lock message when the database refuses a payment method change', async () => {
    const { rpc } = clientFor(current)
    rpc.mockResolvedValue({ data: null, error: { message: 'event_payment_mode_locked' } })
    await expect(EventService.updateEvent('event', { name: 'Renamed' })).rejects.toThrow('payment method is locked')
  })
})
