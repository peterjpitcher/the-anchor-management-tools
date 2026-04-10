import { createHmac, timingSafeEqual } from 'crypto'

function getTokenSecret(): string {
  const secret = process.env.CALENDAR_TOKEN_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('CALENDAR_TOKEN_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set')
  return secret
}

export function generateCalendarToken(employeeId: string): string {
  return createHmac('sha256', getTokenSecret())
    .update(employeeId)
    .digest('hex')
    .slice(0, 32)
}

export function verifyCalendarToken(employeeId: string, token: string): boolean {
  const expected = generateCalendarToken(employeeId)
  if (expected.length !== token.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  } catch {
    return false
  }
}

/**
 * Generate a per-user rota feed token.
 * Uses a 'rota-feed:' prefix to avoid collisions with employee calendar tokens.
 */
export function generateRotaFeedToken(userId: string): string {
  return createHmac('sha256', getTokenSecret())
    .update(`rota-feed:${userId}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Verify a rota feed token and extract the user ID.
 * Returns the userId if valid, null otherwise.
 */
export function verifyRotaFeedToken(userId: string, token: string): boolean {
  const expected = generateRotaFeedToken(userId)
  if (expected.length !== token.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  } catch {
    return false
  }
}
