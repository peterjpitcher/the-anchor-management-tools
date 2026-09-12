/**
 * The contact block every guest email ends with.
 *
 * The 11 September email review found booking emails that said "reply to this email or call the
 * pub" with no number anywhere, and event emails that said "contact us" without saying how. A guest
 * holding a booking question had nothing to act on. The numbers come from `GUEST_CONTACT`, which
 * derives them from the company record, so nothing here is hand-copied.
 *
 * `manager@the-anchor.pub` is the only correct address (website SSOT section 2). The venue's own
 * emails go out from a no-reply address, so the footer names the address that reaches a person
 * rather than inviting a reply into a mailbox nobody reads.
 */
import { GUEST_CONTACT } from '@/lib/guest-contact'

export const GUEST_EMAIL_ADDRESS = 'manager@the-anchor.pub'

/** One line naming both routes, for the end of a plain-text email. */
export function guestContactTextLine(): string {
  return `Any questions, call us on ${GUEST_CONTACT.phoneDisplay} or email ${GUEST_EMAIL_ADDRESS}.`
}

/**
 * The HTML contact block. Kept to a table-free paragraph so it drops into every template,
 * whatever its layout, and both routes are tappable on a phone.
 */
export function guestContactHtmlBlock(): string {
  return [
    '<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#4b5563">',
    'Any questions, call us on ',
    `<a href="${GUEST_CONTACT.telHref}" style="color:#005131">${GUEST_CONTACT.phoneDisplay}</a>`,
    ' or email ',
    `<a href="mailto:${GUEST_EMAIL_ADDRESS}" style="color:#005131">${GUEST_EMAIL_ADDRESS}</a>.`,
    '</p>',
  ].join('')
}

/** The venue sign-off, so every guest email closes the same way. */
export const GUEST_EMAIL_SIGN_OFF = 'The Anchor'
