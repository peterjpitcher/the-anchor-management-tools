import { describe, expect, it } from 'vitest'
import { buildSmsDedupContext } from '@/lib/sms/safety'

describe('buildSmsDedupContext', () => {
  it('returns null when template_key is missing', () => {
    expect(
      buildSmsDedupContext({
        to: '+447700900123',
        customerId: 'customer-1',
        body: 'hello',
        metadata: { event_id: 'event-1' }
      })
    ).toBeNull()
  })

  it('builds stable key for same template and identity context', () => {
    const first = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'hello world',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1',
        event_id: 'event-1'
      }
    })

    const second = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'hello world',
      metadata: {
        event_id: 'event-1',
        event_booking_id: 'booking-1',
        template_key: 'event_review_followup'
      }
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.key).toBe(second?.key)
    expect(first?.requestHash).toBe(second?.requestHash)
  })

  it('changes request hash when body changes but keeps dedupe key', () => {
    const first = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'first body',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1'
      }
    })

    const second = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'second body',
      metadata: {
        template_key: 'event_review_followup',
        event_booking_id: 'booking-1'
      }
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.key).toBe(second?.key)
    expect(first?.requestHash).not.toBe(second?.requestHash)
  })

  it('changes dedupe key when bulk campaign id changes', () => {
    const first = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'campaign message',
      metadata: {
        template_key: 'bulk_sms_campaign',
        bulk_job_id: 'bulk-job-1'
      }
    })

    const second = buildSmsDedupContext({
      to: '+447700900123',
      customerId: 'customer-1',
      body: 'campaign message',
      metadata: {
        template_key: 'bulk_sms_campaign',
        bulk_job_id: 'bulk-job-2'
      }
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.key).not.toBe(second?.key)
  })
})
