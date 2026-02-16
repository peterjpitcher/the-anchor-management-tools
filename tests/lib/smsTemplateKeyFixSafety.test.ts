import { describe, expect, it } from 'vitest'
import {
  assertFixSmsTemplateKeysLimit,
  assertFixSmsTemplateKeysCompletedWithoutFailures,
  assertFixSmsTemplateKeysMutationAllowed,
  assertFixSmsTemplateUpdateSucceeded,
  isFixSmsTemplateKeysMutationEnabled,
  readFixSmsTemplateKeysLimit,
  readFixSmsTemplateKeysOffset,
  resolvePendingSmsTemplateFixJobs,
  shouldFixLegacyTemplate
} from '@/lib/sms-template-key-fix-safety'

describe('sms template key fix safety', () => {
  it('requires explicit confirm + RUN env to enable mutations', () => {
    expect(isFixSmsTemplateKeysMutationEnabled(['node', 'script'], {})).toBe(false)
    expect(isFixSmsTemplateKeysMutationEnabled(['node', 'script', '--confirm'], {})).toBe(false)
    expect(
      isFixSmsTemplateKeysMutationEnabled(['node', 'script', '--confirm'], {
        RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION: 'true'
      })
    ).toBe(true)
    expect(
      isFixSmsTemplateKeysMutationEnabled(['node', 'script', '--confirm', '--dry-run'], {
        RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION: 'true'
      })
    ).toBe(false)
  })

  it('blocks mutation execution unless explicit guard env var is enabled', () => {
    const previous = process.env.ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT
    delete process.env.ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT

    expect(() => assertFixSmsTemplateKeysMutationAllowed()).toThrow(
      'fix-sms-template-keys blocked by safety guard. Set ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT = 'true'
    expect(() => assertFixSmsTemplateKeysMutationAllowed()).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT
    } else {
      process.env.ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT = previous
    }
  })

  it('reads and validates explicit --limit / --offset flags', () => {
    expect(readFixSmsTemplateKeysLimit(['node', 'script', '--limit', '10'], {})).toBe(10)
    expect(readFixSmsTemplateKeysLimit(['node', 'script', '--limit=5'], {})).toBe(5)
    expect(readFixSmsTemplateKeysLimit(['node', 'script'], { FIX_SMS_TEMPLATE_KEYS_LIMIT: '7' })).toBe(7)
    expect(readFixSmsTemplateKeysOffset(['node', 'script', '--offset', '2'], {})).toBe(2)
    expect(readFixSmsTemplateKeysOffset(['node', 'script', '--offset=4'], {})).toBe(4)
    expect(readFixSmsTemplateKeysOffset(['node', 'script'], { FIX_SMS_TEMPLATE_KEYS_OFFSET: '9' })).toBe(9)

    expect(() => assertFixSmsTemplateKeysLimit(null, 500)).toThrow('--limit is required')
    expect(() => assertFixSmsTemplateKeysLimit(0, 500)).toThrow('--limit must be a positive integer')
    expect(() => assertFixSmsTemplateKeysLimit(501, 500)).toThrow('exceeds hard cap')
    expect(assertFixSmsTemplateKeysLimit(25, 500)).toBe(25)
  })

  it('throws when pending-job query fails', () => {
    expect(() =>
      resolvePendingSmsTemplateFixJobs({
        jobs: null,
        error: { message: 'jobs query timeout' }
      })
    ).toThrow('Load pending SMS jobs for template fix failed: jobs query timeout')
  })

  it('identifies legacy template payloads correctly', () => {
    expect(shouldFixLegacyTemplate({ template: 'table_booking_confirmation' })).toBe(true)
    expect(shouldFixLegacyTemplate({ template: 'booking_confirmation_regular' })).toBe(false)
    expect(shouldFixLegacyTemplate(null)).toBe(false)
  })

  it('throws when template update affects fewer rows than expected', () => {
    expect(() =>
      assertFixSmsTemplateUpdateSucceeded({
        error: null,
        updatedRows: [],
        expectedCount: 1
      })
    ).toThrow('Update pending SMS template key affected no rows')
  })

  it('throws when template update returns a database error', () => {
    expect(() =>
      assertFixSmsTemplateUpdateSucceeded({
        error: { message: 'permission denied' },
        updatedRows: null,
        expectedCount: 1
      })
    ).toThrow('Update pending SMS template key failed: permission denied')
  })

  it('throws when script completion has recorded failures', () => {
    expect(() =>
      assertFixSmsTemplateKeysCompletedWithoutFailures({
        failureCount: 1,
        failures: ['job:1:Update pending SMS template key affected no rows']
      })
    ).toThrow(
      'fix-sms-template-keys completed with 1 failure(s): job:1:Update pending SMS template key affected no rows'
    )
  })
})
