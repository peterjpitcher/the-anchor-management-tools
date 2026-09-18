import { describe, expect, it } from 'vitest'
import {
  invoiceStatusLabel,
  invoiceStatusTone,
  quoteStatusLabel,
  quoteStatusTone,
} from '@/lib/invoices/status-ui'

describe('invoice status badges', () => {
  it.each([
    ['draft', 'neutral'],
    ['sent', 'info'],
    ['partially_paid', 'warning'],
    ['part_paid', 'warning'],
    ['paid', 'success'],
    ['overdue', 'danger'],
    ['void', 'neutral'],
    ['cancelled', 'neutral'],
    ['written_off', 'neutral'],
    ['credited', 'primary'],
    ['credit_note', 'primary'],
  ])('gives %s the %s tone', (status, tone) => {
    expect(invoiceStatusTone(status)).toBe(tone)
  })

  it('falls back to neutral for a status it does not know, including Object property names', () => {
    expect(invoiceStatusTone('something_new')).toBe('neutral')
    expect(invoiceStatusTone('constructor')).toBe('neutral')
  })

  it('keeps the invoice list wording', () => {
    expect(invoiceStatusLabel('partially_paid')).toBe('Partially paid')
    expect(invoiceStatusLabel('written_off')).toBe('Written off')
    expect(invoiceStatusLabel('overdue')).toBe('Overdue')
  })

  it('does not throw on a missing status from a loosely typed row', () => {
    expect(invoiceStatusLabel(undefined as unknown as string)).toBe('')
  })
})

describe('quote status badges', () => {
  it.each([
    ['draft', 'neutral'],
    ['sent', 'info'],
    ['accepted', 'success'],
    ['rejected', 'danger'],
    ['expired', 'neutral'],
  ])('gives %s the %s tone', (status, tone) => {
    expect(quoteStatusTone(status)).toBe(tone)
  })

  it('capitalises the status for display', () => {
    expect(quoteStatusLabel('accepted')).toBe('Accepted')
  })
})
