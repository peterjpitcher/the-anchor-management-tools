import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  describeGuestNotificationChannel,
  describeGuestNotificationProblem,
  readGuestNotificationOutcome,
} from './guest-notification-outcome'

/**
 * What staff are told about a guest message. A guest who was not reached must be visible on
 * the screen that made the change; a guest who was reached needs no second message.
 */

describe('readGuestNotificationOutcome', () => {
  it('reads an outcome from a route payload', () => {
    expect(
      readGuestNotificationOutcome({ status: 'failed', channel: null, fallbackUsed: false, error: 'Twilio 21211' })
    ).toEqual({ status: 'failed', channel: null, fallbackUsed: false, error: 'Twilio 21211' })
  })

  it('returns null for a payload from the text-only path, which reports nothing', () => {
    expect(readGuestNotificationOutcome(undefined)).toBeNull()
    expect(readGuestNotificationOutcome(null)).toBeNull()
    expect(readGuestNotificationOutcome({})).toBeNull()
    expect(readGuestNotificationOutcome({ status: 'exploded' })).toBeNull()
  })
})

describe('describeGuestNotificationProblem', () => {
  it('asks staff to contact a guest nothing reached', () => {
    expect(
      describeGuestNotificationProblem(
        { status: 'failed', channel: null, fallbackUsed: false, error: 'x' },
        'about the cancellation'
      )
    ).toBe('We could not reach the guest about the cancellation by email or text. Please contact them.')
  })

  it('says why when the guest has no usable email or mobile', () => {
    expect(
      describeGuestNotificationProblem(
        { status: 'no_channel', channel: null, fallbackUsed: false, error: 'no_channel_available' },
        'about the cancellation'
      )
    ).toBe(
      'The guest has no email address or mobile number we can use, so they have not been told about the cancellation. Please contact them.'
    )
  })

  it('stays quiet when the guest was reached, or there is no outcome at all', () => {
    expect(
      describeGuestNotificationProblem({ status: 'sent', channel: 'sms', fallbackUsed: true, error: null }, 'x')
    ).toBeNull()
    expect(
      describeGuestNotificationProblem({ status: 'already_sent', channel: null, fallbackUsed: false, error: null }, 'x')
    ).toBeNull()
    expect(describeGuestNotificationProblem(null, 'x')).toBeNull()
  })
})

describe('describeGuestNotificationChannel', () => {
  it('names the channel that reached the guest', () => {
    expect(describeGuestNotificationChannel({ status: 'sent', channel: 'email', fallbackUsed: false, error: null })).toBe('by email')
    expect(describeGuestNotificationChannel({ status: 'sent', channel: 'sms', fallbackUsed: true, error: null })).toBe('by text')
    expect(describeGuestNotificationChannel({ status: 'failed', channel: null, fallbackUsed: false, error: 'x' })).toBeNull()
  })
})

describe('the cancel routes and screens carry the outcome through', () => {
  /**
   * The helpers above are only useful if the routes return the outcome and the screens read it.
   * Without that the failure would be written to the audit log and nobody at the pass would know.
   */
  it('returns guest_notification from all three cancel routes', () => {
    for (const route of [
      'src/app/api/foh/bookings/[id]/cancel/route.ts',
      'src/app/api/boh/table-bookings/[id]/status/route.ts',
      'src/app/api/boh/table-bookings/[id]/route.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), route), 'utf8')
      expect(source).toContain('guest_notification: guestNotification')
      expect(source).toContain('cancelOutcome?.notification')
    }
  })

  it('shows the warning on the FOH and BOH screens', () => {
    const foh = readFileSync(
      join(process.cwd(), 'src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx'),
      'utf8'
    )
    expect(foh).toContain('describeGuestNotReached(result)')
    expect(foh).toContain('setErrorMessage(guestNotReached)')

    const boh = readFileSync(
      join(process.cwd(), 'src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx'),
      'utf8'
    )
    expect(boh.match(/warnIfCancellationNotReached\(payload\)/g)?.length).toBe(2)
  })
})
