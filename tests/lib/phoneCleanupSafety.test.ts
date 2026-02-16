import { describe, expect, it } from 'vitest'
import {
  assertPhoneCleanupCompletedWithoutFailures,
  extractPhoneCleanupCandidates
} from '@/lib/phone-cleanup-safety'

describe('phone cleanup safety', () => {
  it('extracts valid cleanup candidates', () => {
    const candidates = extractPhoneCleanupCandidates([
      {
        id: 'customer-1',
        mobile_number: '07123456789',
        first_name: 'Alex',
        last_name: 'Smith'
      },
      {
        id: 'customer-2',
        mobile_number: '02071234567',
        first_name: null,
        last_name: undefined
      }
    ])

    expect(candidates).toEqual([
      {
        id: 'customer-1',
        mobileNumber: '07123456789',
        firstName: 'Alex',
        lastName: 'Smith'
      },
      {
        id: 'customer-2',
        mobileNumber: '02071234567',
        firstName: 'Unknown',
        lastName: ''
      }
    ])
  })

  it('fails closed when candidate rows contain invalid id/mobile fields', () => {
    expect(() =>
      extractPhoneCleanupCandidates([
        {
          id: 'customer-1',
          mobile_number: '07123456789'
        },
        {
          id: null,
          mobile_number: '07000000000'
        },
        {
          id: 'customer-3',
          mobile_number: ''
        }
      ])
    ).toThrow(
      'Cannot safely process phone-cleanup rows due to invalid data: row#2:invalid-id, row#3:invalid-mobile-number'
    )
  })

  it('fails closed when cleanup reports unresolved failures', () => {
    expect(() =>
      assertPhoneCleanupCompletedWithoutFailures([
        'invalid_format:customer-1',
        'update_failed:customer-2'
      ])
    ).toThrow(
      'Phone cleanup finished with 2 failure(s): invalid_format:customer-1 | update_failed:customer-2'
    )

    expect(() => assertPhoneCleanupCompletedWithoutFailures([])).not.toThrow()
  })
})
