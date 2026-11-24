// A second date change, or a reminder for moved dates, is a new message: it must not be refused
// as a conflicting retry of the first (PR 406 review).

import { describe, expect, it } from 'vitest'
import { buildSmsDedupContext } from '@/lib/sms/safety'

const base = { to: '+447700900123', customerId: 'customer-1', body: 'text' }

function key(metadata: Record<string, unknown>) {
  return buildSmsDedupContext({ ...base, metadata })?.key
}

describe('SMS dedupe scope for parking', () => {
  it('gives each date change its own key, and a retry of one change the same key', () => {
    const first = key({ template_key: 'parking_booking_changed', parking_booking_id: 'b1', change_id: 'c1' })
    expect(key({ template_key: 'parking_booking_changed', parking_booking_id: 'b1', change_id: 'c2' })).not.toBe(first)
    expect(key({ template_key: 'parking_booking_changed', parking_booking_id: 'b1', change_id: 'c1' })).toBe(first)
  })

  it('gives a reminder for moved dates its own key', () => {
    const old = key({ template_key: 'parking_session_start_3d', parking_booking_id: 'b1', subject_at: '2026-12-10T10:00:00.000Z' })
    expect(key({ template_key: 'parking_session_start_3d', parking_booking_id: 'b1', subject_at: '2026-12-12T10:00:00.000Z' })).not.toBe(old)
  })

  it('leaves the key unchanged for senders that pass neither', () => {
    const plain = key({ template_key: 'parking_payment_request', parking_booking_id: 'b1' })
    expect(key({ template_key: 'parking_payment_request', parking_booking_id: 'b1', other: 'x' })).toBe(plain)
  })
})
