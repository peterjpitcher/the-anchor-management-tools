import { describe, expect, it } from 'vitest'

import {
  GUEST_COMMS_CONSENT_TEXT_VERSION,
  GUEST_MARKETING_EMAIL_LABEL,
  GUEST_MARKETING_SMS_LABEL,
  GUEST_MARKETING_WHATSAPP_LABEL,
  GUEST_SERVICE_CONTACT_NOTICE,
  GUEST_WHATSAPP_SERVICE_LABEL,
} from '@/lib/consent/constants'

/**
 * This app keeps its own copy of the consent wording and version, used whenever
 * it records a consent by itself (an unsubscribe link, a NOEVENTS reply, a staff
 * toggle, the guest email-capture page). There is no shared package with the
 * website, so the two copies drift unless something pins them.
 *
 * The strings below are the website's, from lib/communication-consent.ts on its
 * main branch on 8 October 2026, when it moved to v6. If the website changes its
 * wording, change the constants, this test and the version together.
 */
describe('guest communications consent wording', () => {
  it('is stamped with the version the website is on', () => {
    expect(GUEST_COMMS_CONSENT_TEXT_VERSION).toBe('guest-comms-consent-v6')
  })

  it('holds the words the website shows at that version', () => {
    expect(GUEST_SERVICE_CONTACT_NOTICE).toBe(
      'We will use your phone and email to manage this booking, including confirmations, reminders, payment links, waitlist updates, and changes.'
    )
    expect(GUEST_MARKETING_EMAIL_LABEL).toBe(
      'Email me the latest from The Anchor: quiz nights and bingo, new menus, offers, and any changes.'
    )
    expect(GUEST_MARKETING_SMS_LABEL).toBe(
      'Text me the latest from The Anchor: quiz nights and bingo, new menus, offers, and any changes.'
    )
    expect(GUEST_WHATSAPP_SERVICE_LABEL).toBe('Send booking updates by WhatsApp.')
    expect(GUEST_MARKETING_WHATSAPP_LABEL).toBe(
      'Send me WhatsApp updates on what is on, new menus, offers, and any changes.'
    )
  })
})
