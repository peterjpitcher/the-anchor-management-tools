import { describe, expect, it } from 'vitest'
import { buildSendSmsMetadata } from '@/lib/sms/metadata'

describe('buildSendSmsMetadata', () => {
  it('returns undefined when no metadata fields are present', () => {
    expect(buildSendSmsMetadata({})).toBeUndefined()
  })

  it('adds booking, template, and trigger metadata when provided', () => {
    expect(
      buildSendSmsMetadata({
        bookingId: 'booking-1',
        templateKey: 'private_booking_date_changed',
        triggerType: 'date_changed'
      })
    ).toEqual({
      booking_id: 'booking-1',
      template_key: 'private_booking_date_changed',
      trigger_type: 'date_changed'
    })
  })

  it('does not override explicit metadata values', () => {
    expect(
      buildSendSmsMetadata({
        bookingId: 'booking-1',
        templateKey: 'private_booking_date_changed',
        triggerType: 'date_changed',
        metadata: {
          booking_id: 'booking-explicit',
          template_key: 'explicit_template',
          trigger_type: 'explicit_trigger',
          source: 'manual'
        }
      })
    ).toEqual({
      booking_id: 'booking-explicit',
      template_key: 'explicit_template',
      trigger_type: 'explicit_trigger',
      source: 'manual'
    })
  })
})
