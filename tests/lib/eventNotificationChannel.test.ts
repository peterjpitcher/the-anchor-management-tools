import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { resolveEventNotificationChannel } from '@/services/event-bookings'

/**
 * The website says "we have sent you a message" only when this is not null.
 * Site review of 7 October 2026, finding MG-010.
 */
describe('which channel an event booking confirmation went by', () => {
  it('is email when the email went, whatever the text did', () => {
    expect(resolveEventNotificationChannel(true, null)).toBe('email')
    expect(resolveEventNotificationChannel(true, { success: false, code: 'twilio_error', logFailure: false })).toBe('email')
  })

  it('is sms when only the text went', () => {
    expect(resolveEventNotificationChannel(false, { success: true, code: null, logFailure: false })).toBe('sms')
  })

  it('is sms when the text went and only our log of it failed', () => {
    expect(resolveEventNotificationChannel(false, { success: false, code: 'logging_failed', logFailure: true })).toBe('sms')
  })

  it.each([
    ['no text was attempted', null],
    ['the text was refused', { success: false, code: 'twilio_error', logFailure: false }],
    ['the send threw', { success: false, code: 'unexpected_exception', logFailure: false }],
  ])('is null when %s and no email went', (_label, smsMeta) => {
    expect(resolveEventNotificationChannel(false, smsMeta)).toBeNull()
  })
})
