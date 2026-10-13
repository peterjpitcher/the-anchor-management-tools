import crypto from 'crypto'
import { getAppUrl } from '@/lib/env'

/**
 * One-time signing links. The raw token goes in the email and nowhere else; the database holds
 * only its SHA-256, so a copy of the table cannot be turned back into working links. Same
 * arrangement as guest tokens (src/lib/guest/tokens.ts).
 */
export function generateSigningToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashSigningToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

/** A token we issued is 43 base64url characters. Anything else is not worth a database read. */
export function isWellFormedSigningToken(rawToken: string | null | undefined): rawToken is string {
  return typeof rawToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(rawToken)
}

export function buildSigningUrl(rawToken: string): string {
  return `${getAppUrl()}/sign/${rawToken}`
}

export function sha256Hex(data: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** The raw token inside a signing link, for keeping it out of stored copies of an email. */
export function signingTokenFromUrl(signingUrl: string): string | null {
  const token = signingUrl.split('/sign/')[1]?.split(/[/?#]/)[0] ?? null
  return isWellFormedSigningToken(token) ? token : null
}
