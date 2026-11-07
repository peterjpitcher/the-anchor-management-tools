import { describe, expect, it } from 'vitest'
import { assertCleanGsmText, assertCleanRender, expectedLongDate } from '../../../tests/mocks/emailRenderChecks'
import {
  buildGuestReminderEmail,
  buildManagerCallListEmail,
  buildOrganiserChaseEmail,
  buildOrganiserChaseText,
  describeChoicesDeadline,
  describeMissingGuests,
  guestLabel,
  toGuestWording,
} from './preorder-reminder-messages'
import { getPreorderCompleteness } from './preorder'
import type { PreorderOrganiserStage } from '@/types/preorders'

/**
 * The Christmas food choices ladder's messages (D6, D7), rendered with fixture data. Run in both
 * the London and the UTC suites, so a date or time read on the server's clock fails one of them.
 */

// Booking on Saturday 12 December 2026 at 7pm; choices close at noon on Saturday 5 December.
const CUTOFF = new Date('2026-12-05T12:00:00.000Z')
const LINK = 'https://l.the-anchor.pub/food1'

const MISSING = [
  { ordinal: 2, label: 'Jo', missing: 'a starter or a dessert' },
  { ordinal: 3, label: 'Guest 3', missing: 'a name, their allergies, their number of courses and a main' },
]

function facts(stage: PreorderOrganiserStage, now: Date) {
  return {
    stage,
    firstName: 'Alex',
    bookingReference: 'TB-XMAS1',
    bookingDate: '2026-12-12',
    bookingTime: '19:00:00',
    startDateTime: '2026-12-12T19:00:00.000Z',
    partySize: 3,
    missing: MISSING,
    deadline: describeChoicesDeadline(CUTOFF, now),
    foodLink: LINK,
  }
}

describe('describeChoicesDeadline', () => {
  it('says today, tomorrow or the date, on the London calendar', () => {
    expect(describeChoicesDeadline(CUTOFF, new Date('2026-12-05T09:00:00Z'))).toEqual({
      long: `noon on ${expectedLongDate('2026-12-05')}`,
      when: 'at noon today',
    })
    expect(describeChoicesDeadline(CUTOFF, new Date('2026-12-04T12:00:00Z')).when).toBe('at noon tomorrow')
    expect(describeChoicesDeadline(CUTOFF, new Date('2026-11-21T12:00:00Z')).when).toBe(
      `at noon on ${expectedLongDate('2026-12-05')}`,
    )
  })

  it('reads a summer cutoff in British Summer Time, not UTC', () => {
    // Noon London on 1 July is 11:00 UTC.
    const summer = new Date('2026-07-01T11:00:00Z')
    expect(describeChoicesDeadline(summer, new Date('2026-06-20T12:00:00Z')).long).toBe(`noon on ${expectedLongDate('2026-07-01')}`)
  })
})

describe('describeMissingGuests', () => {
  it('names each seat by its first name, or by its number when it has none', () => {
    const completeness = getPreorderCompleteness({
      partySize: 2,
      courseCounts: [2, 0],
      covers: [
        {
          id: 'c-1', tableBookingId: 'b-1', ordinal: 1, guestName: 'Jo Bloggs', dietaryNote: null, hasAllergies: false,
          allergyDetail: null, createdAt: '', updatedAt: '',
          selections: [{ id: 's', coverId: 'c-1', course: 'main', menuItemId: 'm', itemName: 'Turkey', priceGbp: null, itemWithdrawn: false, createdAt: '', updatedAt: '' }],
        },
      ],
    })
    expect(describeMissingGuests(completeness)).toEqual([
      { ordinal: 1, label: 'Jo', missing: 'a starter or a dessert' },
      { ordinal: 2, label: 'Guest 2', missing: 'a name, their allergies, their number of courses and a main' },
    ])
    expect(guestLabel(4, '   ')).toBe('Guest 4')
  })
})

describe('the organiser email at each stage', () => {
  const cases: Array<[PreorderOrganiserStage, string, string, string]> = [
    ['booker_21d', '2026-11-21T12:00:30Z', `Choose your Christmas food for ${expectedLongDate('2026-12-12')}`, "There's still time to choose everyone's food."],
    ['booker_14d', '2026-11-28T12:00:30Z', `Choose your Christmas food for ${expectedLongDate('2026-12-12')}`, "There's still time to choose everyone's food."],
    ['booker_10d', '2026-12-02T12:00:30Z', `We still need your Christmas food choices for ${expectedLongDate('2026-12-12')}`, 'so please fill in'],
    ['booker_day_before', '2026-12-04T12:00:30Z', 'Your Christmas food choices close at noon tomorrow', "so please fill in what's missing today"],
    ['booker_cutoff_morning', '2026-12-05T09:00:30Z', 'Last call: Christmas food choices close at noon today', 'this is the last call'],
  ]

  it.each(cases)('%s renders cleanly, names who is missing what, and gives the deadline and the link', (stage, now, subject, tone) => {
    const email = buildOrganiserChaseEmail(facts(stage, new Date(now)))

    assertCleanRender(email)
    expect(email.subject).toBe(subject)
    expect(email.text).toContain(tone)
    expect(email.text).toContain('2 guests still need something:')
    expect(email.text).toContain('Jo: a starter or a dessert.')
    expect(email.text).toContain('Guest 3: a name, their allergies, their number of courses and a main.')
    expect(email.text).toContain(`Choices close: noon on ${expectedLongDate('2026-12-05')}`)
    expect(email.text).toContain(`Choose the food: ${LINK}`)
    expect(email.html).toContain(`href="${LINK}"`)
    expect(email.text).toContain('Reference: TB-XMAS1')
    // At most one exclamation mark, and no "on the day" choosing.
    expect((email.text.match(/!/g) ?? []).length).toBeLessThanOrEqual(1)
    expect(email.text).not.toContain('on the day')
  })

  it('says "One guest" for a single missing seat', () => {
    const email = buildOrganiserChaseEmail({ ...facts('booker_21d', new Date('2026-11-21T12:00:30Z')), missing: [MISSING[0]] })
    expect(email.text).toContain('One guest still needs something:')
  })

  it('gives the phone number on the last call', () => {
    const email = buildOrganiserChaseEmail(facts('booker_cutoff_morning', new Date('2026-12-05T09:00:30Z')))
    expect(email.text).toContain("If you can't finish in time, ring us on 01753 682707 and we'll help.")
    expect(email.text).toContain('Choices close at noon today.')
  })
})

describe('the organiser text', () => {
  it('the day before: GSM safe, names the guests, the deadline and the short link', () => {
    const body = buildOrganiserChaseText(facts('booker_day_before', new Date('2026-12-04T12:00:30Z')))
    assertCleanGsmText(body)
    expect(body).toBe(
      `The Anchor: Hi Alex, we still need Christmas food choices for Jo and Guest 3. Choices close at noon tomorrow. Fill them in here: ${LINK}`,
    )
  })

  it('cutoff morning: the last call, and "and N more" past three names', () => {
    const many = ['Jo', 'Sam', 'Kit', 'Lee', 'Max'].map((label, index) => ({ ordinal: index + 1, label, missing: 'a main' }))
    const body = buildOrganiserChaseText({ ...facts('booker_cutoff_morning', new Date('2026-12-05T09:00:30Z')), missing: many })
    assertCleanGsmText(body)
    expect(body).toBe(
      `The Anchor: Hi Alex, last call. Christmas food choices close at noon today and we still need them for Jo, Sam, Kit and 2 more. Fill them in here: ${LINK}`,
    )
  })
})

describe('the owner call list', () => {
  it('lists every booking with its reference, day, date and time, party, organiser and needs', () => {
    const deadline = describeChoicesDeadline(CUTOFF, new Date('2026-12-04T12:00:30Z'))
    const email = buildManagerCallListEmail([
      {
        bookingReference: 'TB-XMAS1', bookingDate: '2026-12-12', bookingTime: '19:00:00', partySize: 3,
        organiserName: 'Alex Organiser', organiserPhone: '+447700900777',
        gaps: 'Seat 2 (2 courses) needs a starter or a dessert.', deadline,
      },
      {
        bookingReference: 'TB-XMAS2', bookingDate: '2026-12-12', bookingTime: '12:30:00', partySize: 8,
        organiserName: 'the organiser', organiserPhone: null,
        gaps: 'Seat 5 needs a name, their allergies, their number of courses and a main.', deadline,
      },
    ])

    expect(email.subject).toBe('Christmas food choices still missing: 2 bookings to ring')
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/undefined|Invalid Date|NaN|\bnull\b/)
    }
    expect(email.text).toContain('TB-XMAS1')
    expect(email.text).toContain(`When: ${expectedLongDate('2026-12-12')} at 7pm`)
    expect(email.text).toContain(`When: ${expectedLongDate('2026-12-12')} at 12:30pm`)
    expect(email.text).toContain('Party size: 3')
    expect(email.text).toContain('Call: Alex Organiser on +447700900777')
    expect(email.text).toContain('Call: the organiser on no number on file')
    expect(email.text).toContain('Still needed: Seat 2 (2 courses) needs a starter or a dessert.')
    expect(email.text).toContain(`Choices close: noon on ${expectedLongDate('2026-12-05')}`)
    expect(email.html).toContain('<h3>TB-XMAS2</h3>')
  })

  it('says "1 booking" for one', () => {
    const email = buildManagerCallListEmail([
      {
        bookingReference: 'TB-XMAS1', bookingDate: '2026-12-12', bookingTime: '19:00:00', partySize: 3,
        organiserName: 'Alex Organiser', organiserPhone: '+447700900777', gaps: 'Seat 1 needs a main.',
        deadline: describeChoicesDeadline(CUTOFF, new Date('2026-12-04T12:00:30Z')),
      },
    ])
    expect(email.subject).toBe('Christmas food choices still missing: 1 booking to ring')
  })
})

describe('the guest reminder', () => {
  it('speaks to the guest about their own seat, with their link and the deadline', () => {
    const email = buildGuestReminderEmail({
      guestFirstName: 'Jo',
      organiserFirstName: 'Alex',
      bookingDate: '2026-12-12',
      bookingTime: '19:00:00',
      missing: 'a name, their allergies and a main',
      deadline: describeChoicesDeadline(CUTOFF, new Date('2026-12-04T12:00:30Z')),
      link: 'https://management.example.com/g/tok/christmas-choice',
    })

    assertCleanRender(email)
    expect(email.subject).toBe('Your Christmas dinner choice at The Anchor closes at noon tomorrow')
    expect(email.text).toContain(
      `Hi Jo, Alex asked us to send you a link to choose your own Christmas dinner at The Anchor on ${expectedLongDate('2026-12-12')} at 7pm.`,
    )
    expect(email.text).toContain('We still need your name, your allergies and a main.')
    expect(email.text).toContain('Choices close at noon tomorrow.')
    expect(email.text).toContain('Choose your food: https://management.example.com/g/tok/christmas-choice')
    expect(email.text).toContain("This is the only reminder we'll send, and we won't email you about anything else.")
  })

  it('reads well with no guest name and no organiser name', () => {
    const email = buildGuestReminderEmail({
      guestFirstName: null,
      organiserFirstName: 'there',
      bookingDate: '2026-12-12',
      bookingTime: '19:00:00',
      missing: null,
      deadline: describeChoicesDeadline(CUTOFF, new Date('2026-12-04T12:00:30Z')),
      link: 'https://management.example.com/g/tok/christmas-choice',
    })

    assertCleanRender(email)
    expect(email.text).toContain('Hello, the person who booked your table asked us to send you a link')
    expect(email.text).toContain('We still need your choices.')
  })

  it('turns the organiser wording into the guest wording', () => {
    expect(toGuestWording('a name, details of their allergies, their number of courses and a main')).toBe(
      'your name, details of your allergies, your number of courses and a main',
    )
  })
})
