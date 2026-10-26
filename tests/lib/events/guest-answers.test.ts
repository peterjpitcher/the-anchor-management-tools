import { describe, expect, it } from 'vitest'
import { doorPaymentLabel, isOnDoorList } from '@/lib/events/door-list'
import { eventBookingReference, hasGuestAnswers, summariseGuestAnswers } from '@/lib/events/guest-answers'
import { generateKitchenSummaryPdf } from '@/lib/events/kitchen-summary-pdf'

/*
 * BK-015 and BK-030, customer bookings review of 24 October 2026: guests' answers reach the door
 * and the kitchen, and every staff list agrees on who is coming and what they have paid.
 */

const ALLERGY = { id: 'q-allergy', label: 'Any allergies?', type: 'text' as const, required: true }
const ACCESS = { id: 'q-access', label: 'Step-free access?', type: 'yes_no' as const, required: false }
const guest = (name: string, allergy: string, access = '') => ({
  id: `g-${name}`, name, ticket_type_id: null,
  answers: [
    { question_id: ALLERGY.id, label: ALLERGY.label, type: 'text', required: true, value: allergy },
    { question_id: ACCESS.id, label: ACCESS.label, type: 'yes_no', required: false, value: access },
  ],
})

describe('isOnDoorList', () => {
  it('keeps everyone who may come, and leaves off cancelled bookings, lapsed holds and reminders', () => {
    expect(isOnDoorList({ status: 'confirmed', seats: 2 })).toBe(true)
    expect(isOnDoorList({ status: 'pending_payment', seats: 2 })).toBe(true)
    expect(isOnDoorList({ status: 'completed', seats: 2 })).toBe(true)
    expect(isOnDoorList({ status: 'visited_waiting_for_review', seats: 2 })).toBe(true)
    expect(isOnDoorList({ status: 'cancelled', seats: 2 })).toBe(false)
    expect(isOnDoorList({ status: 'expired', seats: 2 })).toBe(false)
    expect(isOnDoorList({ status: 'confirmed', seats: 2, is_reminder_only: true })).toBe(false)
    expect(isOnDoorList({ status: 'confirmed', seats: 0 })).toBe(false)
  })
})

describe('doorPaymentLabel', () => {
  const prepaid = { paymentMode: 'prepaid', isFree: false, amountDue: 90 }
  it('says paid online only when PayPal took the money', () => {
    expect(doorPaymentLabel({ ...prepaid, payments: [{ charge_type: 'prepaid_event', status: 'succeeded', payment_method: 'paypal', amount: 90 }] })).toBe('Paid online')
    expect(doorPaymentLabel({ ...prepaid, payments: [{ charge_type: 'prepaid_event', status: 'failed', payment_method: 'paypal', amount: 90 }] })).toBe('Not paid yet: £90.00 due')
    expect(doorPaymentLabel({ ...prepaid, payments: [] })).toBe('Not paid yet: £90.00 due')
  })
  it('names a payment taken in the pub', () => {
    expect(doorPaymentLabel({ ...prepaid, payments: [{ status: 'succeeded', payment_method: 'cash', amount: 90 }] })).toBe('Paid in cash')
    expect(doorPaymentLabel({ ...prepaid, payments: [{ status: 'succeeded', payment_method: 'card_terminal', amount: 90 }] })).toBe('Paid by card')
    expect(doorPaymentLabel({ ...prepaid, payments: [{ status: 'succeeded', payment_method: 'comp', amount: 0 }] })).toBe('No charge')
  })
  it('never counts a refund row as paid', () => {
    expect(doorPaymentLabel({ ...prepaid, payments: [{ charge_type: 'refund', status: 'succeeded', payment_method: 'paypal', amount: 90 }] })).toBe('Not paid yet: £90.00 due')
  })
  it('keeps the old wording for free and pay-on-the-night events', () => {
    expect(doorPaymentLabel({ paymentMode: 'free', isFree: true, amountDue: 0, payments: [] })).toBe('Free')
    expect(doorPaymentLabel({ paymentMode: 'cash_only', isFree: false, amountDue: 10, payments: [] })).toBe('Cash on arrival')
  })
})

describe('summariseGuestAnswers', () => {
  const bookings = [
    { id: '11111111-aaaa', reference: eventBookingReference('11111111-aaaa'), bookerName: 'Pat Booker', notes: 'UNCONFIRMED REQUEST: food before the event',
      attendees: [guest('Ann', 'Peanuts', 'yes'), guest('Bo', '')] },
    { id: '22222222-bbbb', reference: eventBookingReference('22222222-bbbb'), bookerName: 'Cat Booker', notes: null,
      attendees: [guest('Cat', 'None')] },
  ]

  it('groups every answer by question, with who gave it and the booking reference', () => {
    const summary = summariseGuestAnswers(bookings, [ALLERGY, ACCESS])
    expect(summary.guests).toBe(3)
    const allergy = summary.questions.find((question) => question.questionId === ALLERGY.id)!
    expect(allergy.answered).toEqual([
      { reference: 'ANC-11111111', guestName: 'Ann', value: 'Peanuts' },
      { reference: 'ANC-22222222', guestName: 'Cat', value: 'None' },
    ])
    const access = summary.questions.find((question) => question.questionId === ACCESS.id)!
    expect(access.answered).toEqual([{ reference: 'ANC-11111111', guestName: 'Ann', value: 'Yes' }])
  })

  it('flags a required answer that is still blank', () => {
    const allergy = summariseGuestAnswers(bookings, [ALLERGY]).questions[0]
    expect(allergy.missingRequired).toEqual([{ reference: 'ANC-11111111', guestName: 'Bo' }])
  })

  it('lists the booking notes and marks an online request as unconfirmed', () => {
    expect(summariseGuestAnswers(bookings).notes).toEqual([
      { reference: 'ANC-11111111', bookerName: 'Pat Booker', note: 'UNCONFIRMED REQUEST: food before the event', unconfirmedRequest: true },
    ])
  })

  it('lists a current question nobody has answered yet', () => {
    const summary = summariseGuestAnswers([], [ALLERGY])
    expect(summary.questions).toEqual([{ questionId: ALLERGY.id, label: ALLERGY.label, required: true, answered: [], missingRequired: [] }])
  })

  it('knows when a booking has any answer', () => {
    expect(hasGuestAnswers([guest('Ann', 'Peanuts')])).toBe(true)
    expect(hasGuestAnswers([guest('Bo', '')])).toBe(false)
    expect(hasGuestAnswers([])).toBe(false)
    expect(hasGuestAnswers(null)).toBe(false)
  })
})

describe('generateKitchenSummaryPdf', () => {
  it('renders a long list with any characters a guest types', async () => {
    const many = Array.from({ length: 80 }, (_, index) => guest(`Guest ${index} 王`, index % 2 ? 'Nut allergy 😀' : 'Coeliac, NGCI only please'))
    const summary = summariseGuestAnswers([{ id: 'x', reference: 'ANC-X', bookerName: 'Big Group', attendees: many, notes: 'UNCONFIRMED REQUEST: arriving early' }], [ALLERGY, ACCESS])
    const pdf = await generateKitchenSummaryPdf({ name: 'Tinsel & Tipples', dateLabel: 'Friday 20 November 2026', timeLabel: '7:00pm' }, summary)
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  })
})
