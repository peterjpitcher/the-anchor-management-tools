export const WALK_IN_TODAY_ONLY_MESSAGE =
  'Walk-ins can only be added for today. Use Add booking for another date.'

// `serviceDateNow` is the service date in force (resolveTradingDayNow), not the calendar date:
// from midnight until an after-midnight close (1am on New Year's Eve) it is the night before,
// so a party walking in at 00:30 on 1 January joins 31 December's service.

export function isFohWalkInDateAllowed(input: {
  walkIn: boolean
  bookingDate: string
  serviceDateNow: string
}): boolean {
  return !input.walkIn || input.bookingDate === input.serviceDateNow
}

export function shouldSeatFohWalkIn(input: {
  walkIn: boolean
  bookingDate: string
  serviceDateNow: string
}): boolean {
  return input.walkIn && input.bookingDate === input.serviceDateNow
}
