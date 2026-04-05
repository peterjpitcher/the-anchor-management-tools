import { describe, it, expect } from 'vitest'
import {
  escapeCsvCell,
  formatDateDdMmYyyy,
  formatCurrency,
  buildCsvBuffer,
  quarterMonthRange,
} from '../csv-helpers'

describe('escapeCsvCell', () => {
  it('should prefix formula triggers with a tab', () => {
    expect(escapeCsvCell('=SUM(A1:A10)')).toBe('\t=SUM(A1:A10)')
    expect(escapeCsvCell('+44123')).toBe('\t+44123')
    expect(escapeCsvCell('-100')).toBe('\t-100')
    expect(escapeCsvCell('@mention')).toBe('\t@mention')
  })

  it('should not modify normal text', () => {
    expect(escapeCsvCell('Hello world')).toBe('Hello world')
    expect(escapeCsvCell('100.50')).toBe('100.50')
  })

  it('should return empty strings as-is', () => {
    expect(escapeCsvCell('')).toBe('')
  })
})

describe('formatDateDdMmYyyy', () => {
  it('should format YYYY-MM-DD as DD/MM/YYYY', () => {
    expect(formatDateDdMmYyyy('2026-01-15')).toBe('15/01/2026')
    expect(formatDateDdMmYyyy('2026-12-25')).toBe('25/12/2026')
  })

  it('should return empty string for empty input', () => {
    expect(formatDateDdMmYyyy('')).toBe('')
  })
})

describe('formatCurrency', () => {
  it('should format numbers with 2 decimal places', () => {
    expect(formatCurrency(1234.5)).toBe('1,234.50')
    expect(formatCurrency(0)).toBe('0.00')
    expect(formatCurrency(99.99)).toBe('99.99')
  })
})

describe('buildCsvBuffer', () => {
  it('should produce a BOM-prefixed buffer', () => {
    const rows = [['A', 'B'], ['1', '2']]
    const buffer = buildCsvBuffer(rows)
    const text = buffer.toString('utf-8')
    expect(text.startsWith('\ufeff')).toBe(true)
    expect(text).toContain('A')
    expect(text).toContain('B')
  })
})

describe('quarterMonthRange', () => {
  it('should return correct month ranges', () => {
    expect(quarterMonthRange(1)).toContain('January')
    expect(quarterMonthRange(1)).toContain('March')
    expect(quarterMonthRange(2)).toContain('April')
    expect(quarterMonthRange(2)).toContain('June')
    expect(quarterMonthRange(3)).toContain('July')
    expect(quarterMonthRange(3)).toContain('September')
    expect(quarterMonthRange(4)).toContain('October')
    expect(quarterMonthRange(4)).toContain('December')
  })

  it('should return empty string for invalid quarter', () => {
    expect(quarterMonthRange(0)).toBe('')
    expect(quarterMonthRange(5)).toBe('')
  })
})
