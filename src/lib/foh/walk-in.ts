export const WALK_IN_TODAY_ONLY_MESSAGE =
  'Walk-ins can only be added for today. Use Add booking for another date.'

export function isFohWalkInDateAllowed(input: {
  walkIn: boolean
  bookingDate: string
  todayIso: string
}): boolean {
  return !input.walkIn || input.bookingDate === input.todayIso
}

export function shouldSeatFohWalkIn(input: {
  walkIn: boolean
  bookingDate: string
  todayIso: string
}): boolean {
  return input.walkIn && input.bookingDate === input.todayIso
}
