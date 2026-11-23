import { GUEST } from '@/lib/brand/palette'
import { GUEST_EMAIL_SIGN_OFF, guestContactHtmlBlock, guestContactTextLine } from '@/lib/email/guest-footer'
import {
  formatBookingDateForEmail,
  formatBookingTimeForEmail,
  type TableBookingEmail,
} from '@/lib/table-bookings/guest-emails'

/**
 * The morning-after email to a guest whose table booking was marked a no-show (owner decisions of
 * 22 November 2026). The wording is the draft the owner approved in outline, used as written: it
 * starts from the chance that WE made the mistake, and asks why only so booking can be made
 * easier, never to blame. Calm on purpose: no heading, no exclamation marks, nothing promoted.
 *
 * The weekday comes from the London date helpers, never typed. The subject says "yesterday", so
 * the job that sends this only sends it the day after the booking (no-show-follow-up.ts).
 *
 * Pure: no database and no clock, so it renders with fixture data in tests.
 */

export const NO_SHOW_FOLLOW_UP_SUBJECT = 'Did we miss you yesterday?'

export type NoShowFollowUpEmailInput = {
  firstName: string
  partySize: number
  /** YYYY-MM-DD, the London date the booking was for. */
  bookingDate: string
  /** HH:MM or HH:MM:SS, London wall-clock time. */
  bookingTime: string
  /** The guest page; opening it changes nothing. */
  replyUrl: string
}

const FONT_FAMILY = 'Arial, Helvetica, sans-serif'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Why the email cannot be built from these facts, or null when it can. Checked before the booking
 * is claimed, so a booking with a missing fact is never claimed and never sent a broken email.
 */
export function noShowFollowUpProblem(
  input: Pick<NoShowFollowUpEmailInput, 'firstName' | 'partySize' | 'bookingDate' | 'bookingTime'>
): string | null {
  if (!input.firstName.trim()) return 'no first name'
  if (!Number.isInteger(input.partySize) || input.partySize < 1) return 'no party size'
  if (!formatBookingDateForEmail(input.bookingDate)) return 'no date'
  if (!/^\d{1,2}:\d{2}/.test(input.bookingTime.trim()) || !formatBookingTimeForEmail(input.bookingTime)) return 'no time'
  return null
}

export function buildNoShowFollowUpEmail(input: NoShowFollowUpEmailInput): TableBookingEmail {
  const problem = noShowFollowUpProblem(input)
  if (problem) throw new Error(`The no-show follow-up email cannot be built: ${problem}`)

  const firstName = input.firstName.trim()
  // "Saturday 21 November 2026", on the London calendar.
  const when = formatBookingDateForEmail(input.bookingDate) as string
  const time = formatBookingTimeForEmail(input.bookingTime) as string
  const reasonUrl = `${input.replyUrl}#what-happened`

  const opening = `Hi ${firstName}, we had a table for ${input.partySize} booked for you at ${time} on ${when}, and our records show you didn't make it.`
  const ourMistake =
    "If we've made a mistake and you did come in, thank you very much for joining us. Please let us know with the button below so we can put it right."
  const cameIn = 'I did come in'
  const noBlame =
    "If you weren't able to make it, that's no problem at all, and nobody is cross. It would really help us to know what got in the way, so we can make booking with us easier."
  const tellUs = 'Tell us what happened'
  const closing = "We'd love to see you another time."

  const p = (inner: string) =>
    `<p style="font-family:${FONT_FAMILY};font-size:15px;line-height:1.5;margin:0 0 12px">${inner}</p>`

  const html = [
    `<div style="font-family:${FONT_FAMILY};max-width:600px;margin:0 auto;padding:20px;color:${GUEST.text}">`,
    p(escapeHtml(opening)),
    p(escapeHtml(ourMistake)),
    `<p style="margin:20px 0"><a href="${escapeHtml(input.replyUrl)}" ` +
      `style="font-family:${FONT_FAMILY};display:inline-block;background:${GUEST.buttonBg};color:${GUEST.buttonText};` +
      `font-size:16px;padding:12px 20px;border-radius:4px;text-decoration:none">${escapeHtml(cameIn)}</a></p>`,
    p(escapeHtml(noBlame)),
    p(`<a href="${escapeHtml(reasonUrl)}" style="color:${GUEST.green};font-weight:bold">${escapeHtml(tellUs)}</a>`),
    p(escapeHtml(closing)),
    guestContactHtmlBlock(),
    `<p style="font-family:${FONT_FAMILY};font-size:15px;margin:16px 0 0">${GUEST_EMAIL_SIGN_OFF}</p>`,
    '</div>',
  ].join('')

  const text = [
    opening,
    ourMistake,
    `${cameIn}: ${input.replyUrl}`,
    noBlame,
    `${tellUs}: ${reasonUrl}`,
    closing,
    guestContactTextLine(),
    GUEST_EMAIL_SIGN_OFF,
  ].join('\n\n')

  return { subject: NO_SHOW_FOLLOW_UP_SUBJECT, html, text }
}
