import { describe, expect, it } from 'vitest'

import { deriveClientCode, roundMoney } from '@/lib/oj-projects/utils'

describe('deriveClientCode', () => {
  it('derives initials from multi-word vendor name', () => {
    expect(deriveClientCode('Orange Jelly Limited')).toBe('OJ')
  })

  it('derives initials from two-word name', () => {
    expect(deriveClientCode('Acme Corp')).toBe('AC')
  })

  it('strips stop words (THE, LIMITED, LTD, etc.)', () => {
    expect(deriveClientCode('The Star Pub')).toBe('SP')
    expect(deriveClientCode('ABC Services Ltd')).toBe('A')
  })

  it('takes up to 3 initials from significant words', () => {
    expect(deriveClientCode('Alpha Beta Gamma Delta')).toBe('ABG')
  })

  it('returns CLIENT for empty string', () => {
    expect(deriveClientCode('')).toBe('CLIENT')
  })

  it('returns CLIENT for whitespace-only string', () => {
    expect(deriveClientCode('   ')).toBe('CLIENT')
  })

  it('returns CLIENT when all words are stop words', () => {
    expect(deriveClientCode('The Limited')).toBe('CLIENT')
  })

  it('handles single word name', () => {
    expect(deriveClientCode('Acme')).toBe('A')
  })

  it('strips special characters from tokens', () => {
    expect(deriveClientCode('O\'Brien & Sons')).toBe('OS')
  })

  it('handles null-ish coercion gracefully', () => {
    // The function uses String(vendorName || '')
    expect(deriveClientCode(undefined as unknown as string)).toBe('CLIENT')
    expect(deriveClientCode(null as unknown as string)).toBe('CLIENT')
  })
})

describe('roundMoney', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(1.004)).toBe(1)
  })

  it('handles floating-point addition correctly', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
  })

  it('returns 0 for 0', () => {
    expect(roundMoney(0)).toBe(0)
  })

  it('handles negative values', () => {
    expect(roundMoney(-1.555)).toBe(-1.55)
  })

  it('preserves already-rounded values', () => {
    expect(roundMoney(10.25)).toBe(10.25)
  })
})
