import { describe, expect, it } from 'vitest'
import {
  assertTestTableBookingSmsSendLimit,
  assertTestTableBookingSmsSendAllowed,
  assertTestTableBookingSmsTargets,
  isTestTableBookingSmsRunEnabled,
  isTestTableBookingSmsSendEnabled,
  readTestTableBookingSmsBookingId,
  readTestTableBookingSmsLimit,
  readTestTableBookingSmsToNumber,
} from '@/lib/test-table-booking-sms-safety'

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const snapshot: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    snapshot[key] = process.env[key]
    const value = env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return fn()
  } finally {
    for (const key of Object.keys(env)) {
      const value = snapshot[key]
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe('test-table-booking-sms safety', () => {
  it('requires RUN_TEST_TABLE_BOOKING_SMS_SEND to enable send mode', () => {
    withEnv({ RUN_TEST_TABLE_BOOKING_SMS_SEND: undefined }, () => {
      expect(isTestTableBookingSmsRunEnabled()).toBe(false)
      expect(isTestTableBookingSmsSendEnabled(['--confirm'])).toBe(false)
    })
  })

  it('requires --confirm and RUN_TEST_TABLE_BOOKING_SMS_SEND to enable send mode', () => {
    withEnv({ RUN_TEST_TABLE_BOOKING_SMS_SEND: 'true' }, () => {
      expect(isTestTableBookingSmsRunEnabled()).toBe(true)
      expect(isTestTableBookingSmsSendEnabled([])).toBe(false)
      expect(isTestTableBookingSmsSendEnabled(['--confirm'])).toBe(true)
    })
  })

  it('blocks sending unless ALLOW_TEST_TABLE_BOOKING_SMS_SEND is set', () => {
    withEnv({ ALLOW_TEST_TABLE_BOOKING_SMS_SEND: undefined }, () => {
      expect(() => assertTestTableBookingSmsSendAllowed()).toThrow(
        'test-table-booking-sms blocked by safety guard. Set ALLOW_TEST_TABLE_BOOKING_SMS_SEND=true to run this mutation script.'
      )
    })

    withEnv({ ALLOW_TEST_TABLE_BOOKING_SMS_SEND: 'true' }, () => {
      expect(() => assertTestTableBookingSmsSendAllowed()).not.toThrow()
    })
  })

  it('parses booking id and to number overrides', () => {
    expect(readTestTableBookingSmsBookingId(['--booking-id=booking-1'])).toBe('booking-1')
    expect(readTestTableBookingSmsBookingId(['--booking-id', 'booking-2'])).toBe('booking-2')

    expect(readTestTableBookingSmsToNumber(['--to=+447700900123'])).toBe('+447700900123')
    expect(readTestTableBookingSmsToNumber(['--to', '+447700900124'])).toBe('+447700900124')
  })

  it('requires explicit --limit=1 in send mode', () => {
    expect(readTestTableBookingSmsLimit(['--limit=1'])).toBe(1)
    expect(readTestTableBookingSmsLimit(['--limit', '1'])).toBe(1)
    expect(readTestTableBookingSmsLimit([])).toBeNull()
    expect(() => readTestTableBookingSmsLimit(['--limit=1e0'])).toThrow(
      'test-table-booking-sms blocked: invalid --limit value (1e0).'
    )
    expect(() => readTestTableBookingSmsLimit(['--limit=01'])).toThrow(
      'test-table-booking-sms blocked: invalid --limit value (01).'
    )
    expect(() => readTestTableBookingSmsLimit(['--limit=abc'])).toThrow(
      'test-table-booking-sms blocked: invalid --limit value (abc).'
    )

    expect(() => assertTestTableBookingSmsSendLimit(null)).toThrow(
      'test-table-booking-sms blocked: missing --limit 1 (explicit cap required).'
    )
    expect(() => assertTestTableBookingSmsSendLimit(2)).toThrow(
      'test-table-booking-sms blocked: --limit exceeds hard cap 1.'
    )
    expect(() => assertTestTableBookingSmsSendLimit(0)).toThrow(
      'test-table-booking-sms blocked: --limit must be 1.'
    )
    expect(assertTestTableBookingSmsSendLimit(1)).toBe(1)
  })

  it('falls back to env vars when CLI overrides are not provided', () => {
    withEnv({ TEST_TABLE_BOOKING_SMS_BOOKING_ID: 'booking-env', TEST_TABLE_BOOKING_SMS_TO: '+447700900125' }, () => {
      expect(readTestTableBookingSmsBookingId([])).toBe('booking-env')
      expect(readTestTableBookingSmsToNumber([])).toBe('+447700900125')
    })
  })

  it('requires booking id and to number in send mode', () => {
    expect(() => assertTestTableBookingSmsTargets({ bookingId: null, to: '+447700900126' })).toThrow(
      'test-table-booking-sms blocked: --booking-id (or TEST_TABLE_BOOKING_SMS_BOOKING_ID) is required.'
    )
    expect(() => assertTestTableBookingSmsTargets({ bookingId: 'booking-3', to: null })).toThrow(
      'test-table-booking-sms blocked: --to (or TEST_TABLE_BOOKING_SMS_TO) is required.'
    )
    expect(assertTestTableBookingSmsTargets({ bookingId: 'booking-4', to: '+447700900127' })).toEqual({
      bookingId: 'booking-4',
      to: '+447700900127',
    })
  })
})
