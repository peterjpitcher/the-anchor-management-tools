import { describe, expect, it } from 'vitest'
import { isEmailUsable, selectChannel } from '@/lib/notifications/channel'

describe('isEmailUsable', () => {
  it('accepts a well-formed address with no hard failure on the record', () => {
    expect(isEmailUsable({ email: 'guest@example.com' })).toBe(true)
    expect(isEmailUsable({ email: ' guest@example.com ', email_status: 'active' })).toBe(true)
    expect(isEmailUsable({ email: 'guest@example.com', email_status: null, email_deactivated_at: null })).toBe(true)
  })

  it('rejects a missing or malformed address', () => {
    expect(isEmailUsable(null)).toBe(false)
    expect(isEmailUsable(undefined)).toBe(false)
    expect(isEmailUsable({})).toBe(false)
    expect(isEmailUsable({ email: '   ' })).toBe(false)
    expect(isEmailUsable({ email: 'not-an-address' })).toBe(false)
    expect(isEmailUsable({ email: 'guest@example' })).toBe(false)
  })

  it.each(['invalid', 'bounced', 'complained'])('rejects an address marked %s', (status) => {
    expect(isEmailUsable({ email: 'guest@example.com', email_status: status })).toBe(false)
  })

  it('rejects a deactivated address', () => {
    expect(isEmailUsable({ email: 'guest@example.com', email_deactivated_at: '2026-09-01T10:00:00Z' })).toBe(false)
  })
})

describe('selectChannel', () => {
  it('prefers email and falls back to SMS for email_first', () => {
    expect(selectChannel({
      policy: 'email_first',
      urgency: 'standard',
      eligibility: { email: true, sms: true },
    })).toEqual({ channels: ['email', 'sms'] })

    expect(selectChannel({
      policy: 'email_first',
      urgency: 'standard',
      eligibility: { email: false, sms: true },
    })).toEqual({ channels: ['sms'] })
  })

  it('forbids email-only and email-first policies for time-critical comms', () => {
    expect(selectChannel({
      policy: 'email_only',
      urgency: 'time_critical',
      eligibility: { email: true, sms: true },
    })).toEqual({ channels: [], reason: 'invalid_time_critical_email_only' })

    expect(selectChannel({
      policy: 'email_first',
      urgency: 'time_critical',
      eligibility: { email: true, sms: true },
    })).toEqual({ channels: [], reason: 'invalid_time_critical_email_first' })
  })

  it('returns no_channel_available when every configured channel is ineligible', () => {
    expect(selectChannel({
      policy: 'both',
      urgency: 'standard',
      eligibility: { email: false, sms: false },
    })).toEqual({ channels: [], reason: 'no_channel_available' })
  })
})
