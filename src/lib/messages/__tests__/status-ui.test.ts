import { describe, expect, it } from 'vitest'

import { MARKETING_RECIPIENT_STATUSES } from '@/types/marketing'
import {
  MESSAGE_DELIVERY_STATUS_LABEL,
  MESSAGE_DELIVERY_STATUS_TONE,
  messageDeliveryStatusLabel,
  messageDeliveryStatusTone,
} from '../status-ui'

// Every status the three old copies handled, by source, so a new stored value cannot slip
// through as a neutral chip unnoticed.
const TWILIO_SMS = ['queued', 'accepted', 'scheduled', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'read']
const PRIVATE_BOOKING_SMS_QUEUE = ['pending', 'approved', 'sent', 'cancelled', 'failed']
const EMAIL_LOG = [
  'queued', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed',
  'opened', 'clicked', 'received', 'read',
]

describe('message delivery status', () => {
  it.each([
    ...TWILIO_SMS.map((status) => ['Twilio text', status]),
    ...PRIVATE_BOOKING_SMS_QUEUE.map((status) => ['private booking SMS queue', status]),
    ...EMAIL_LOG.map((status) => ['email log', status]),
    ...MARKETING_RECIPIENT_STATUSES.map((status) => ['marketing recipient', status]),
  ])('covers the %s status %s with a tone and a label', (_source, status) => {
    expect(Object.prototype.hasOwnProperty.call(MESSAGE_DELIVERY_STATUS_TONE, status)).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(MESSAGE_DELIVERY_STATUS_LABEL, status)).toBe(true)
  })

  it('has a label for every status it has a tone for, and no more', () => {
    expect(Object.keys(MESSAGE_DELIVERY_STATUS_LABEL).sort()).toEqual(Object.keys(MESSAGE_DELIVERY_STATUS_TONE).sort())
  })

  it.each([
    ['sent', 'success', 'Sent'],
    ['delivered', 'success', 'Delivered'],
    ['opened', 'success', 'Opened'],
    ['pending', 'info', 'Waiting'],
    ['queued', 'info', 'Queued'],
    ['sending', 'info', 'Sending'],
    ['delivery_delayed', 'warning', 'Delayed'],
    ['needs_review', 'warning', 'Needs review'],
    ['failed', 'danger', 'Failed'],
    ['undelivered', 'danger', 'Not delivered'],
    ['bounced', 'danger', 'Bounced'],
    ['complained', 'danger', 'Marked as spam'],
    ['suppressed', 'danger', 'Suppressed'],
    ['cancelled', 'neutral', 'Cancelled'],
    ['skipped', 'neutral', 'Skipped'],
  ])('shows %s as %s, worded "%s"', (status, tone, label) => {
    expect(messageDeliveryStatusTone(status)).toBe(tone)
    expect(messageDeliveryStatusLabel(status)).toBe(label)
  })

  it('never shows a failed send in a calm colour', () => {
    for (const status of ['failed', 'undelivered', 'bounced', 'complained', 'suppressed']) {
      expect(messageDeliveryStatusTone(status)).toBe('danger')
    }
  })

  it('matches without regard to case, as Twilio sometimes capitalises', () => {
    expect(messageDeliveryStatusTone('Delivered')).toBe('success')
    expect(messageDeliveryStatusLabel('FAILED')).toBe('Failed')
  })

  it('shows a value it does not know as neutral and as stored, including Object property names', () => {
    for (const status of ['constructor', 'toString', 'partially_delivered', '', null, undefined]) {
      expect(messageDeliveryStatusTone(status)).toBe('neutral')
    }
    expect(messageDeliveryStatusLabel('partially_delivered')).toBe('Partially delivered')
    expect(messageDeliveryStatusLabel(null)).toBe('Unknown')
    expect(messageDeliveryStatusLabel('')).toBe('Unknown')
  })
})
