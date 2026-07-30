import { describe, it, expect } from 'vitest'
import {
  formatVoucherNumber,
  isFullVoucherNumber,
  normaliseVoucherNumberInput,
  voucherMonthKey,
} from '../numbering'

describe('voucherMonthKey', () => {
  it('derives YYMM from a London ISO date', () => {
    expect(voucherMonthKey('2026-07-30')).toBe('2607')
    expect(voucherMonthKey('2026-12-01')).toBe('2612')
    expect(voucherMonthKey('2030-01-31')).toBe('3001')
  })

  it('rejects non-ISO input', () => {
    expect(() => voucherMonthKey('30/07/2026')).toThrow('Invalid London date')
    expect(() => voucherMonthKey('2607')).toThrow('Invalid London date')
    expect(() => voucherMonthKey('')).toThrow('Invalid London date')
  })
})

describe('formatVoucherNumber', () => {
  it('formats the first sequence of a month', () => {
    expect(formatVoucherNumber('2607', 1)).toBe('AN-2607-0001')
  })

  it('formats the last permitted sequence 9999', () => {
    expect(formatVoucherNumber('2607', 9999)).toBe('AN-2607-9999')
  })

  it('pads intermediate sequences to four digits', () => {
    expect(formatVoucherNumber('2607', 148)).toBe('AN-2607-0148')
  })

  it('refuses sequences outside 1-9999 (no five-digit fallback)', () => {
    expect(() => formatVoucherNumber('2607', 0)).toThrow('out of range')
    expect(() => formatVoucherNumber('2607', 10000)).toThrow('out of range')
    expect(() => formatVoucherNumber('2607', 1.5)).toThrow('out of range')
  })

  it('refuses malformed month keys', () => {
    expect(() => formatVoucherNumber('26-7', 1)).toThrow('Invalid voucher month key')
    expect(() => formatVoucherNumber('26071', 1)).toThrow('Invalid voucher month key')
  })
})

describe('normaliseVoucherNumberInput (F50)', () => {
  it('passes through the canonical form unchanged', () => {
    expect(normaliseVoucherNumberInput('AN-2607-0148')).toBe('AN-2607-0148')
  })

  it('uppercases lowercase input', () => {
    expect(normaliseVoucherNumberInput('an-2607-0148')).toBe('AN-2607-0148')
  })

  it('accepts hyphenless prefixed input', () => {
    expect(normaliseVoucherNumberInput('an26070148')).toBe('AN-2607-0148')
  })

  it('accepts a bare eight-digit number without the AN prefix', () => {
    expect(normaliseVoucherNumberInput('26070148')).toBe('AN-2607-0148')
    expect(normaliseVoucherNumberInput('2607-0148')).toBe('AN-2607-0148')
  })

  it('strips scanner suffixes (newline, tab, carriage return)', () => {
    expect(normaliseVoucherNumberInput('AN-2607-0148\n')).toBe('AN-2607-0148')
    expect(normaliseVoucherNumberInput('AN-2607-0148\t')).toBe('AN-2607-0148')
    expect(normaliseVoucherNumberInput('AN-2607-0148\r\n')).toBe('AN-2607-0148')
  })

  it('strips surrounding and internal whitespace', () => {
    expect(normaliseVoucherNumberInput('  AN-2607-0148  ')).toBe('AN-2607-0148')
    expect(normaliseVoucherNumberInput('an 2607 0148')).toBe('AN-2607-0148')
  })

  it('returns a cleaned partial for search when no full number is recognisable', () => {
    expect(normaliseVoucherNumberInput('0148')).toBe('0148')
    expect(normaliseVoucherNumberInput(' 0148\n')).toBe('0148')
    expect(normaliseVoucherNumberInput('an-2607')).toBe('AN-2607')
    expect(normaliseVoucherNumberInput('an2607')).toBe('AN2607')
    expect(normaliseVoucherNumberInput('')).toBe('')
  })

  it('round-trips every formatted number back to canonical', () => {
    for (const seq of [1, 9, 42, 148, 999, 9999]) {
      const formatted = formatVoucherNumber('2607', seq)
      expect(normaliseVoucherNumberInput(formatted)).toBe(formatted)
      expect(normaliseVoucherNumberInput(formatted.toLowerCase())).toBe(formatted)
      expect(normaliseVoucherNumberInput(formatted.replace(/-/g, ''))).toBe(formatted)
    }
  })
})

describe('isFullVoucherNumber', () => {
  it('accepts only the canonical uppercase hyphenated form', () => {
    expect(isFullVoucherNumber('AN-2607-0148')).toBe(true)
    expect(isFullVoucherNumber('AN-2607-9999')).toBe(true)
    expect(isFullVoucherNumber('an-2607-0148')).toBe(false)
    expect(isFullVoucherNumber('AN26070148')).toBe(false)
    expect(isFullVoucherNumber('AN-2607-014')).toBe(false)
    expect(isFullVoucherNumber('AN-2607-01480')).toBe(false)
    expect(isFullVoucherNumber('0148')).toBe(false)
  })
})
