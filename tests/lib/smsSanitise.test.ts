import { describe, it, expect } from 'vitest'
import { sanitiseSmsVariable } from '@/lib/sms/sanitise'

describe('sanitiseSmsVariable', () => {
  it('returns trimmed value unchanged for clean input', () => {
    expect(sanitiseSmsVariable('Sarah', 100)).toBe('Sarah')
    expect(sanitiseSmsVariable('  Sarah  ', 100)).toBe('Sarah')
  })

  it('strips newlines', () => {
    expect(sanitiseSmsVariable('Sarah\nEvil', 100)).toBe('Sarah Evil')
    expect(sanitiseSmsVariable('A\r\nB', 100)).toBe('A B')
  })

  it('strips tabs and other control chars', () => {
    expect(sanitiseSmsVariable('A\tB', 100)).toBe('A B')
    expect(sanitiseSmsVariable('A\u0007B', 100)).toBe('AB')
  })

  it('collapses multiple whitespace', () => {
    expect(sanitiseSmsVariable('A    B', 100)).toBe('A B')
  })

  it('caps length', () => {
    expect(sanitiseSmsVariable('abcdefghij', 5)).toBe('abcde')
  })

  it('returns empty string for null/undefined/empty', () => {
    expect(sanitiseSmsVariable(null, 100)).toBe('')
    expect(sanitiseSmsVariable(undefined, 100)).toBe('')
    expect(sanitiseSmsVariable('', 100)).toBe('')
  })

  it('handles injection attempts', () => {
    // Malicious name trying to inject extra lines into SMS body
    const malicious = 'Sarah\n\n+44 7000 000000\n\nCall me'
    expect(sanitiseSmsVariable(malicious, 100)).toBe('Sarah +44 7000 000000 Call me')
  })
})
