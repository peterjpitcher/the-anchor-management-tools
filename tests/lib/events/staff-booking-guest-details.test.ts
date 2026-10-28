import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/events/ticket-type-queries', () => ({
  getDefaultTicketTypeId: vi.fn(async () => 'adult'),
  decideTicketSelectionHandling: vi.fn(() => ({ kind: 'apply' })),
}))

import { carryGuestsToTransfer, prepareStaffEventBooking } from '@/lib/events/staff-booking-guest-details'

const QUESTION = { id: '33333333-3333-4333-8333-333333333333', label: 'Any allergies?', type: 'text', required: true }
const db = (event: Record<string, unknown> | null) => {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.maybeSingle = async () => ({ data: event, error: null })
  return { from: () => builder } as never
}
const guest = (id: string, name: string, answers: Record<string, string> = {}) => ({ id, name, answers })

// BK-011, BK-141, owner decision D5.
describe('prepareStaffEventBooking', () => {
  it('flags details to follow on an event that needs them when a name or required answer is blank', async () => {
    const result = await prepareStaffEventBooking(db({ payment_mode: 'prepaid', collect_guest_details: null, booking_questions: [QUESTION] }), {
      eventId: 'e', seats: 2,
      attendees: [guest('11111111-1111-4111-8111-111111111111', 'Sam', { [QUESTION.id]: 'None' }), guest('22222222-2222-4222-8222-222222222222', '')],
    })
    expect(result).toMatchObject({ ok: true, guestDetailsRequired: true, detailsToFollow: true })
  })

  it('treats no guest rows on such an event as details to follow, and none needed on a pay-on-arrival event', async () => {
    expect(await prepareStaffEventBooking(db({ payment_mode: 'prepaid', booking_questions: [] }), { eventId: 'e', seats: 2 }))
      .toMatchObject({ ok: true, attendees: undefined, detailsToFollow: true })
    expect(await prepareStaffEventBooking(db({ payment_mode: 'cash_only', booking_questions: [] }), { eventId: 'e', seats: 2 }))
      .toMatchObject({ ok: true, guestDetailsRequired: false, detailsToFollow: false })
  })

  it('gives each guest the ticket type of their seat in the basket', async () => {
    const result = await prepareStaffEventBooking(db({ payment_mode: 'cash_only', booking_questions: [] }), {
      eventId: 'e', seats: 3, ticketSelections: [{ ticketTypeId: 'adult', quantity: 2 }, { ticketTypeId: 'child', quantity: 1 }],
      attendees: [guest('11111111-1111-4111-8111-111111111111', 'A'), guest('22222222-2222-4222-8222-222222222222', 'B'), guest('33333333-3333-4333-8333-333333333334', 'C')],
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.attendees?.map((row) => row.ticket_type_id)).toEqual(['adult', 'adult', 'child'])
    expect(result.ticketSelections).toEqual([{ ticket_type_id: 'adult', quantity: 2 }, { ticket_type_id: 'child', quantity: 1 }])
  })

  it('refuses a basket that does not add up to the seats', async () => {
    expect(await prepareStaffEventBooking(db({ payment_mode: 'cash_only' }), { eventId: 'e', seats: 3, ticketSelections: [{ ticketTypeId: 'adult', quantity: 2 }] }))
      .toEqual({ ok: false, error: 'Ticket quantities (2) must match the total seats (3).' })
  })
})

// BK-011 step 6: a transferred booking keeps its guests.
describe('carryGuestsToTransfer', () => {
  it('keeps each guest name and own mobile, drops the old event answers and gives new ids', () => {
    let n = 0
    const carried = carryGuestsToTransfer([
      { id: 'old-1', name: ' Sam ', phone: '+447700900123', ticket_type_id: 'old-type', answers: [{ question_id: 'q', value: 'Nuts' }] },
      { id: 'old-2', name: 'Jo', answers: [] },
    ], () => `new-${++n}`)
    expect(carried).toEqual([
      { id: 'new-1', name: 'Sam', phone: '+447700900123', answers: {} },
      { id: 'new-2', name: 'Jo', answers: {} },
    ])
  })
  it('carries nothing from a booking without guest rows', () => {
    expect(carryGuestsToTransfer(null)).toBeUndefined()
    expect(carryGuestsToTransfer([])).toBeUndefined()
  })
})
