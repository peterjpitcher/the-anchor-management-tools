import { describe, expect, it } from 'vitest'
import { receiptSourceTypeSchema } from '@/lib/validation'

describe('receiptSourceTypeSchema', () => {
  it('accepts bank and amex', () => {
    expect(receiptSourceTypeSchema.parse('bank')).toBe('bank')
    expect(receiptSourceTypeSchema.parse('amex')).toBe('amex')
  })

  it('rejects anything else', () => {
    expect(receiptSourceTypeSchema.safeParse('visa').success).toBe(false)
  })
})
