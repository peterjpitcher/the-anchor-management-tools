import { COMPANY_DETAILS } from '@/lib/company-details'

/**
 * The single source of contact facts for guest-facing pages.
 *
 * Everything here is derived from `COMPANY_DETAILS` rather than hand-copied, so
 * a change to the company record flows through to all 13 guest routes. Two
 * shapes matter and are kept apart deliberately:
 *
 *  - the *display* phone, `01753 682707`, which is the exact string all ten
 *    current guest usages render, and
 *  - the *dialling* value, an E.164 `tel:` URI.
 *
 * Never render `telHref` as text, and never put the display string in an href.
 */

/** Digits only, e.g. `01753682707`. Derived, so a company-record edit follows. */
const phoneDigits: string = COMPANY_DETAILS.phone.replace(/\D/g, '')

/** `01753 682707`: dialling code, space, subscriber number. */
const phoneDisplay = `${phoneDigits.slice(0, 5)} ${phoneDigits.slice(5)}`

/** `+441753682707`: UK national leading zero swapped for the country code. */
const phoneE164 = `+44${phoneDigits.replace(/^0/, '')}`

const address = COMPANY_DETAILS.address

export const GUEST_CONTACT = {
  /** Human-readable phone number. Render this, never the href value. */
  phoneDisplay,
  /** `tel:` URI for the same number, in E.164. */
  telHref: `tel:${phoneE164}`,
  /** Mailbox guests are asked to write to. */
  email: COMPANY_DETAILS.email,
  /** `mailto:` URI for the same address. */
  emailHref: `mailto:${COMPANY_DETAILS.email}`,
  /**
   * Public website. The `www` host is what the design handoff specifies for the
   * footer link, and differs from `COMPANY_DETAILS.website` (apex, used for
   * invoices and contracts). Both resolve; this is the guest-facing one.
   */
  website: 'https://www.the-anchor.pub',
  /**
   * The privacy policy guests are shown: the website's, not this app's `/privacy`.
   *
   * Guest pages used to link to `/privacy`, a notice dated December 2024 that
   * disagrees with the website's on who is responsible for the data, how long
   * it is kept and which companies handle it. A guest who booked on the website
   * and then opened a link in a text was shown two different notices. `/privacy`
   * stays as the notice for staff, who are linked to it from the staff screens.
   * Site review of 7 October 2026, finding PC-010.
   */
  privacyPolicy: 'https://www.the-anchor.pub/privacy-policy',
  /** Single-line postal address, as the footer renders it. */
  addressLine: `${address.street}, ${address.city}, ${address.county} ${address.postcode}`,
} as const

export type GuestContact = typeof GUEST_CONTACT
