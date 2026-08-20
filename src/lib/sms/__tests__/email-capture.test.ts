import { describe, it, expect } from 'vitest'
import { buildEmailCaptureMessage } from '@/lib/sms/email-capture'
import { countSmsSegments, normaliseToGsm7 } from '@/lib/sms/gsm7'

/**
 * The message is the whole product here. It goes to several hundred people at once, each
 * segment is billed separately, and it carries the only opt-out route those guests are
 * given, so these are the properties worth pinning rather than the exact wording.
 */

/**
 * Two link lengths matter, and confusing them is the bug these tests exist to catch.
 *
 * The builder receives the RAW link (~95 chars: a 43-character base64url token inside a
 * /g/<token>/email-capture path). sendSMS then shortens it to ~31 chars before dispatch.
 * Segment budgeting must therefore be done against the shortened length, or every variant
 * looks too long and the guest's name gets stripped from a message that had room for it.
 */
const RAW_LINK = `https://management.orangejelly.co.uk/g/${'a'.repeat(43)}/email-capture`
const SHORTENED_LINK = 'https://l.the-anchor.pub/abc123'

/** What the guest actually receives: the built body with the link shortened. */
function asSent(body: string): string {
  return body.replace(RAW_LINK, SHORTENED_LINK)
}

describe('the email capture message fits one segment', () => {
  it.each([
    ['a short name', 'Sam'],
    ['a longer name', 'Christopher'],
    ['the fallback when the name is unusable', 'there'],
  ])('stays in one segment with %s', (_case, firstName) => {
    // A second segment doubles the cost of the entire send, which is the one thing that
    // turns this from nearly free into an expensive mistake.
    const body = asSent(buildEmailCaptureMessage(firstName, RAW_LINK))
    expect(countSmsSegments(normaliseToGsm7(body))).toBe(1)
  })

  it('drops the name rather than spilling into a second segment', () => {
    const absurdName = 'Bartholomew Fitzwilliam Montgomery'
    const body = asSent(buildEmailCaptureMessage(absurdName, RAW_LINK))
    expect(countSmsSegments(normaliseToGsm7(body))).toBe(1)
  })
})

describe('the message says what it has to say', () => {
  it('always carries the NOEVENTS opt-out', () => {
    // Soft opt-in requires a simple way to refuse. A marketing text without one is the
    // single thing that would make this send unlawful rather than merely unwelcome.
    for (const name of ['Sam', 'Christopher', 'Bartholomew Fitzwilliam Montgomery']) {
      expect(buildEmailCaptureMessage(name, RAW_LINK)).toContain('NOEVENTS')
    }
  })

  it('always carries the link', () => {
    expect(buildEmailCaptureMessage('Sam', RAW_LINK)).toContain(RAW_LINK)
  })

  it('names the pub, so it does not read as spam from an unknown number', () => {
    expect(buildEmailCaptureMessage('Sam', RAW_LINK)).toContain('The Anchor')
  })

  it('uses the name when it fits', () => {
    expect(buildEmailCaptureMessage('Sam', RAW_LINK)).toContain('Sam')
  })

  it('says why we are asking, not just what we want', () => {
    // "We have your number but not your email" gives the guest a reason. A bare request for
    // an address from a pub reads as data collection and gets ignored.
    expect(buildEmailCaptureMessage('Sam', RAW_LINK)).toMatch(/not your email/i)
  })
})
