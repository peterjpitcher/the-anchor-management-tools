import { describe, expect, it } from 'vitest'
import { assertCleanGsmText, assertCleanText } from '../mocks/emailRenderChecks'
import { houseStyleErrors } from '@/lib/copy/house-style'
import { buildDepositConfirmedText } from '@/lib/table-bookings/guest-texts'
import { buildTableBookingDepositConfirmedEmail } from '@/lib/table-bookings/guest-emails'
import { depositReminder7DayMessage, privateBookingCreatedMessage } from '@/lib/private-bookings/messages'
import { buildDepositReminderEmail } from '@/lib/email/private-booking-emails'

/**
 * BK-171, owner decision D15: confirmations and money messages are calm and exact (SSOT section 1).
 * The table deposit confirmation and the private hire hold texts lost "Deposit sorted ... locked
 * in. See you then!", "quick nudge ... the date's yours" and the US spelling "penciled". Each is
 * rendered with fixture data, run through the house style and kept to its old segment count.
 */

const CASUAL = /sorted|locked in|see you then|quick nudge|date's yours|penciled|nice one|belter/i

function assertCalm(text: string): void {
  expect(text).not.toMatch(CASUAL)
  expect(houseStyleErrors(text)).toEqual([])
}

describe('table deposit confirmation', () => {
  const booking = {
    start_datetime: '2026-11-21T19:00:00.000Z',
    party_size: 16,
    is_outside_seating: false,
    high_chair_count: 1,
  }

  it('the text says the deposit is received and the table confirmed, in two segments as before', () => {
    const body = buildDepositConfirmedText({ booking, firstName: 'Pat', manageLink: 'https://l.the-anchor.pub/abc123' })
    assertCleanGsmText(body)
    assertCalm(body)
    expect(body).toBe("The Anchor: Pat, we've received your deposit. Your table for 16 people on Sat 21 Nov, 7:00 pm is confirmed. High chair reserved x1. https://l.the-anchor.pub/abc123")
    expect(body.length).toBeLessThanOrEqual(306)
  })

  it('the email says the same', () => {
    const email = buildTableBookingDepositConfirmedEmail({
      firstName: 'Pat',
      bookingReference: 'TB-0001',
      bookingDate: '2026-11-21',
      bookingTime: '19:00',
      startDateTime: '2026-11-21T19:00:00.000Z',
      partySize: 16,
      highChairCount: 1,
      depositPaid: 160,
      manageLink: 'https://l.the-anchor.pub/abc123',
    })
    for (const part of [email.subject, email.text]) assertCleanText(part)
    assertCalm(email.text)
    expect(email.text).toContain("Hi Pat, we've received your deposit. Your table for 16 people on ")
  })
})

describe('private hire hold texts', () => {
  it('"pencilled", in British spelling', () => {
    const body = privateBookingCreatedMessage({ customerFirstName: 'Alex', eventDate: '3 October 2026', depositAmount: 250, holdExpiry: '19 September 2026' })
    assertCleanGsmText(body)
    assertCalm(body)
    expect(body).toContain('is pencilled in.')
  })

  it('the 7-day deposit reminder is a plain reminder, still one segment', () => {
    const body = depositReminder7DayMessage({ customerFirstName: 'Alex', eventDate: '3 October 2026', depositAmount: 250, daysRemaining: 7, holdExpiry: '19 September 2026' })
    assertCleanGsmText(body)
    assertCalm(body)
    expect(body).toBe('Hi Alex, a reminder that your hold on 3 October 2026 expires in 7 days, on 19 September 2026. Pay the £250 deposit to keep the date.')
    expect(body.length).toBeLessThanOrEqual(160)
  })

  it('its email says the same', () => {
    const email = buildDepositReminderEmail({
      booking: { id: 'pb-1', event_date: '2026-10-03', start_time: '18:00' },
      firstName: 'Alex',
      stage: '7day',
      depositAmount: 250,
      holdExpiry: '19 September 2026',
      daysRemaining: 7,
    })
    assertCleanText(email.text)
    assertCalm(email.text)
    expect(email.text).toContain('A reminder that your hold')
    expect(email.text).toContain('Pay the £250 deposit to keep the date.')
  })
})
