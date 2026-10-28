import crypto from 'crypto'
import { getAppUrl } from '@/lib/env'
import { shiftIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'

// UUID strings are always 36 chars; base64url(36 bytes) = 48 chars (no padding needed since 36 % 3 === 0).
// The issue time and the expiry are unix seconds as fixed-width hex (8 chars each, good until 2106).
// The HMAC signature is always 32 hex chars.
// Total token length: 96 chars, no separator, so the split is positional and avoids the dot that
// Next.js treats as a file extension.
const ID_ENCODED_LENGTH = 48
const EXPIRY_ENCODED_LENGTH = 8
const ISSUED_ENCODED_LENGTH = 8
const SIGNATURE_LENGTH = 32
const TOKEN_LENGTH = ID_ENCODED_LENGTH + ISSUED_ENCODED_LENGTH + EXPIRY_ENCODED_LENGTH + SIGNATURE_LENGTH

// Tokens issued before 28 October 2026 carry no issue time: id + expiry + signature, 88 chars.
// They keep working until they expire, or until staff switch the booking's links off (BK-204).
const UNDATED_TOKEN_LENGTH = ID_ENCODED_LENGTH + EXPIRY_ENCODED_LENGTH + SIGNATURE_LENGTH

// Tokens issued before the expiry was added are 80 chars: id + signature only.
const LEGACY_TOKEN_LENGTH = ID_ENCODED_LENGTH + SIGNATURE_LENGTH

// A customer keeps their portal link from enquiry through to the event, and bookings are taken
// up to a year ahead, so the window is long: a year at most, and never more than 30 days after the
// event (BK-204). A booking whose date is still to be confirmed gets the year.
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000
const DAYS_AFTER_EVENT = 30
// A link sent for an event already past (a late balance, say) still lasts long enough to use.
const MIN_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Links already sitting in customers' inboxes carry the old, non-expiring
// format. They keep working until this date so nobody is cut off mid-booking,
// after which only expiring tokens are accepted. Re-send a portal or deposit
// link to reissue one.
const LEGACY_TOKEN_SUNSET_MS = Date.parse('2026-11-30T00:00:00Z')

/**
 * The key the portal tokens are signed with.
 *
 * PRIVATE_BOOKING_TOKEN_SECRET is the intended home: CRON_SECRET exists to
 * authorise Vercel cron calls, and one secret doing two unrelated jobs means
 * rotating it for one breaks the other. CRON_SECRET stays as the fallback so
 * live links keep verifying until the new variable is configured; set
 * PRIVATE_BOOKING_TOKEN_SECRET to a fresh random value and the tokens signed
 * with the old key stop being accepted (customers need a re-sent link).
 */
function getSigningSecret(): string {
  return process.env.PRIVATE_BOOKING_TOKEN_SECRET || process.env.CRON_SECRET || 'dev-secret'
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex').slice(0, SIGNATURE_LENGTH)
}

function signaturesMatch(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export interface PortalLinkOptions {
  /** The event date (YYYY-MM-DD). The link stops working 30 days after it. */
  eventDate?: string | null
  /** True while the date is to be confirmed: the stored date is a placeholder, so it is ignored. */
  dateTbd?: boolean | null
}

/** When a link issued now stops working, in unix seconds. */
function expirySeconds(nowMs: number, options: PortalLinkOptions): number {
  let expiresMs = nowMs + TOKEN_TTL_MS
  const eventIso = options.dateTbd ? null : options.eventDate?.slice(0, 10) ?? null
  const lastDay = eventIso ? shiftIsoDate(eventIso, DAYS_AFTER_EVENT + 1) : null
  // Midnight in London at the end of the 30th day after the event.
  const capMs = lastDay ? whenLondonClockReaches(lastDay, '00:00')?.getTime() ?? null : null
  if (capMs !== null && Number.isFinite(capMs)) {
    expiresMs = Math.min(expiresMs, Math.max(capMs, nowMs + MIN_TTL_MS))
  }
  return Math.floor(expiresMs / 1000)
}

/**
 * Generates an HMAC-signed, time-limited token for a booking ID.
 * The token is URL-safe and can be embedded in emails and links.
 * Format: <base64url(bookingId, 48 chars)><issued-hex-8><expiry-hex-8><hmac-hex-32>.
 *
 * The issue time and the expiry are inside the signed payload, so neither can be edited without
 * invalidating the token. The issue time lets staff switch off every link issued before a moment
 * (private_bookings.portal_links_revoked_at) without touching the links issued after it.
 * Verification uses constant-time comparison.
 */
export function generateBookingToken(bookingId: string, options: PortalLinkOptions = {}): string {
  const nowMs = Date.now()
  const issuedEncoded = Math.floor(nowMs / 1000).toString(16).padStart(ISSUED_ENCODED_LENGTH, '0')
  const expiryEncoded = expirySeconds(nowMs, options).toString(16).padStart(EXPIRY_ENCODED_LENGTH, '0')
  const idEncoded = Buffer.from(bookingId).toString('base64url')
  return `${idEncoded}${issuedEncoded}${expiryEncoded}${sign(`booking-portal:${bookingId}:${issuedEncoded}:${expiryEncoded}`)}`
}

/**
 * The guest's booking page for a private booking: it shows the booking and the deposit, and its
 * "Pay deposit via PayPal" button makes (or reuses) a PayPal order when the guest presses it, so
 * an email scanner opening the link never creates one. The link lasts up to a year, and never
 * more than 30 days after the event, unlike a PayPal approval link, which runs out within hours.
 *
 * Null when the app URL (getAppUrl) is not an http or https URL, so no message ever carries a
 * link a guest cannot open.
 */
export function buildPrivateBookingPortalUrl(bookingId: string, options: PortalLinkOptions = {}): string | null {
  const base = getAppUrl()
  if (!/^https?:\/\/[^/]+/i.test(base)) return null
  return `${base}/booking-portal/${generateBookingToken(bookingId, options)}`
}

export interface VerifiedBookingToken {
  bookingId: string
  /** Unix seconds the link was issued, or null for a link from before issue times were kept. */
  issuedAt: number | null
}

/**
 * Verifies a booking portal token's signature and expiry. It does not check whether staff have
 * switched the booking's links off: verifyPortalAccess (portal-access.ts) does, and is what the
 * booking page and its actions use.
 */
export function readBookingToken(token: string): VerifiedBookingToken | null {
  try {
    if (token.length !== TOKEN_LENGTH && token.length !== UNDATED_TOKEN_LENGTH && token.length !== LEGACY_TOKEN_LENGTH) {
      return null
    }

    const idEncoded = token.slice(0, ID_ENCODED_LENGTH)
    const bookingId = Buffer.from(idEncoded, 'base64url').toString('utf-8')
    if (!bookingId) return null

    if (token.length === LEGACY_TOKEN_LENGTH) {
      if (Date.now() >= LEGACY_TOKEN_SUNSET_MS) return null
      const legacySig = token.slice(ID_ENCODED_LENGTH)
      if (!signaturesMatch(legacySig, sign(`booking-portal:${bookingId}`))) return null
      return { bookingId, issuedAt: null }
    }

    let issuedEncoded: string | null = null
    let rest = token.slice(ID_ENCODED_LENGTH)
    if (token.length === TOKEN_LENGTH) {
      issuedEncoded = rest.slice(0, ISSUED_ENCODED_LENGTH)
      rest = rest.slice(ISSUED_ENCODED_LENGTH)
    }
    const expiryEncoded = rest.slice(0, EXPIRY_ENCODED_LENGTH)
    const sig = rest.slice(EXPIRY_ENCODED_LENGTH)
    const payload = issuedEncoded
      ? `booking-portal:${bookingId}:${issuedEncoded}:${expiryEncoded}`
      : `booking-portal:${bookingId}:${expiryEncoded}`

    if (!signaturesMatch(sig, sign(payload))) return null

    // Signature checked first: only trust the expiry once we know it is ours.
    const expiresAtMs = Number.parseInt(expiryEncoded, 16) * 1000
    if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) return null

    const issuedAt = issuedEncoded ? Number.parseInt(issuedEncoded, 16) : null
    return { bookingId, issuedAt: issuedAt !== null && Number.isFinite(issuedAt) ? issuedAt : null }
  } catch {
    return null
  }
}

/**
 * Verifies a booking portal token and returns the booking ID if valid, or null if it is tampered
 * with, unknown or expired. Signature and expiry only; see readBookingToken.
 */
export function verifyBookingToken(token: string): string | null {
  return readBookingToken(token)?.bookingId ?? null
}
