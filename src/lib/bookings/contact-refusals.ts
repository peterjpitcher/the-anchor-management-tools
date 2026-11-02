import type { ZodIssue } from 'zod'

/**
 * Answers the public booking routes give for a phone number or email the guest has to correct.
 *
 * They have their own codes because the website reports VALIDATION_ERROR on a booking route as the
 * two systems disagreeing about the rules, and emails an ACTION NEEDED alert. These two are not
 * that: the website checks only that a phone has seven digits and that an email looks roughly
 * right, and the rules here are stricter. On 2 November 2026 a North American number typed as
 * "1 919 ..." with no plus was read as a UK number and refused, the alert went out, and the guest
 * booked 18 seconds later with the +1 added.
 */
export const INVALID_PHONE_CODE = 'INVALID_PHONE'
export const INVALID_PHONE_MESSAGE =
  "Please check your phone number. If it isn't a UK number, start it with + and the country code."

export const INVALID_EMAIL_CODE = 'INVALID_EMAIL'
export const INVALID_EMAIL_MESSAGE = 'Please check your email address.'

/** True when every problem zod found is with the email, so the refusal is the guest's to fix. */
export function isOnlyEmailInvalid(issues: readonly ZodIssue[]): boolean {
  return issues.length > 0 && issues.every((issue) => issue.path[0] === 'email')
}
