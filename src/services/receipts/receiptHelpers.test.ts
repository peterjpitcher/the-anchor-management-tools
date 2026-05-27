import { describe, expect, it } from 'vitest'

import { normalizeVendorInput } from './receiptHelpers'

describe('normalizeVendorInput', () => {
  it('treats empty and literal null values as missing vendors', () => {
    expect(normalizeVendorInput('')).toBeNull()
    expect(normalizeVendorInput(' null ')).toBeNull()
    expect(normalizeVendorInput('NULL')).toBeNull()
  })

  it('keeps real vendor names', () => {
    expect(normalizeVendorInput('  GoCardless  ')).toBe('GoCardless')
  })
})
