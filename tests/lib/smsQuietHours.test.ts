import { describe, expect, it } from 'vitest'
import {
  evaluateSmsQuietHours,
  SMS_QUIET_HOUR_END,
  SMS_QUIET_HOUR_START,
  SMS_TIMEZONE
} from '@/lib/sms/quiet-hours'

describe('evaluateSmsQuietHours', () => {
  it('marks 09:00 London time as allowed', () => {
    const now = new Date('2026-02-07T09:00:00Z') // GMT in February
    const result = evaluateSmsQuietHours(now)

    expect(result.inQuietHours).toBe(false)
    expect(result.nextAllowedSendAt.toISOString()).toBe('2026-02-07T09:00:00.000Z')
    expect(result.timezone).toBe(SMS_TIMEZONE)
  })

  it('marks 21:00 London time as quiet hours', () => {
    const now = new Date('2026-02-07T21:00:00Z') // GMT in February
    const result = evaluateSmsQuietHours(now)

    expect(result.inQuietHours).toBe(true)
    expect(result.nextAllowedSendAt.toISOString()).toBe('2026-02-08T09:00:00.000Z')
  })

  it('returns next allowed send at 09:00 same day during early morning quiet hours', () => {
    const now = new Date('2026-02-07T08:30:00Z')
    const result = evaluateSmsQuietHours(now)

    expect(result.inQuietHours).toBe(true)
    expect(result.nextAllowedSendAt.toISOString()).toBe('2026-02-07T09:00:00.000Z')
  })

  it('handles daylight saving time correctly in summer', () => {
    const now = new Date('2026-07-15T20:30:00Z') // 21:30 in Europe/London (BST)
    const result = evaluateSmsQuietHours(now)

    expect(result.inQuietHours).toBe(true)
    expect(result.nextAllowedSendAt.toISOString()).toBe('2026-07-16T08:00:00.000Z') // 09:00 BST
  })

  it('uses the configured policy constants', () => {
    expect(SMS_QUIET_HOUR_START).toBe(21)
    expect(SMS_QUIET_HOUR_END).toBe(9)
    expect(SMS_TIMEZONE).toBe('Europe/London')
  })
})
