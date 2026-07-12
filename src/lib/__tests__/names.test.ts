import { describe, it, expect } from 'vitest'
import { normalizePersonName } from '@/lib/names'

describe('normalizePersonName', () => {
  it('should title-case a plain lower-case name', () => {
    expect(normalizePersonName('alex taylor')).toBe('Alex Taylor')
  })

  it('should fix an all-caps name', () => {
    expect(normalizePersonName('JORDAN ROWE')).toBe('Jordan Rowe')
  })

  it('should collapse extra whitespace', () => {
    expect(normalizePersonName('  mary   jane  ')).toBe('Mary Jane')
  })

  it('should handle hyphenated names', () => {
    expect(normalizePersonName('mary-jane watson')).toBe('Mary-Jane Watson')
  })

  it('should handle apostrophes', () => {
    expect(normalizePersonName("o'brien")).toBe("O'Brien")
  })

  it('should handle the Mc prefix', () => {
    expect(normalizePersonName('mcdonald')).toBe('McDonald')
  })

  it('should return an empty string for empty or nullish input', () => {
    expect(normalizePersonName('')).toBe('')
    expect(normalizePersonName('   ')).toBe('')
    expect(normalizePersonName(null)).toBe('')
    expect(normalizePersonName(undefined)).toBe('')
  })
})
