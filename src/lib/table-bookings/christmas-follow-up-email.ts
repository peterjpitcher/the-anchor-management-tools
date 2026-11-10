import { GUEST } from '@/lib/brand/palette'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { isValidIsoDate } from '@/lib/dateUtils'
import { formatBookingDateForEmail } from '@/lib/table-bookings/guest-emails'

/**
 * The one follow-up email to somebody who started a Christmas dinner booking online and did not
 * finish (Christmas funnel spec, owner decision 5). The wording was approved by the owner on
 * 10 November 2026 and is used word for word: no heading, preview line, contact block or sign-off
 * is added. The weekday comes from the London date helpers, never typed. The venue name and address
 * are the guest footer's (GUEST_CONTACT.addressLine, which starts "The Anchor"), and the phone
 * number is GUEST_CONTACT's.
 *
 * Pure: no database and no clock, so it renders with fixture data in tests.
 */

export const CHRISTMAS_FOLLOW_UP_SUBJECT = 'Your Christmas dinner at The Anchor'

export type ChristmasFollowUpEmailInput = {
  firstName: string
  partySize: number
  /** The chosen London date, YYYY-MM-DD. */
  bookingDate: string
  /** The deposit per guest in pounds, from the Christmas period (10 for Christmas 2026). */
  depositPerHeadGbp: number
  resumeUrl: string
  christmasPageUrl: string
  unsubscribeUrl: string
}

export type ChristmasFollowUpEmail = { subject: string; html: string; text: string }

const FONT_FAMILY = 'Arial, Helvetica, sans-serif'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** "£10", or "£10.50" for an amount with pence. Null for anything that is not a positive amount. */
export function formatDepositPerHead(amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Number.isInteger(amount) ? `£${amount}` : `£${amount.toFixed(2)}`
}

/**
 * Why the email cannot be built from these facts, or null when it can. Checked before the lead is
 * claimed, so a lead with a missing fact is never claimed and never sent a broken email.
 */
export function christmasFollowUpProblem(input: Pick<ChristmasFollowUpEmailInput, 'firstName' | 'partySize' | 'bookingDate' | 'depositPerHeadGbp'>): string | null {
  if (!input.firstName.trim()) return 'no first name'
  if (!Number.isInteger(input.partySize) || input.partySize < 1) return 'no party size'
  if (!isValidIsoDate(input.bookingDate) || !formatBookingDateForEmail(input.bookingDate)) return 'no date'
  if (!formatDepositPerHead(input.depositPerHeadGbp)) return 'no deposit amount'
  return null
}

export function buildChristmasFollowUpEmail(input: ChristmasFollowUpEmailInput): ChristmasFollowUpEmail {
  const problem = christmasFollowUpProblem(input)
  if (problem) throw new Error(`The Christmas follow-up email cannot be built: ${problem}`)

  const firstName = input.firstName.trim()
  // "Tuesday 15 December 2026", on the London calendar.
  const when = formatBookingDateForEmail(input.bookingDate) as string
  const deposit = formatDepositPerHead(input.depositPerHeadGbp) as string
  const phone = GUEST_CONTACT.phoneDisplay

  const greeting = `Hi ${firstName},`
  const started = `You started booking Christmas dinner for ${input.partySize} on ${when}, but didn't get as far as the deposit, so we're not holding a table yet.`
  const linkLead = "If you'd still like to come, this link picks up where you left off, with your details filled in:"
  const finish = 'Finish my booking'
  const depositLine = `The ${deposit} a head deposit comes off your bill. Once it's paid, we'll send you a link for everyone to choose their food.`
  const talkLead = 'Rather talk it through first? Call or WhatsApp us on'
  const talkMenu = 'or see the menu on our'
  const christmasPage = 'Christmas page'
  const venue = GUEST_CONTACT.addressLine
  const why = "You're getting this one email because you started a booking with us. We won't send another."
  const unsubscribe = 'Unsubscribe'

  const p = (inner: string, extra = '') =>
    `<p style="font-family:${FONT_FAMILY};font-size:15px;line-height:1.5;margin:0 0 12px;${extra}">${inner}</p>`
  const link = (href: string, label: string, extra = '') =>
    `<a href="${escapeHtml(href)}" style="color:${GUEST.green};${extra}">${escapeHtml(label)}</a>`

  const html = [
    `<div style="font-family:${FONT_FAMILY};max-width:600px;margin:0 auto;padding:20px;color:${GUEST.text}">`,
    p(escapeHtml(greeting)),
    p(escapeHtml(started)),
    p(`${escapeHtml(linkLead)} ${link(input.resumeUrl, finish, 'font-weight:bold')}`),
    p(escapeHtml(depositLine)),
    p(
      `${escapeHtml(talkLead)} <a href="${GUEST_CONTACT.telHref}" style="color:${GUEST.green}">${escapeHtml(phone)}</a>, ` +
        `${escapeHtml(talkMenu)} ${link(input.christmasPageUrl, christmasPage)}.`,
    ),
    p(escapeHtml(venue)),
    p(`${escapeHtml(why)}<br>${link(input.unsubscribeUrl, unsubscribe)}`, `color:${GUEST.textMuted};font-size:13px`),
    '</div>',
  ].join('')

  const text = [
    greeting,
    started,
    `${linkLead}\n${finish}: ${input.resumeUrl}`,
    depositLine,
    `${talkLead} ${phone}, ${talkMenu} ${christmasPage}: ${input.christmasPageUrl}`,
    venue,
    `${why}\n${unsubscribe}: ${input.unsubscribeUrl}`,
  ].join('\n\n')

  return { subject: CHRISTMAS_FOLLOW_UP_SUBJECT, html, text }
}
