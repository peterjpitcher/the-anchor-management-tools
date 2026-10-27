// MUST BE KEPT IN STEP WITH `lib/communication-consent.ts` IN THE WEBSITE REPO
// (OJ-The-Anchor.pub). There is no shared package between the two apps, so this file is a
// deliberate duplicate and the only thing stopping it drifting is this comment.
//
// Why that matters: `ConsentService.recordConsent` stores both `consent_text_version` and
// `consent_text`, and the text comes from here. Until October 2026 this comment said website
// consents supply their own text. They never did: the website sent a version and no wording, so
// every website table and event consent stored the service-only wording below instead of the
// notice the guest actually saw, which also covered marketing and how to refuse (BK-080). The
// website now says which notice it showed (`notice_key`), and GUEST_CONSENT_NOTICES below holds
// the words for each key. Everything AMS records itself (unsubscribe links, inbound NOEVENTS
// keywords, staff profile toggles, provider events) uses the fallbacks further down.
//
// Measured on 2026-08-19, before this file was corrected: 24 `unsubscribe_link` rows from
// 16 to 17 August, 4 `inbound_keyword` rows, plus `profile_toggle` and `provider_event` rows
// as recent as 18 August, were all stamped `guest-comms-consent-v1` and stored the generic
// "Email me about future events and offers." wording. That wording predates v1 and no guest
// has been shown it since. Website rows over the same period correctly carried v3.
//
// Brought to v4 on 2026-08-19 to match the website, and to v5 on 2026-08-20 when the venue
// confirmed the scope is wider still: the latest from The Anchor generally, including
// changes as they happen, not only events, menus and offers. If you change the wording in
// either repo, change it in both, and bump the version in both.

//
// Brought to v6 on 2026-10-08 to match the website, which bumped the version when its event
// booking form's notice began covering email as well as texts. None of the wording held in
// THIS file changed between v5 and v6: the service notice and the four labels below are word
// for word what the website shows at v6 (checked against its lib/communication-consent.ts on
// that date). The two compact booking notices that did change live only in the website, which
// always sends its own text and version with a consent, so this app keeps no copy of them.
// The bump is so that a consent this app records by itself is stamped with the same version
// the website is using for the same words.
export const GUEST_COMMS_CONSENT_TEXT_VERSION = 'guest-comms-consent-v6'

export const GUEST_SERVICE_CONTACT_NOTICE =
  'We will use your phone and email to manage this booking, including confirmations, reminders, payment links, waitlist updates, and changes.'

// Named concretely rather than generically. The previous generic wording here, "Email me
// about future events and offers.", was measured on the website at a 1-in-71 tick rate,
// which is why the website replaced it. Naming the actual nights is what fixed that.
//
// Widened at v4 to name menus and offers alongside the game nights, because the venue was
// already sending both (the "Lunch from September 2026" campaign) and the label did not say
// so. Karaoke, DJ nights and live music are all deliberately absent: the first two are
// occasional and only promotable against a specific event record, and live music is
// discontinued in full.
export const GUEST_MARKETING_EMAIL_LABEL =
  'Email me the latest from The Anchor: quiz nights and bingo, new menus, offers, and any changes.'

export const GUEST_MARKETING_SMS_LABEL =
  'Text me the latest from The Anchor: quiz nights and bingo, new menus, offers, and any changes.'

export const GUEST_WHATSAPP_SERVICE_LABEL =
  'Send booking updates by WhatsApp.'

export const GUEST_MARKETING_WHATSAPP_LABEL =
  'Send me WhatsApp updates on what is on, new menus, offers, and any changes.'

// The tick box on the guest email-capture page (`/g/[token]/email-capture`), which offers to
// stop marketing texts now that the guest has given an address.
//
// VERSIONED SEPARATELY, and not under GUEST_COMMS_CONSENT_TEXT_VERSION. That constant is
// mirrored in the website repo and covers the labels the website also shows; this box exists
// only in AMS, so bumping the shared version for it would put the two repos out of step over
// wording the website has never displayed.
//
// v1 IS A CORRECTION, NOT A NEW ASK. Until 12 September 2026 the box, and therefore the
// consent text stored with it, promised "Your booking confirmations and reminders will still
// come by text." Email-first made that untrue: a booking confirmation now goes by email when
// the address is usable, and only falls back to a text. The new wording names no channel,
// because the promise that matters to the guest is that the message reaches them.
//
// Rows already in `customer_consents` keep the old text and the old
// `guest-comms-consent-v5` stamp. They record what that guest was actually shown, which is
// the entire point of storing the text, so they are never rewritten.
export const GUEST_MARKETING_SMS_STOP_LABEL_VERSION = 'guest-sms-stop-label-v1'

export const GUEST_MARKETING_SMS_STOP_LABEL =
  'Email is enough, stop sending me marketing texts. Your booking confirmations and reminders will still reach you.'

// ── The notice each booking form showed (BK-080) ───────────────────────────────────────────
//
// The website sends `notice_key` inside communication_consent to say which notice the guest saw,
// and the consent is stored with these exact words. Copied word for word from the website's
// lib/communication-consent.ts on 26 October 2026: change the words in both repos and give the
// changed notice a NEW key, so a consent already stored keeps pointing at what that guest read.
//
// `softOptIn` names the channels the notice told the guest we would send the latest from The
// Anchor on, with a way to refuse (NOEVENTS for texts, the unsubscribe link for email). That is
// the PECR soft opt-in, so a booking that showed it also records a marketing row with legal basis
// soft_opt_in for each, unless the guest had already opted out. The tick-box forms (private hire,
// parking) show only the service notice, so they record marketing only when a box is ticked.
//
// `marketingText` is stored on an explicit marketing opt-in recorded with this notice, in place of
// the tick-box label, for the staff read-out, where the guest said yes out loud.

export type ConsentNoticeChannel = 'sms' | 'email'

export type ConsentNotice = {
  text: string
  softOptIn: ReadonlyArray<ConsentNoticeChannel>
  marketingText?: string
}

const COMPACT_BOOKING_NOTICE_V6 =
  'We will use your phone and email to manage this booking, and to send you the latest from The Anchor: what is on, new menus, offers, and any changes. Reply NOEVENTS to stop texts, or use the unsubscribe link in any email. Booking confirmations and reminders carry on either way.'

/**
 * What staff read to a guest they are booking in person before ticking "They said yes" (owner
 * decision D32). Only a recorded yes puts a staff-booked guest on the marketing texts.
 */
export const STAFF_MARKETING_READ_OUT =
  "We'll text you about this booking. Can we also text you the latest from The Anchor: what's on, new menus, offers and any changes? You can reply NOEVENTS to any text to stop those."

export const STAFF_MARKETING_READ_OUT_KEY = 'staff_read_out_v1'

export const GUEST_CONSENT_NOTICES: Readonly<Record<string, ConsentNotice>> = {
  table_compact_v6: { text: COMPACT_BOOKING_NOTICE_V6, softOptIn: ['sms', 'email'] },
  event_compact_v6: { text: COMPACT_BOOKING_NOTICE_V6, softOptIn: ['sms', 'email'] },
  // The quick-book sheet takes no email, so its notice speaks of texts only.
  table_quick_book_v1: {
    text: 'We will use your phone to manage this booking, and to text you the latest from The Anchor: what is on, new menus, offers, and any changes. Reply NOEVENTS to stop those texts. Booking confirmations and reminders carry on either way.',
    softOptIn: ['sms'],
  },
  service_notice_v6: { text: GUEST_SERVICE_CONTACT_NOTICE, softOptIn: [] },
  [STAFF_MARKETING_READ_OUT_KEY]: { text: STAFF_MARKETING_READ_OUT, softOptIn: [], marketingText: STAFF_MARKETING_READ_OUT },
}

/** The notice for a key, or null for none or a key this app does not know. */
export function resolveConsentNotice(key: string | null | undefined): ConsentNotice | null {
  if (!key) return null
  return Object.prototype.hasOwnProperty.call(GUEST_CONSENT_NOTICES, key) ? GUEST_CONSENT_NOTICES[key] : null
}
