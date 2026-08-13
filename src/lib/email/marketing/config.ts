/**
 * Environment configuration for the B2B marketing sender.
 *
 * Parsed here rather than in `src/lib/env.ts` because that module has no notion of an
 * optional-with-fallback variable, and because a missing marketing variable must not stop
 * the rest of the app from booting. Everything transactional keeps working whether or not
 * marketing is configured.
 *
 * MARKETING REQUIRES RESEND. Not a preference: the marketing sender depends on Resend's
 * idempotency keys to guarantee it never sends twice, and on Resend webhooks for opens,
 * bounces and complaints. Microsoft Graph offers neither, so a silent fallback to Graph
 * would quietly turn a send-exactly-once guarantee into a send-maybe-twice one. When
 * RESEND_API_KEY is absent this config is not ok and the cron does nothing at all.
 */

/** UTM tagging applied to venue links inside marketing emails. */
export const MARKETING_UTM_SOURCE = 'marketing_email'
export const MARKETING_UTM_MEDIUM = 'email'

export type MarketingConfig =
  | { ok: true; from: string; replyTo: string | undefined }
  | { ok: false; missing: string[] }

/**
 * Accepts either a bare address or the RFC 5322 display form, `Name <address>`.
 *
 * Deliberately loose. This is a configuration typo guard, not an address validator: a
 * regex strict enough to reject every invalid address also rejects valid ones, and the
 * provider is the real authority on what it will accept.
 */
function looksLikeSender(value: string): boolean {
  const angled = value.match(/^[^<>]*<([^<>]+)>$/)
  const address = (angled ? angled[1] : value).trim()
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address)
}

function readTrimmed(name: string): string | undefined {
  const raw = process.env[name]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * The hard off switch, independent of the database kill switch in `marketing_settings`.
 *
 * Two switches on purpose. The database one is the everyday control a manager uses in the
 * UI; this one is the break-glass that works even if the database is the thing misbehaving,
 * and it can be flipped in Vercel without a deploy.
 *
 * Only the literal string 'false' disables. An unset or misspelt value must not silently
 * stop marketing, because a sender that has quietly stopped looks identical to one that has
 * nothing to send.
 */
export function isMarketingHardDisabled(): boolean {
  return process.env.MARKETING_SEND_ENABLED?.trim().toLowerCase() === 'false'
}

/**
 * Sender identity for marketing email, or the list of what is missing.
 *
 * Returns a result rather than throwing so the cron can report a clear "not configured"
 * and exit 200. A throw here would surface as a cron failure alert every five minutes on
 * an environment where marketing was simply never set up.
 */
export function getMarketingConfig(): MarketingConfig {
  const missing: string[] = []

  const from = readTrimmed('MARKETING_EMAIL_FROM_ADDRESS')
  if (!from) {
    missing.push('MARKETING_EMAIL_FROM_ADDRESS')
  } else if (!looksLikeSender(from)) {
    missing.push('MARKETING_EMAIL_FROM_ADDRESS (must be an email address or "Name <email>")')
  }

  if (!readTrimmed('RESEND_API_KEY')) {
    missing.push('RESEND_API_KEY')
  }

  if (missing.length > 0) {
    return { ok: false, missing }
  }

  // Falls back to the venue's general reply-to. Marketing replies should reach a human
  // either way, so an unset override is normal rather than an error.
  const replyTo = readTrimmed('MARKETING_EMAIL_REPLY_TO') ?? readTrimmed('EMAIL_REPLY_TO')

  return { ok: true, from: from as string, replyTo }
}
