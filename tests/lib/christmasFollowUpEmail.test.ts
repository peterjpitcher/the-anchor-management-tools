import { describe, expect, it } from 'vitest'
import { assertCleanText, expectedLongDate } from '../mocks/emailRenderChecks'
import {
  CHRISTMAS_FOLLOW_UP_SUBJECT,
  buildChristmasFollowUpEmail,
  christmasFollowUpProblem,
  type ChristmasFollowUpEmailInput,
} from '@/lib/table-bookings/christmas-follow-up-email'

/**
 * The Christmas follow-up email, rendered from fixture data (Christmas funnel spec, owner decision
 * 8: the wording was approved on 10 November 2026 and is used word for word). Fails on a broken
 * value, a stray dash, a weekday that does not match the date, and a missing name.
 */

const FIXTURE: ChristmasFollowUpEmailInput = {
  firstName: 'Sam',
  partySize: 12,
  bookingDate: '2026-12-15',
  depositPerHeadGbp: 10,
  resumeUrl: 'https://www.the-anchor.pub/book-table?christmas=1#resume=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde',
  christmasPageUrl: 'https://www.the-anchor.pub/christmas-parties',
  unsubscribeUrl: 'https://management.example.com/api/table-bookings/leads/opt-out?t=ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210-_edcba',
}

/** The approved paragraphs, as the plain-text part carries them. */
const APPROVED_TEXT = [
  'Hi Sam,',
  "You started booking Christmas dinner for 12 on Tuesday 15 December 2026, but didn't get as far as the deposit, so we're not holding a table yet.",
  "If you'd still like to come, this link picks up where you left off, with your details filled in:\nFinish my booking: " + FIXTURE.resumeUrl,
  "The £10 a head deposit comes off your bill. Once it's paid, we'll send you a link for everyone to choose their food.",
  'Rather talk it through first? Call or WhatsApp us on 01753 682707, or see the menu on our Christmas page: ' + FIXTURE.christmasPageUrl,
  'The Anchor, Horton Road, Stanwell Moor Village, Surrey TW19 6AQ',
  "You're getting this one email because you started a booking with us. We won't send another.\nUnsubscribe: " + FIXTURE.unsubscribeUrl,
].join('\n\n')

describe('the Christmas follow-up email', () => {
  it('renders the approved wording from fixture data, with nothing broken in any part', () => {
    const email = buildChristmasFollowUpEmail(FIXTURE)

    expect(email.subject).toBe(CHRISTMAS_FOLLOW_UP_SUBJECT)
    expect(email.subject).toBe('Your Christmas dinner at The Anchor')
    expect(email.text).toBe(APPROVED_TEXT)
    for (const part of [email.subject, email.html, email.text]) assertCleanText(part)
  })

  it('puts the same words in the HTML part, with the three links and a dialable number', () => {
    const { html } = buildChristmasFollowUpEmail(FIXTURE)

    expect(html).toContain('Hi Sam,')
    expect(html).toContain('You started booking Christmas dinner for 12 on Tuesday 15 December 2026, but didn&#39;t get as far as the deposit, so we&#39;re not holding a table yet.')
    expect(html).toMatch(new RegExp(`<a href="${FIXTURE.resumeUrl.replace(/[.?*+^$()[\]\\|]/g, '\\$&')}"[^>]*>Finish my booking</a>`))
    expect(html).toContain('The £10 a head deposit comes off your bill.')
    expect(html).toContain('<a href="tel:+441753682707"')
    expect(html).toMatch(/>01753 682707<\/a>, or see the menu on our <a href="https:\/\/www\.the-anchor\.pub\/christmas-parties"[^>]*>Christmas page<\/a>\./)
    expect(html).toContain('The Anchor, Horton Road, Stanwell Moor Village, Surrey TW19 6AQ')
    expect(html).toMatch(/We won&#39;t send another\.<br><a href="https:\/\/management\.example\.com\/api\/table-bookings\/leads\/opt-out\?t=[^"]+"[^>]*>Unsubscribe<\/a>/)
  })

  it.each(['2026-11-30', '2026-12-01', '2026-12-13', '2026-12-20'])('names the right weekday for %s', (bookingDate) => {
    const { text } = buildChristmasFollowUpEmail({ ...FIXTURE, bookingDate })

    expect(text).toContain(`for 12 on ${expectedLongDate(bookingDate)},`)
  })

  it('shows pence only when the deposit has them', () => {
    expect(buildChristmasFollowUpEmail({ ...FIXTURE, depositPerHeadGbp: 12.5 }).text).toContain('The £12.50 a head deposit')
  })

  it.each([
    ['an empty first name', { firstName: '  ' }, 'no first name'],
    ['a party size that is not a number', { partySize: Number.NaN }, 'no party size'],
    ['a date that is not real', { bookingDate: '2026-02-30' }, 'no date'],
    ['a date that is missing', { bookingDate: undefined as unknown as string }, 'no date'],
    ['a deposit that is not a number', { depositPerHeadGbp: Number.NaN }, 'no deposit amount'],
    ['a zero deposit', { depositPerHeadGbp: 0 }, 'no deposit amount'],
  ])('refuses to build with %s', (_label, change, problem) => {
    const input = { ...FIXTURE, ...change }

    expect(christmasFollowUpProblem(input)).toBe(problem)
    expect(() => buildChristmasFollowUpEmail(input)).toThrow(`The Christmas follow-up email cannot be built: ${problem}`)
  })

  it('escapes a name typed with HTML in it', () => {
    const { html } = buildChristmasFollowUpEmail({ ...FIXTURE, firstName: '<b>Sam</b>' })

    expect(html).toContain('Hi &lt;b&gt;Sam&lt;/b&gt;,')
  })
})
