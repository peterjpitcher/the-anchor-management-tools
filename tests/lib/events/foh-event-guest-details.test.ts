import { describe, expect, it } from 'vitest'
import { fohEventBookingExtras, fohEventSeatCount } from '@/app/(authenticated)/table-bookings/foh/event-guest-details'
import { buildEventPaymentReminderText as buildEventPaymentReminderSms } from '@/lib/events/event-guest-texts'
import type { FohEventOption } from '@/app/(authenticated)/table-bookings/foh/types'

const base = { id: 'e', name: 'Quiz', date: '2026-01-01', time: '19:00', start_datetime: null, end_datetime: null, payment_mode: 'cash_only',
  price_per_seat: 5, capacity: 40, seated_capacity: null, standing_capacity: null, seats_remaining: 20, seated_remaining: null,
  standing_remaining: null, total_remaining: 20, is_full: false, booking_mode: 'general' } satisfies FohEventOption
const typed: FohEventOption = { ...base, ticket_types: [{ id: 'adult', name: 'Adult', price: 10 }, { id: 'child', name: 'Child', price: 5 }] }
const row = (name: string) => ({ id: `id-${name}`, name, phone: '', answers: {} })

// BK-141: the bar picks a ticket type per seat on events that offer more than one.
describe('FOH event booking extras', () => {
  it('takes seats from the basket when the event has ticket types', () => {
    expect(fohEventSeatCount({ option: typed, partySize: '9', quantities: { adult: '2', child: '1' } })).toBe(3)
    expect(fohEventBookingExtras({ option: typed, partySize: '9', quantities: { adult: '2', child: '1' }, guestRows: [] })).toEqual({
      ok: true, seats: 3, ticket_selections: [{ ticket_type_id: 'adult', quantity: 2 }, { ticket_type_id: 'child', quantity: 1 }],
    })
  })
  it('asks for a ticket when the basket is empty', () => {
    expect(fohEventBookingExtras({ option: typed, partySize: '2', quantities: {}, guestRows: [] })).toEqual({ ok: false, error: 'Choose at least one ticket' })
  })
  it('uses the seats typed when the event has one ticket type, and sends guest rows only when something was given', () => {
    expect(fohEventBookingExtras({ option: base, partySize: '2', quantities: undefined, guestRows: [] })).toEqual({ ok: true, seats: 2 })
    const extras = fohEventBookingExtras({ option: base, partySize: '2', quantities: undefined, guestRows: [row('Sam')] })
    expect(extras).toEqual({ ok: true, seats: 2, attendees: [{ id: 'id-Sam', name: 'Sam', answers: {} }, expect.objectContaining({ name: '', answers: {} })] })
  })
})

// BK-142: the reminder says what is held and until when, rendered with fixture data.
describe('event payment reminder wording', () => {
  it('says the seats are held until a time, not that a payment failed', () => {
    const text = buildEventPaymentReminderSms({ firstName: 'Pat', eventName: 'Tasting Night', heldUntil: 'Fri 20 Nov at 7pm', paymentLink: 'https://l.example/p' })
    expect(text).toBe('The Anchor: Hi Pat, your seats for Tasting Night are held until Fri 20 Nov at 7pm. Pay here: https://l.example/p')
    expect(text).not.toMatch(/try again|wasn't completed|undefined|NaN|Invalid Date/)
  })
  it('still reads when the hold time is unknown', () => {
    expect(buildEventPaymentReminderSms({ firstName: 'Pat', eventName: 'Quiz', heldUntil: null, paymentLink: 'https://l.example/p' }))
      .toBe('The Anchor: Hi Pat, your seats for Quiz are held for you. Pay here: https://l.example/p')
  })
})
