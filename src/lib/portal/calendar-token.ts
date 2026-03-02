import { createHmac } from 'crypto'

export function generateCalendarToken(employeeId: string): string {
  return createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'fallback-no-key')
    .update(employeeId)
    .digest('hex')
    .slice(0, 32)
}

export function verifyCalendarToken(employeeId: string, token: string): boolean {
  return generateCalendarToken(employeeId) === token
}
