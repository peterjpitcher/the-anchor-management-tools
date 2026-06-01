import { describe, expect, it } from 'vitest'
import { selectChannel } from '@/lib/notifications/channel'

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
