import crypto from 'crypto'

/**
 * Signed, time-limited tokens for the public invoice payment page.
 *
 * Deliberately the same shape as the private booking portal token
 * (`src/lib/private-bookings/booking-token.ts`): stateless, so there is no
 * table to keep in step and no row to leak, and positional rather than
 * separated, because a dot in the path makes Next.js treat the segment as a
 * file extension.
 *
 * The payload prefix differs from the booking one, so a booking portal token
 * can never be replayed against an invoice even though both are signed with
 * the same secret.
 */

// UUID strings are always 36 chars; base64url(36 bytes) = 48 chars.
const ID_ENCODED_LENGTH = 48
// Unix seconds as fixed-width hex, good until 2106.
const EXPIRY_ENCODED_LENGTH = 8
const SIGNATURE_LENGTH = 32
const TOKEN_LENGTH = ID_ENCODED_LENGTH + EXPIRY_ENCODED_LENGTH + SIGNATURE_LENGTH

/**
 * Shorter than the booking portal's year, because an invoice is a demand for
 * payment rather than a record the customer lives with. Terms default to seven
 * days, chasers run for a while after that, and a link that still works months
 * later is a liability rather than a courtesy. Re-send to reissue.
 */
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Shared with the booking portal token on purpose: one secret to rotate for
 * customer-facing links. Rotating it invalidates outstanding links, which then
 * need re-sending.
 */
function getSigningSecret(): string {
  return process.env.PRIVATE_BOOKING_TOKEN_SECRET || process.env.CRON_SECRET || 'dev-secret'
}

function sign(payload: string): string {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('hex')
    .slice(0, SIGNATURE_LENGTH)
}

function signaturesMatch(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

/**
 * Format: <base64url(invoiceId, 48)><expiry-hex-8><hmac-hex-32>.
 *
 * The expiry sits inside the signed payload, so it cannot be edited without
 * invalidating the token.
 */
export function generateInvoiceToken(invoiceId: string): string {
  const expiresAt = Math.floor((Date.now() + TOKEN_TTL_MS) / 1000)
  const expiryEncoded = expiresAt.toString(16).padStart(EXPIRY_ENCODED_LENGTH, '0')
  const idEncoded = Buffer.from(invoiceId).toString('base64url')
  return `${idEncoded}${expiryEncoded}${sign(`invoice-portal:${invoiceId}:${expiryEncoded}`)}`
}

/**
 * Returns the invoice id, or null if the token is tampered with, malformed or
 * expired. There is no legacy format to accept: this page is new.
 */
export function verifyInvoiceToken(token: string): string | null {
  try {
    if (token.length !== TOKEN_LENGTH) return null

    const idEncoded = token.slice(0, ID_ENCODED_LENGTH)
    const invoiceId = Buffer.from(idEncoded, 'base64url').toString('utf-8')
    if (!invoiceId) return null

    const expiryEncoded = token.slice(ID_ENCODED_LENGTH, ID_ENCODED_LENGTH + EXPIRY_ENCODED_LENGTH)
    const sig = token.slice(ID_ENCODED_LENGTH + EXPIRY_ENCODED_LENGTH)

    if (!signaturesMatch(sig, sign(`invoice-portal:${invoiceId}:${expiryEncoded}`))) return null

    // Signature first: only trust the expiry once we know the token is ours.
    const expiresAtMs = Number.parseInt(expiryEncoded, 16) * 1000
    if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) return null

    return invoiceId
  } catch {
    return null
  }
}
