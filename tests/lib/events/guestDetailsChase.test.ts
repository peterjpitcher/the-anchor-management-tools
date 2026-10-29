import { describe, expect, it } from 'vitest'
import { assertCleanText } from '../../mocks/emailRenderChecks'
import {
  buildGuestDetailsManagerEmail,
  isBookerReminderDue,
  isManagerListDay,
} from '@/lib/events/guest-details-chase'
import { diffGuestDetails } from '@/lib/events/guest-details-edit'
import { resolvePublicEventLink } from '@/lib/events/public-event-link'
import { buildEventGuestDetailsReminderLines } from '@/lib/email/event-ticket-emails'
import type { StoredEventAttendee } from '@/lib/events/booking-questions'

/** BK-132 (chase missing guest details), BK-133 (what changed) and BK-173 (a way to book again). */

const NOW = new Date('2026-11-18T10:00:00.000Z')
const due = (overrides: Partial<Parameters<typeof isBookerReminderDue>[0]> = {}) =>
  isBookerReminderDue({ today: '2026-11-18', eventDate: '2026-11-21', bookingCreatedAt: '2026-11-10T12:00:00.000Z', now: NOW, alreadyReminded: false, missing: 2, ...overrides })

describe('the booker reminder', () => {
  it('is due 3 days before the night', () => {
    expect(due()).toBe(true)
  })

  it('catches up on a missed run inside the window, but not on the night itself', () => {
    expect(due({ eventDate: '2026-11-19' })).toBe(true)
    expect(due({ eventDate: '2026-11-18' })).toBe(false)
  })

  it('waits until the window opens', () => {
    expect(due({ eventDate: '2026-11-22' })).toBe(false)
  })

  it('goes once, only when something is missing, and not on top of a fresh request', () => {
    expect(due({ alreadyReminded: true })).toBe(false)
    expect(due({ missing: 0 })).toBe(false)
    expect(due({ bookingCreatedAt: '2026-11-18T01:00:00.000Z' })).toBe(false)
  })

  it('reads the window as London calendar days across the clock change', () => {
    expect(isBookerReminderDue({ today: '2026-10-22', eventDate: '2026-10-25', bookingCreatedAt: null, now: new Date('2026-10-22T09:00:00Z'), alreadyReminded: false, missing: 1 })).toBe(true)
  })
})

describe('the manager list', () => {
  it('is the day before the night', () => {
    expect(isManagerListDay({ today: '2026-11-20', eventDate: '2026-11-21' })).toBe(true)
    expect(isManagerListDay({ today: '2026-11-19', eventDate: '2026-11-21' })).toBe(false)
  })

  it('names the bookings and counts, with no answers or phone numbers', () => {
    const email = buildGuestDetailsManagerEmail({
      eventName: 'Tasting Night',
      when: 'Saturday 21 November 2026 at 7pm',
      eventUrl: 'https://management.orangejelly.co.uk/events/event-1',
      rows: [
        { reference: 'A1B2C3D4', bookerName: 'Pat Smith', missing: 2 },
        { reference: 'E5F6A7B8', bookerName: 'Sam Jones', missing: 1 },
      ],
    })
    for (const part of [email.subject, email.html, email.text]) assertCleanText(part)
    expect(email.subject).toBe('Guest details missing for Tasting Night, Saturday 21 November 2026 at 7pm')
    expect(email.text).toContain('2 bookings for Tasting Night on Saturday 21 November 2026 at 7pm still have guest details missing (3 tickets).')
    expect(email.text).toContain('A1B2C3D4: Pat Smith, 2 tickets incomplete')
    expect(email.text).toContain('Open the event: https://management.orangejelly.co.uk/events/event-1')
    expect(email.html).not.toMatch(/\+44|07\d{9}/)
  })
})

describe('the booker reminder email lines', () => {
  it('says how many tickets need details, calmly', () => {
    const lines = buildEventGuestDetailsReminderLines({ firstName: 'Pat', eventName: 'Tasting Night', when: ' on Saturday 21 November 2026 at 7pm', missingCount: 1 })
    lines.forEach(assertCleanText)
    expect(lines[1]).toBe('1 of your tickets still needs a guest name or answers for Tasting Night on Saturday 21 November 2026 at 7pm.')
  })
})

describe('what a guest details save changed (BK-133)', () => {
  const guest = (id: string, name: string, answer: string, phone?: string): StoredEventAttendee => ({
    id, name, ticket_type_id: null, phone,
    answers: [{ question_id: 'q-diet', label: 'Dietary needs', type: 'text', value: answer }],
  })

  it('lists the guest and question ids that changed, never the values', () => {
    const before = [guest('g1', 'Pat', 'None'), guest('g2', 'Sam', 'Vegan')]
    const after = [guest('g1', 'Pat', 'Nut allergy'), guest('g2', 'Sam', 'Vegan', '+447700900123')]
    const diff = diffGuestDetails(before, after)
    expect(diff).toEqual({ guestIds: ['g1', 'g2'], questionIds: ['q-diet'] })
    expect(JSON.stringify(diff)).not.toMatch(/Nut|Vegan|\+44/)
  })

  it('lists nothing when nothing changed, and new or removed guests when they are', () => {
    const list = [guest('g1', 'Pat', 'None')]
    expect(diffGuestDetails(list, list)).toEqual({ guestIds: [], questionIds: [] })
    expect(diffGuestDetails([], list).guestIds).toEqual(['g1'])
  })
})

describe('where a guest can book again (BK-173)', () => {
  it("uses the event's own booking link when staff set one", () => {
    expect(resolvePublicEventLink({ booking_url: ' https://tickets.example/quiz ', slug: 'quiz' })).toBe('https://tickets.example/quiz')
  })

  it("falls back to the event's page on the website when booking_url is empty", () => {
    expect(resolvePublicEventLink({ booking_url: '', slug: 'quiz-night-21-november' })).toBe('https://www.the-anchor.pub/events/quiz-night-21-november')
    expect(resolvePublicEventLink({ booking_url: null, slug: 'quiz-night' })).toBe('https://www.the-anchor.pub/events/quiz-night')
  })

  it('gives no link when there is neither', () => {
    expect(resolvePublicEventLink({ booking_url: null, slug: null })).toBeNull()
    expect(resolvePublicEventLink({ booking_url: null, slug: '../admin' })).toBeNull()
  })
})
