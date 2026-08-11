import crypto from 'crypto'

// UUID strings are always 36 chars; base64url(36 bytes) = 48 chars (no padding needed since 36 % 3 === 0).
// The expiry is unix seconds as fixed-width hex (8 chars, good until 2106).
// The HMAC signature is always 32 hex chars.
// Total token length: 88 chars, no separator, so the id/expiry/signature split
// is positional and avoids the dot that Next.js treats as a file extension.
const ID_ENCODED_LENGTH = 48
const EXPIRY_ENCODED_LENGTH = 8
const SIGNATURE_LENGTH = 32
const TOKEN_LENGTH = ID_ENCODED_LENGTH + EXPIRY_ENCODED_LENGTH + SIGNATURE_LENGTH

// Tokens issued before the expiry was added are 80 chars: id + signature only.
const LEGACY_TOKEN_LENGTH = ID_ENCODED_LENGTH + SIGNATURE_LENGTH

// A customer keeps their portal link from enquiry through to the event, and
// bookings are taken up to a year ahead, so the window has to be long. It is
// still a window: an old link stops working instead of lasting forever.
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000

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

/**
 * Generates an HMAC-signed, time-limited token for a booking ID.
 * The token is URL-safe and can be embedded in emails and links.
 * Format: <base64url(bookingId, 48 chars)><expiry-hex-8-chars><hmac-hex-32-chars>.
 *
 * The expiry is inside the signed payload, so it cannot be edited without
 * invalidating the token. Verification uses constant-time comparison.
 */
export function generateBookingToken(bookingId: string): string {
  const expiresAt = Math.floor((Date.now() + TOKEN_TTL_MS) / 1000)
  const expiryEncoded = expiresAt.toString(16).padStart(EXPIRY_ENCODED_LENGTH, '0')
  const idEncoded = Buffer.from(bookingId).toString('base64url')
  return `${idEncoded}${expiryEncoded}${sign(`booking-portal:${bookingId}:${expiryEncoded}`)}`
}

/**
 * Verifies a booking portal token and returns the booking ID if valid, or null
 * if it is tampered with, unknown or expired.
 */
export function verifyBookingToken(token: string): string | null {
  try {
    if (token.length !== TOKEN_LENGTH && token.length !== LEGACY_TOKEN_LENGTH) return null

    const idEncoded = token.slice(0, ID_ENCODED_LENGTH)
    const bookingId = Buffer.from(idEncoded, 'base64url').toString('utf-8')
    if (!bookingId) return null

    if (token.length === LEGACY_TOKEN_LENGTH) {
      if (Date.now() >= LEGACY_TOKEN_SUNSET_MS) return null
      const legacySig = token.slice(ID_ENCODED_LENGTH)
      if (!signaturesMatch(legacySig, sign(`booking-portal:${bookingId}`))) return null
      return bookingId
    }

    const expiryEncoded = token.slice(ID_ENCODED_LENGTH, ID_ENCODED_LENGTH + EXPIRY_ENCODED_LENGTH)
    const sig = token.slice(ID_ENCODED_LENGTH + EXPIRY_ENCODED_LENGTH)

    if (!signaturesMatch(sig, sign(`booking-portal:${bookingId}:${expiryEncoded}`))) return null

    // Signature checked first: only trust the expiry once we know it is ours.
    const expiresAtMs = Number.parseInt(expiryEncoded, 16) * 1000
    if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) return null

    return bookingId
  } catch {
    return null
  }
}
