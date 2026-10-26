import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * BK-021 and owner decision D7: a guest's change to a paid booking reaches a manager, who
 * decides the refund starting from what the guest paid. The manager email is rendered here with
 * fixture data and checked for undefined, NaN, Invalid Date and zero amounts.
 */

const sent = vi.hoisted(() => ({ emails: [] as Array<{ to: string; subject: string; html: string }> }))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(async (email: { to: string; subject: string; html: string }) => { sent.emails.push(email); return { success: true } }),
}))
vi.mock('@/lib/api/idempotency', () => ({
  computeIdempotencyRequestHash: () => 'hash',
  claimIdempotencyKey: vi.fn(async () => ({ state: 'claimed' })),
  persistIdempotencyResponse: vi.fn(async () => undefined),
  releaseIdempotencyClaim: vi.fn(async () => undefined),
}))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.orangejelly.co.uk' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { describeGuestChangeRequest, netPaidAmount, raiseGuestChangeRequest } from '@/lib/events/guest-change-request'

function fakeSupabase(tables: Record<string, unknown[]>) {
  return {
    from: (table: string) => {
      const builder = {
        select: () => builder, eq: () => builder, in: () => builder,
        then: (resolve: (value: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null }),
      }
      return builder
    },
  }
}

const BAD = /undefined|NaN|Invalid Date|£0\.00/

beforeEach(() => {
  sent.emails = []
})

describe('netPaidAmount', () => {
  it('counts money taken, less refunds, and ignores failed payments', () => {
    expect(netPaidAmount([
      { charge_type: 'prepaid_event', status: 'succeeded', amount: 80 },
      { charge_type: 'prepaid_event', status: 'failed', amount: 80 },
      { charge_type: 'refund', status: 'succeeded', amount: 20 },
    ])).toBe(60)
    expect(netPaidAmount([])).toBe(0)
  })
})

describe('describeGuestChangeRequest', () => {
  it('starts the refund from what the guest paid, not the list price', () => {
    // Tinsel & Tipples: £45 list, £40 online. The old link refunded £45 a seat.
    const text = describeGuestChangeRequest({ eventName: 'Tinsel & Tipples', currentSeats: 4, requestedSeats: 2, paid: 160, unitPrices: [40, 40], refundRate: 1 })
    expect(text.suggestedRefund).toBe(80)
    expect(text.summary).toContain('They have paid £160.00 (£40.00 a ticket).')
    expect(text.summary).toContain('£80.00 for 2 tickets')
    expect(text.summary).toContain('You decide the refund, starting from what they paid')
    expect(text.summary).toContain('Nothing has been changed or refunded yet')
    expect(`${text.title} ${text.summary}`).not.toMatch(BAD)
  })

  it('halves it 3 to 6 days before and gives nothing under 3 days, as the ticket bands say', () => {
    expect(describeGuestChangeRequest({ eventName: 'Quiz', currentSeats: 3, requestedSeats: 2, paid: 30, unitPrices: [10], refundRate: 0.5 }).suggestedRefund).toBe(5)
    const late = describeGuestChangeRequest({ eventName: 'Quiz', currentSeats: 3, requestedSeats: 2, paid: 30, unitPrices: [10], refundRate: 0 })
    expect(late.suggestedRefund).toBe(0)
    expect(late.summary).toContain('fewer than 3 days before, so not refunded')
  })

  it('leaves the sum to the manager when tickets were sold at different prices', () => {
    const text = describeGuestChangeRequest({ eventName: null, currentSeats: 3, requestedSeats: 1, paid: 50, unitPrices: [20, 10], refundRate: 1 })
    expect(text.suggestedRefund).toBeNull()
    expect(text.summary).toContain('work the refund out from the ticket lines')
    expect(text.summary).not.toMatch(BAD)
  })

  it('says more places means taking payment', () => {
    const text = describeGuestChangeRequest({ eventName: 'Quiz', currentSeats: 2, requestedSeats: 4, paid: 20, unitPrices: [10], refundRate: 1 })
    expect(text.summary).toContain('Adding places means taking payment for them.')
    expect(text.suggestedRefund).toBeNull()
  })
})

describe('raiseGuestChangeRequest', () => {
  it('emails the manager inbox once, with ids and amounts and no guest details', async () => {
    const supabase = fakeSupabase({
      payments: [{ event_booking_id: 'booking-1', charge_type: 'prepaid_event', status: 'succeeded', payment_method: 'paypal', amount: 160 }],
      booking_items: [{ id: 'item', booking_id: 'booking-1', ticket_type_id: 't', quantity: 4, unit_price: 40, attendee_names: ['Ann Guest'] }],
    })
    const outcome = await raiseGuestChangeRequest(supabase as never, {
      bookingId: 'booking-1', eventId: 'event-1', eventName: 'Tinsel & Tipples', eventStart: '2099-11-20T19:00:00Z',
      currentSeats: 4, requestedSeats: 2,
    })
    expect(outcome).toMatchObject({ sent: true, duplicate: false, facts: { paid: 160, unitPrices: [40] } })
    expect(sent.emails).toHaveLength(1)
    const email = sent.emails[0]
    expect(email.to).toBe('manager@the-anchor.pub')
    expect(email.subject).toContain('A guest asked to change a paid event booking (4 to 2 places)')
    expect(email.html).toContain('Tinsel &amp; Tipples')
    expect(email.html).toContain('£80.00 for 2 tickets')
    expect(email.html).toContain('https://management.orangejelly.co.uk/events/event-1')
    expect(email.html).not.toMatch(BAD)
    expect(email.html).not.toContain('Ann Guest')
  })
})
