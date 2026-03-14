import crypto from 'crypto'

// UUID strings are always 36 chars; base64url(36 bytes) = 48 chars (no padding needed since 36 % 3 === 0).
// The HMAC signature is always 32 hex chars.
// Total token length: 80 chars, no separator — avoids the dot that Next.js treats as a file extension.
const ID_ENCODED_LENGTH = 48

/**
 * Generates a deterministic, HMAC-signed token for a booking ID.
 * The token is URL-safe and can be embedded in emails and links.
 * Format: <base64url(bookingId, 48 chars)><hmac-hex-32-chars> — 80 chars total, no separator.
 *
 * Uses CRON_SECRET as the signing key so only the server can generate valid tokens.
 * Token verification uses constant-time comparison to prevent timing attacks.
 */
export function generateBookingToken(bookingId: string): string {
  const secret = process.env.CRON_SECRET || 'dev-secret'
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(`booking-portal:${bookingId}`)
  const sig = hmac.digest('hex').slice(0, 32)
  const idEncoded = Buffer.from(bookingId).toString('base64url')
  return `${idEncoded}${sig}`
}

/**
 * Verifies a booking portal token and returns the booking ID if valid, or null if tampered/invalid.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyBookingToken(token: string): string | null {
  try {
    if (token.length < ID_ENCODED_LENGTH + 1) return null

    const idEncoded = token.slice(0, ID_ENCODED_LENGTH)
    const sig = token.slice(ID_ENCODED_LENGTH)
    if (!sig) return null

    const bookingId = Buffer.from(idEncoded, 'base64url').toString('utf-8')
    if (!bookingId) return null

    const expectedToken = generateBookingToken(bookingId)
    const expectedSig = expectedToken.slice(ID_ENCODED_LENGTH)

    if (sig.length !== expectedSig.length) return null

    const a = Buffer.from(sig)
    const b = Buffer.from(expectedSig)
    if (!crypto.timingSafeEqual(a, b)) return null

    return bookingId
  } catch {
    return null
  }
}
