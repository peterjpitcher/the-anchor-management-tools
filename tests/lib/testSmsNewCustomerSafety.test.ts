import { describe, expect, it } from 'vitest'
import {
  assertTestSmsNewCustomerSendLimit,
  assertTestSmsNewCustomerSendAllowed,
  buildTestSmsNewCustomerMetadata,
  isTestSmsNewCustomerSendEnabled,
  readTestSmsNewCustomerLimit,
} from '@/lib/test-sms-new-customer-safety'

describe('test-sms-new-customer script safety helpers', () => {
  it('requires --confirm and RUN_TEST_SMS_NEW_CUSTOMER_SEND to enable sending', () => {
    const prevRun = process.env.RUN_TEST_SMS_NEW_CUSTOMER_SEND

    try {
      process.env.RUN_TEST_SMS_NEW_CUSTOMER_SEND = 'true'
      expect(isTestSmsNewCustomerSendEnabled(['node', 'script.ts', '+447700900123'])).toBe(false)

      process.env.RUN_TEST_SMS_NEW_CUSTOMER_SEND = 'false'
      expect(isTestSmsNewCustomerSendEnabled(['node', 'script.ts', '--confirm', '+447700900123'])).toBe(false)

      process.env.RUN_TEST_SMS_NEW_CUSTOMER_SEND = 'true'
      expect(isTestSmsNewCustomerSendEnabled(['node', 'script.ts', '--confirm', '+447700900123'])).toBe(true)
    } finally {
      if (prevRun === undefined) {
        delete process.env.RUN_TEST_SMS_NEW_CUSTOMER_SEND
      } else {
        process.env.RUN_TEST_SMS_NEW_CUSTOMER_SEND = prevRun
      }
    }
  })

  it('fails closed when ALLOW_TEST_SMS_NEW_CUSTOMER_SEND is not set', () => {
    const prevAllow = process.env.ALLOW_TEST_SMS_NEW_CUSTOMER_SEND

    try {
      delete process.env.ALLOW_TEST_SMS_NEW_CUSTOMER_SEND
      expect(() => assertTestSmsNewCustomerSendAllowed()).toThrow(
        'test-sms-new-customer blocked by safety guard'
      )
    } finally {
      if (prevAllow === undefined) {
        delete process.env.ALLOW_TEST_SMS_NEW_CUSTOMER_SEND
      } else {
        process.env.ALLOW_TEST_SMS_NEW_CUSTOMER_SEND = prevAllow
      }
    }
  })

  it('requires explicit --limit=1 in send mode', () => {
    expect(readTestSmsNewCustomerLimit(['--limit=1'])).toBe(1)
    expect(readTestSmsNewCustomerLimit(['--limit', '1'])).toBe(1)
    expect(readTestSmsNewCustomerLimit([])).toBeNull()
    expect(() => readTestSmsNewCustomerLimit(['--limit=abc'])).toThrow(
      'test-sms-new-customer blocked: invalid --limit value (abc).'
    )

    expect(() => assertTestSmsNewCustomerSendLimit(null)).toThrow(
      'test-sms-new-customer blocked: missing --limit 1 (explicit cap required).'
    )
    expect(() => assertTestSmsNewCustomerSendLimit(2)).toThrow(
      'test-sms-new-customer blocked: --limit exceeds hard cap 1.'
    )
    expect(() => assertTestSmsNewCustomerSendLimit(0)).toThrow(
      'test-sms-new-customer blocked: --limit must be 1.'
    )
    expect(assertTestSmsNewCustomerSendLimit(1)).toBe(1)
  })

  it('builds metadata with template_key + deterministic stage bucket', () => {
    const now = new Date('2026-02-14T21:30:00.000Z')
    const meta = buildTestSmsNewCustomerMetadata({ now })

    expect(meta).toEqual(
      expect.objectContaining({
        template_key: 'sms_diagnostic_new_customer',
        trigger_type: 'sms_diagnostic_new_customer',
        stage: `diagnostic:${Math.floor(now.getTime() / 5000)}`,
        source: 'script:test-sms-new-customer',
        test_script: 'test-sms-new-customer.ts',
        timestamp: now.toISOString(),
      })
    )
  })
})
