export const PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID =
  'f9712733d9040b99f0ac9846911447034a4d70e8a6f06b571be130014606c504@group.calendar.google.com'

export function getSharedOperationsCalendarId(): string {
  return PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID
}

export function formatCalendarIdForLog(calendarId?: string): string {
  if (!calendarId) return 'NOT SET'
  if (calendarId === 'primary') return 'primary'
  return `${calendarId.substring(0, 10)}...`
}
