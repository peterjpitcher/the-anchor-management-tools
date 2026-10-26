import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-018: an event payment in manual review told the guest "staff will contact you" and told
 * staff nothing. The alert goes to the manager once per booking and kind (alertMoneyNeedsAPerson),
 * links to the event page, names no guest, and marks the booking's open payment exceptions as
 * staff notified.
 */

const alertMoneyNeedsAPerson = vi.fn()
vi.mock('@/lib/money-alerts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/money-alerts')>()),
  alertMoneyNeedsAPerson: (...args: unknown[]) => alertMoneyNeedsAPerson(...args),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { alertEventPaymentNeedsAPerson } = await import('@/lib/events/payment-alerts')

function client() {
  const updates: Array<{ table: string; payload: unknown; filters: unknown[][] }> = []
  return {
    updates,
    supabase: {
      from(table: string) {
        const filters: unknown[][] = []
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = (...args: unknown[]) => { filters.push(['eq', ...args]); return chain }
        chain.is = (...args: unknown[]) => { filters.push(['is', ...args]); return chain }
        chain.maybeSingle = async () => ({ data: { event_id: 'event-1', events: { name: 'Tinsel & Tipples' } }, error: null })
        chain.update = (payload: unknown) => { updates.push({ table, payload, filters }); return chain }
        chain.then = (resolve: (value: unknown) => unknown) => resolve({ error: null })
        return chain
      },
    } as never,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('alertEventPaymentNeedsAPerson', () => {
  it('tells the manager once, with the event page, and marks open exceptions as staff notified', async () => {
    alertMoneyNeedsAPerson.mockResolvedValue({ sent: true, duplicate: false })
    const { supabase, updates } = client()

    await alertEventPaymentNeedsAPerson(supabase, {
      bookingId: 'booking-1',
      kind: 'manual_review',
      reason: 'capacity_unavailable_after_capture',
      amount: 80,
      orderId: 'ORDER-1',
      captureId: 'CAPTURE-1',
      source: 'website capture',
    })

    expect(alertMoneyNeedsAPerson).toHaveBeenCalledTimes(1)
    const alert = alertMoneyNeedsAPerson.mock.calls[0][1]
    expect(alert).toMatchObject({ domain: 'event_bookings', bookingId: 'booking-1', kind: 'manual_review', path: '/events/event-1' })
    expect(alert.title).toBe('Paid event booking needs a decision (£80.00)')
    expect(alert.summary).toContain('Tinsel & Tipples')
    expect(alert.summary).toContain('its places were taken by another guest after the payment hold ran out')
    expect(alert.context).toMatchObject({ 'Event booking': 'booking-1', Amount: '£80.00', 'PayPal capture': 'CAPTURE-1' })
    expect(updates).toEqual([{
      table: 'event_payment_exceptions',
      payload: { staff_notified_at: expect.any(String) },
      filters: [['eq', 'event_booking_id', 'booking-1'], ['eq', 'status', 'open'], ['is', 'staff_notified_at', null]],
    }])
  })

  it('marks nothing when the alert was not sent (already sent, or the email failed)', async () => {
    alertMoneyNeedsAPerson.mockResolvedValue({ sent: false, duplicate: true })
    const { supabase, updates } = client()

    await alertEventPaymentNeedsAPerson(supabase, { bookingId: 'booking-1', kind: 'capture_pending', source: 'test' })

    expect(updates).toEqual([])
  })
})
