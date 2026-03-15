import { createHmac, timingSafeEqual } from 'crypto'

export function generateCalendarToken(employeeId: string): string {
  return createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'fallback-no-key')
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
