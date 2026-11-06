import { describe, expect, it } from 'vitest'
import { getPreorderCutoff } from './preorder'
import { buildPreorderGuestInviteEmail, formatPreorderCutoffForGuest, preorderClosedMessage } from './preorder-food-link-emails'
import { assertCleanRender } from '../../../tests/mocks/emailRenderChecks'

/**
 * The guest invite (D5, A4), rendered with fixture data in both zones (`npm test` pins
 * Europe/London, `npm run test:utc` runs UTC). `assertCleanRender` fails on undefined, Invalid
 * Date, NaN, a zero amount, a banned dash, a missing phone number or a missing sign-off.
 */

function cutoffFor(bookingDate: string): Date {
  const { closesAt } = getPreorderCutoff({ bookingDate, preorderCutoffDays: 7, now: new Date('2026-11-01T00:00:00Z') })
  if (!closesAt) throw new Error('fixture cutoff missing')
  return closesAt
}

describe('guest food link invite email', () => {
  it.each([
    { bookingDate: '2026-12-11', bookingTime: '19:00:00', moment: 'Friday 11 December 2026 at 7pm', deadline: 'noon on Friday 4 December 2026' },
    { bookingDate: '2026-12-01', bookingTime: '12:30:00', moment: 'Tuesday 1 December 2026 at 12:30pm', deadline: 'noon on Tuesday 24 November 2026' },
  ])('$bookingDate: says who asked, when, the deadline and the link', ({ bookingDate, bookingTime, moment, deadline }) => {
    const email = buildPreorderGuestInviteEmail({
      guestName: 'Fixture Sam Guest',
      organiserFirstName: 'Fixture',
      bookingDate,
      bookingTime,
      closesAt: cutoffFor(bookingDate),
      url: 'https://management.example.test/g/fixture-token/christmas-choice',
    })

    assertCleanRender(email)
    expect(email.text).toContain(`Hi Fixture, Fixture asked us to send you this link so you can choose your own Christmas dinner for their booking at The Anchor on ${moment}.`)
    expect(email.text).toContain(`Please choose by ${deadline}.`)
    expect(email.text).toContain('Choose your food: https://management.example.test/g/fixture-token/christmas-choice')
    expect(email.text).toContain("we'll send you one reminder. We won't use your email address for anything else.")
    expect(email.html).toContain('href="https://management.example.test/g/fixture-token/christmas-choice"')
    // Only the organiser's first name: never a surname, a phone or an email.
    expect(email.text).not.toMatch(/@example|07\d{9}/)
  })

  it('greets a guest whose name the organiser did not give, without a blank', () => {
    const email = buildPreorderGuestInviteEmail({
      guestName: null,
      organiserFirstName: 'Fixture',
      bookingDate: '2026-12-11',
      bookingTime: '19:00',
      closesAt: cutoffFor('2026-12-11'),
      url: 'https://management.example.test/g/fixture-token/christmas-choice',
    })
    assertCleanRender(email)
    expect(email.text.startsWith('Hi, Fixture asked us')).toBe(true)
  })
})

describe('the closed line', () => {
  it('names the cutoff on the London clock, with the phone number', () => {
    expect(formatPreorderCutoffForGuest(cutoffFor('2026-12-11'))).toBe('noon on Friday 4 December 2026')
    expect(preorderClosedMessage(cutoffFor('2026-12-11'))).toBe(
      'Choices closed at noon on Friday 4 December 2026. Call 01753 682707 if something needs to change.',
    )
    expect(preorderClosedMessage(null)).toBe('Choices closed. Call 01753 682707 if something needs to change.')
  })
})
