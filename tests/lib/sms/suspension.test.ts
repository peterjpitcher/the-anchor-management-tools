import { describe, expect, it } from 'vitest'
import {
  isEventScopedSmsMetadata,
  isTruthyFlag,
  resolveSmsSuspensionReason
} from '@/lib/sms/suspension'

describe('sms suspension helpers', () => {
  it('parses truthy flag values', () => {
    expect(isTruthyFlag('true')).toBe(true)
    expect(isTruthyFlag('1')).toBe(true)
    expect(isTruthyFlag('YES')).toBe(true)
    expect(isTruthyFlag('on')).toBe(true)
    expect(isTruthyFlag('false')).toBe(false)
    expect(isTruthyFlag(undefined)).toBe(false)
  })

  it('detects event-scoped metadata using ids or template keys', () => {
    expect(isEventScopedSmsMetadata({ event_id: 'abc' })).toBe(true)
    expect(isEventScopedSmsMetadata({ event_booking_id: 'abc' })).toBe(true)
    expect(isEventScopedSmsMetadata({ table_booking_id: 'abc' })).toBe(true)
    expect(isEventScopedSmsMetadata({ template_key: 'event_reminder_1d' })).toBe(true)
    expect(isEventScopedSmsMetadata({ template_key: 'table_review_followup' })).toBe(true)
    expect(isEventScopedSmsMetadata({ template_key: 'private_booking_event_reminder_1d' })).toBe(false)
    expect(isEventScopedSmsMetadata({})).toBe(false)
  })

  it('resolves the strongest suspension reason first', () => {
    expect(
      resolveSmsSuspensionReason({
        suspendAllSms: 'true',
        suspendEventSms: 'true',
        metadata: { event_id: 'abc' }
      })
    ).toBe('all_sms')
  })

  it('treats SUSPEND_ALL_COMMS as the strongest switch, above SUSPEND_ALL_SMS', () => {
    expect(
      resolveSmsSuspensionReason({
        suspendAllComms: 'true',
        suspendAllSms: 'true',
        suspendEventSms: 'true',
        metadata: { event_id: 'abc' }
      })
    ).toBe('all_comms')

    // Every message, not only event-scoped ones.
    expect(
      resolveSmsSuspensionReason({
        suspendAllComms: '1',
        metadata: { template_key: 'private_booking_balance_reminder' }
      })
    ).toBe('all_comms')
  })

  it('ignores SUSPEND_ALL_COMMS when it is unset or false', () => {
    expect(resolveSmsSuspensionReason({ suspendAllComms: 'false' })).toBe(null)
    expect(resolveSmsSuspensionReason({ suspendAllComms: undefined })).toBe(null)
    expect(resolveSmsSuspensionReason({ suspendAllComms: '', suspendAllSms: 'true' })).toBe('all_sms')
  })

  it('suspends only event messages when event suspension is enabled', () => {
    expect(
      resolveSmsSuspensionReason({
        suspendAllSms: 'false',
        suspendEventSms: 'true',
        metadata: { event_id: 'abc' }
      })
    ).toBe('event_sms')

    expect(
      resolveSmsSuspensionReason({
        suspendAllSms: 'false',
        suspendEventSms: 'true',
        metadata: { template_key: 'general_broadcast' }
      })
    ).toBe(null)
  })
})
