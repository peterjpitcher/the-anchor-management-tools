/**
 * Voucher reminder copy, rendered from fixtures.
 *
 * The reminder told every holder to "just show the card at the bar and we will sort you out".
 * Three of the seven voucher types cannot be used that way: Sunday roast for two, four quiz
 * tickets and four music bingo tickets all carry `requires_booking = true`, and their printed
 * terms say availability is not guaranteed without an advance booking. There was no phone
 * number in the email either, so a guest who needed to book had nothing to ring.
 */

import { describe, expect, it } from 'vitest'
import {
  buildVoucherReminderEmail,
  buildVoucherReminderSms,
} from '@/lib/vouchers/reminders'
import { countSmsSeptets, GSM7_SINGLE_SEGMENT_LIMIT } from '@/lib/sms/gsm7'
import { assertCleanRender, assertCleanText } from '../mocks/emailRenderChecks'

// A British Summer Time expiry, a Greenwich Mean Time one, and the day the clocks go back.
const BST_EXPIRY = { expiryDate: '2026-07-18', londonToday: '2026-07-11' }
const GMT_EXPIRY = { expiryDate: '2026-01-24', londonToday: '2026-01-17' }
const CLOCKS_BACK = { expiryDate: '2026-10-25', londonToday: '2026-10-18' }

const BASE = {
  kind: 'pre_expiry_7' as const,
  firstName: 'Sam',
  wonAtLabel: 'the quiz',
}

describe('voucher reminder email', () => {
  it('tells a booking-only holder to ring and book, not to turn up', () => {
    const email = buildVoucherReminderEmail({
      ...BASE,
      ...BST_EXPIRY,
      prizeLabel: 'Sunday roast for two',
      requiresBooking: true,
    })

    assertCleanRender(email)
    expect(email.text).toContain('Give us a ring on 01753 682707 to book')
    expect(email.text).toContain('availability is not guaranteed without one')
    expect(email.text).toContain('on or before 18 July')
    expect(email.text).not.toContain('show the card at the bar')
  })

  it('still tells a walk-up holder to show the card', () => {
    const email = buildVoucherReminderEmail({
      ...BASE,
      ...BST_EXPIRY,
      prizeLabel: 'A drink on us',
      requiresBooking: false,
    })

    assertCleanRender(email)
    expect(email.text).toContain('Just show the card at the bar and we will sort you out.')
    expect(email.text).not.toContain('to book')
  })

  it('puts the prize after a colon instead of inside the sentence', () => {
    // "Your A drink on us voucher is waiting at The Anchor" is what it used to read.
    const waiting = buildVoucherReminderEmail({
      ...BASE,
      ...BST_EXPIRY,
      prizeLabel: 'A drink on us',
      requiresBooking: false,
    })
    const lastCall = buildVoucherReminderEmail({
      ...BASE,
      ...BST_EXPIRY,
      kind: 'pre_expiry_3',
      prizeLabel: 'A drink on us',
      requiresBooking: false,
    })

    expect(waiting.subject).toBe('Your voucher is waiting at The Anchor: A drink on us')
    expect(lastCall.subject).toBe('Just a few days left to use your voucher: A drink on us')
  })

  it('carries the contact block in every reminder, booking or not', () => {
    for (const requiresBooking of [true, false]) {
      for (const kind of ['pre_expiry_7', 'pre_expiry_3'] as const) {
        const email = buildVoucherReminderEmail({
          ...BASE,
          ...GMT_EXPIRY,
          kind,
          prizeLabel: 'Four quiz tickets',
          requiresBooking,
        })

        assertCleanRender(email)
        expect(email.text).toContain('manager@the-anchor.pub')
        expect(email.html).toContain('href="tel:+441753682707"')
      }
    }
  })

  it('renders the expiry in London on the day the clocks go back', () => {
    const email = buildVoucherReminderEmail({
      ...BASE,
      ...CLOCKS_BACK,
      prizeLabel: 'Sunday roast for two',
      requiresBooking: true,
    })

    assertCleanRender(email)
    expect(email.text).toContain('25 October')
  })

  it('shows the year when the voucher expires in a later one', () => {
    const email = buildVoucherReminderEmail({
      ...BASE,
      expiryDate: '2027-01-09',
      londonToday: '2026-12-30',
      prizeLabel: 'A drink on us',
      requiresBooking: false,
    })

    assertCleanRender(email)
    expect(email.text).toContain('9 January 2027')
  })

  it('falls back to a greeting and a generic prize rather than printing nothing', () => {
    const email = buildVoucherReminderEmail({
      kind: 'pre_expiry_7',
      firstName: null,
      wonAtLabel: null,
      prizeLabel: null,
      ...GMT_EXPIRY,
      requiresBooking: true,
    })

    assertCleanRender(email)
    expect(email.text.startsWith('Hi there,')).toBe(true)
  })
})

describe('voucher reminder text message', () => {
  it('tells a booking-only holder to book ahead', () => {
    const body = buildVoucherReminderSms({
      ...BASE,
      ...BST_EXPIRY,
      prizeLabel: 'Sunday roast for two',
      requiresBooking: true,
    })

    assertCleanText(body)
    expect(body).toContain('Book ahead on 01753 682707')
    expect(body).not.toContain('Show the card')
  })

  it('still fits one segment when a booking is needed, even with a long prize', () => {
    const body = buildVoucherReminderSms({
      kind: 'pre_expiry_3',
      firstName: 'Bartholomew Fitzwilliam',
      wonAtLabel: 'the Tuesday night charity quiz at The Anchor',
      prizeLabel: 'Four tickets to any standard public music bingo night at The Anchor',
      ...CLOCKS_BACK,
      requiresBooking: true,
    })

    assertCleanText(body)
    expect(countSmsSeptets(body)).toBeLessThanOrEqual(GSM7_SINGLE_SEGMENT_LIMIT)
  })

  it('keeps the walk-up wording for a walk-up voucher', () => {
    const body = buildVoucherReminderSms({
      ...BASE,
      ...GMT_EXPIRY,
      prizeLabel: 'A drink on us',
      requiresBooking: false,
    })

    assertCleanText(body)
    expect(body).toContain('Show the card by 24 January')
    expect(countSmsSeptets(body)).toBeLessThanOrEqual(GSM7_SINGLE_SEGMENT_LIMIT)
  })
})
