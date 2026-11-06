import { describe, expect, it } from 'vitest'
import {
  buildPreorderFoodLinkEmail,
  buildPreorderFoodLinkText,
  type PreorderFoodLinkFacts,
} from '@/lib/table-bookings/preorder-food-link-messages'

/**
 * The organiser's food link, sent by staff (spec section 3.5). Rendered with fixture data, failing on
 * anything that has reached real guests before: undefined, Invalid Date, NaN, null, a zero amount
 * or a long dash.
 */

const FACTS: PreorderFoodLinkFacts = {
  firstName: 'Fixture',
  bookingReference: 'TB-FIXTURE',
  bookingDate: '2026-12-12',
  bookingTime: '19:00:00',
  partySize: 8,
  link: 'https://l.example.test/abc',
  closesAtIso: '2026-12-05T12:00:00.000Z',
}

const LONG_DASH = String.fromCharCode(0x2014)
const BANNED = [/undefined/, /Invalid Date/, /NaN/, /\bnull\b/, /£0(\.00)?\b/]

function expectClean(text: string) {
  for (const pattern of BANNED) expect(text).not.toMatch(pattern)
  expect(text.includes(LONG_DASH)).toBe(false)
}

describe('the staff food link email', () => {
  it('renders the date, the deadline, the link and the phone number', () => {
    const email = buildPreorderFoodLinkEmail(FACTS)

    expect(email.subject).toBe("Choose everyone's food for Saturday 12 December 2026")
    expect(email.text).toContain('Choices close at noon on Saturday 5 December.')
    expect(email.text).toContain('https://l.example.test/abc')
    expect(email.text).toContain('01753 682707')
    expect(email.text).toContain('8 people')
    expect(email.html).toContain('href="https://l.example.test/abc"')
    for (const part of [email.subject, email.html, email.text]) expectClean(part)
  })

  it('leaves out what it does not know rather than printing a gap', () => {
    const email = buildPreorderFoodLinkEmail({
      ...FACTS,
      bookingReference: null,
      bookingTime: null,
      partySize: null,
      closesAtIso: 'not a date',
    })

    expect(email.text).not.toContain('Choices close')
    expect(email.text).not.toContain('reference')
    for (const part of [email.subject, email.html, email.text]) expectClean(part)
  })
})

describe('the staff food link text', () => {
  it('renders one plain message with the deadline and the link', () => {
    const text = buildPreorderFoodLinkText(FACTS)

    expect(text).toMatch(/^The Anchor: Hi Fixture, here's your link to choose everyone's food for your booking on /)
    expect(text).toContain('Choices close at noon on Saturday 5 December.')
    expect(text.endsWith(' https://l.example.test/abc')).toBe(true)
    expectClean(text)
  })

  it('still reads cleanly with an unreadable date and no deadline', () => {
    const text = buildPreorderFoodLinkText({ ...FACTS, bookingDate: 'not a date', closesAtIso: null })

    expect(text).toBe("The Anchor: Hi Fixture, here's your link to choose everyone's food. https://l.example.test/abc")
    expectClean(text)
  })
})
