import { describe, it, expect } from 'vitest'

import {
  OPS_ALERT_SMS_NUMBER_ENV,
  PAYMENT_FAILURE_ALERT_WINDOW_MINUTES,
  PAYMENT_FAILURE_AREAS,
  PAYMENT_FAILURE_REASONS,
  buildPaymentFailureAlertText,
  paymentFailureAlertSlot,
  resolveOpsAlertSmsNumber,
} from './payment-failure-alert'

// A number from Ofcom's reserved drama range. It can never belong to anyone.
const FIXTURE_NUMBER = '+447700900123'

// Letters, digits, spaces and the punctuation the wording uses. All of it is in
// the GSM-7 basic set, so the text is billed as 160 characters per segment.
const PLAIN_GSM7 = /^[A-Za-z0-9 .,:'()-]+$/

describe('the payment failure alert text', () => {
  const combinations = PAYMENT_FAILURE_AREAS.flatMap((area) =>
    PAYMENT_FAILURE_REASONS.map((reason) => ({ area, reason }))
  )

  it('covers every area and reason the endpoint accepts', () => {
    expect(combinations).toHaveLength(PAYMENT_FAILURE_AREAS.length * PAYMENT_FAILURE_REASONS.length)
    expect(combinations.length).toBeGreaterThan(0)
  })

  it.each(combinations)('renders cleanly for $area and $reason', ({ area, reason }) => {
    const text = buildPaymentFailureAlertText(area, reason)

    expect(text.trim()).not.toBe('')
    expect(text).not.toMatch(/undefined|NaN|null|Invalid Date|\[object/)
    expect(text).not.toMatch(/\s{2,}/)
    expect(text).toMatch(PLAIN_GSM7)
    expect(text.length).toBeLessThanOrEqual(160)
    expect(text.startsWith('Anchor website alert: a payment failed while ')).toBe(true)
    // The manager reads wording, never a code such as table_deposit_capture.
    expect(text).not.toContain('_')
  })

  it('reads as one plain sentence about what failed and why', () => {
    expect(buildPaymentFailureAlertText('table_deposit_capture', 'server_error')).toBe(
      'Anchor website alert: a payment failed while taking a table deposit. The booking system reported an error. See the alert email for details.'
    )
  })

  it('gives every combination its own wording', () => {
    const texts = new Set(combinations.map(({ area, reason }) => buildPaymentFailureAlertText(area, reason)))
    expect(texts.size).toBe(combinations.length)
  })
})

describe('the alert number', () => {
  it('is not configured when the setting is missing or blank', () => {
    expect(resolveOpsAlertSmsNumber({})).toEqual({ configured: false, problem: 'unset' })
    expect(resolveOpsAlertSmsNumber({ [OPS_ALERT_SMS_NUMBER_ENV]: '   ' })).toEqual({
      configured: false,
      problem: 'unset',
    })
  })

  it.each(['07700900123', '447700900123', '+44 7700 900123 x', 'manager', '+0447700900123'])(
    'is not configured when the setting is not an international number (%s)',
    (value) => {
      expect(resolveOpsAlertSmsNumber({ [OPS_ALERT_SMS_NUMBER_ENV]: value })).toEqual({
        configured: false,
        problem: 'not_e164',
      })
    }
  )

  it('accepts an international number and ignores spaces in it', () => {
    expect(resolveOpsAlertSmsNumber({ [OPS_ALERT_SMS_NUMBER_ENV]: FIXTURE_NUMBER })).toEqual({
      configured: true,
      number: FIXTURE_NUMBER,
    })
    expect(resolveOpsAlertSmsNumber({ [OPS_ALERT_SMS_NUMBER_ENV]: ' +44 7700 900123 ' })).toEqual({
      configured: true,
      number: FIXTURE_NUMBER,
    })
  })
})

describe('the ten minute slot', () => {
  const windowMs = PAYMENT_FAILURE_ALERT_WINDOW_MINUTES * 60 * 1000
  const start = Date.UTC(2026, 9, 8, 18, 30, 0)

  it('is the same for two moments in one slot and for one area', () => {
    expect(paymentFailureAlertSlot('parking_capture', start)).toBe(
      paymentFailureAlertSlot('parking_capture', start + windowMs - 1)
    )
  })

  it('changes with the next slot and with the area', () => {
    expect(paymentFailureAlertSlot('parking_capture', start)).not.toBe(
      paymentFailureAlertSlot('parking_capture', start + windowMs)
    )
    expect(paymentFailureAlertSlot('parking_capture', start)).not.toBe(
      paymentFailureAlertSlot('parking_start', start)
    )
  })
})
