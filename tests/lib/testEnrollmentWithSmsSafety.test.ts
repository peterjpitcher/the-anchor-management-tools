import { describe, expect, it } from 'vitest'
import {
  assertTestEnrollmentWithSmsSendLimit,
  assertTestEnrollmentWithSmsSendAllowed,
  assertTestEnrollmentWithSmsTargets,
  isTestEnrollmentWithSmsRunEnabled,
  isTestEnrollmentWithSmsSendEnabled,
  readTestEnrollmentWithSmsCustomerId,
  readTestEnrollmentWithSmsLimit,
  readTestEnrollmentWithSmsToNumber,
} from '@/lib/test-enrollment-with-sms-safety'

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

describe('test-enrollment-with-sms safety', () => {
  it('requires RUN_TEST_ENROLLMENT_WITH_SMS_SEND to enable send mode', () => {
    withEnv({ RUN_TEST_ENROLLMENT_WITH_SMS_SEND: undefined }, () => {
      expect(isTestEnrollmentWithSmsRunEnabled()).toBe(false)
      expect(isTestEnrollmentWithSmsSendEnabled(['--confirm'])).toBe(false)
    })
  })

  it('requires --confirm and RUN_TEST_ENROLLMENT_WITH_SMS_SEND to enable send mode', () => {
    withEnv({ RUN_TEST_ENROLLMENT_WITH_SMS_SEND: 'true' }, () => {
      expect(isTestEnrollmentWithSmsRunEnabled()).toBe(true)
      expect(isTestEnrollmentWithSmsSendEnabled([])).toBe(false)
      expect(isTestEnrollmentWithSmsSendEnabled(['--confirm'])).toBe(true)
    })
  })

  it('blocks sending unless ALLOW_TEST_ENROLLMENT_WITH_SMS_SEND is set', () => {
    withEnv({ ALLOW_TEST_ENROLLMENT_WITH_SMS_SEND: undefined }, () => {
      expect(() => assertTestEnrollmentWithSmsSendAllowed()).toThrow(
        'test-enrollment-with-sms blocked by safety guard. Set ALLOW_TEST_ENROLLMENT_WITH_SMS_SEND=true to run this mutation script.'
      )
    })

    withEnv({ ALLOW_TEST_ENROLLMENT_WITH_SMS_SEND: 'true' }, () => {
      expect(() => assertTestEnrollmentWithSmsSendAllowed()).not.toThrow()
    })
  })

  it('parses customer id and to number overrides', () => {
    expect(readTestEnrollmentWithSmsCustomerId(['--customer-id=customer-1'])).toBe('customer-1')
    expect(readTestEnrollmentWithSmsCustomerId(['--customer-id', 'customer-2'])).toBe('customer-2')

    expect(readTestEnrollmentWithSmsToNumber(['--to=+447700900123'])).toBe('+447700900123')
    expect(readTestEnrollmentWithSmsToNumber(['--to', '+447700900124'])).toBe('+447700900124')
  })

  it('requires explicit --limit=1 in send mode', () => {
    expect(readTestEnrollmentWithSmsLimit(['--limit=1'])).toBe(1)
    expect(readTestEnrollmentWithSmsLimit(['--limit', '1'])).toBe(1)
    expect(readTestEnrollmentWithSmsLimit([])).toBeNull()
    expect(() => readTestEnrollmentWithSmsLimit(['--limit=1e0'])).toThrow(
      'test-enrollment-with-sms blocked: invalid --limit value (1e0).'
    )
    expect(() => readTestEnrollmentWithSmsLimit(['--limit=01'])).toThrow(
      'test-enrollment-with-sms blocked: invalid --limit value (01).'
    )
    expect(() => readTestEnrollmentWithSmsLimit(['--limit=abc'])).toThrow(
      'test-enrollment-with-sms blocked: invalid --limit value (abc).'
    )

    expect(() => assertTestEnrollmentWithSmsSendLimit(null)).toThrow(
      'test-enrollment-with-sms blocked: missing --limit 1 (explicit cap required).'
    )
    expect(() => assertTestEnrollmentWithSmsSendLimit(2)).toThrow(
      'test-enrollment-with-sms blocked: --limit exceeds hard cap 1.'
    )
    expect(() => assertTestEnrollmentWithSmsSendLimit(0)).toThrow(
      'test-enrollment-with-sms blocked: --limit must be 1.'
    )
    expect(assertTestEnrollmentWithSmsSendLimit(1)).toBe(1)
  })

  it('falls back to env vars when CLI overrides are not provided', () => {
    withEnv(
      { TEST_ENROLLMENT_WITH_SMS_CUSTOMER_ID: 'customer-env', TEST_ENROLLMENT_WITH_SMS_TO: '+447700900125' },
      () => {
        expect(readTestEnrollmentWithSmsCustomerId([])).toBe('customer-env')
        expect(readTestEnrollmentWithSmsToNumber([])).toBe('+447700900125')
      }
    )
  })

  it('requires customer id and to number in send mode', () => {
    expect(() => assertTestEnrollmentWithSmsTargets({ customerId: null, to: '+447700900126' })).toThrow(
      'test-enrollment-with-sms blocked: --customer-id (or TEST_ENROLLMENT_WITH_SMS_CUSTOMER_ID) is required.'
    )
    expect(() => assertTestEnrollmentWithSmsTargets({ customerId: 'customer-3', to: null })).toThrow(
      'test-enrollment-with-sms blocked: --to (or TEST_ENROLLMENT_WITH_SMS_TO) is required.'
    )
    expect(assertTestEnrollmentWithSmsTargets({ customerId: 'customer-4', to: '+447700900127' })).toEqual({
      customerId: 'customer-4',
      to: '+447700900127',
    })
  })
})
