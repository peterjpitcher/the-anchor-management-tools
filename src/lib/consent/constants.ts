// MUST BE KEPT IN STEP WITH `lib/communication-consent.ts` IN THE WEBSITE REPO
// (OJ-The-Anchor.pub). There is no shared package between the two apps, so this file is a
// deliberate duplicate and the only thing stopping it drifting is this comment.
//
// Why that matters: these values are FALLBACKS. `ConsentService.recordConsent` stores both
// `consent_text_version` and `consent_text`, and uses these whenever the caller does not
// supply them. Website-originated consents always supply their own, so they were correct.
// Everything AMS records itself did not: unsubscribe links, inbound NOEVENTS keywords, staff
// profile toggles and provider events all fell back to this file.
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

export const GUEST_COMMS_CONSENT_TEXT_VERSION = 'guest-comms-consent-v5'

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
