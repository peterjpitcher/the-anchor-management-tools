import { describe, expect, it } from 'vitest'
import { addDaysIsoDate, calculateNextInvoiceIsoDate } from '@/lib/recurringInvoiceSchedule'

describe('recurringInvoiceSchedule', () => {
  describe('addDaysIsoDate', () => {
    it('adds days without timezone drift', () => {
      expect(addDaysIsoDate('2026-01-26', 7)).toBe('2026-02-02')
    })
  })

  describe('calculateNextInvoiceIsoDate', () => {
    it('calculates weekly recurrence', () => {
      expect(calculateNextInvoiceIsoDate('2026-01-01', 'weekly')).toBe('2026-01-08')
    })

    it('calculates monthly recurrence with month-end clamping', () => {
      expect(calculateNextInvoiceIsoDate('2025-01-31', 'monthly')).toBe('2025-02-28')
      expect(calculateNextInvoiceIsoDate('2024-01-31', 'monthly')).toBe('2024-02-29')
    })

    it('calculates quarterly recurrence with month-end clamping', () => {
      expect(calculateNextInvoiceIsoDate('2025-11-30', 'quarterly')).toBe('2026-02-28')
    })

    it('calculates yearly recurrence with leap-day clamping', () => {
      expect(calculateNextInvoiceIsoDate('2024-02-29', 'yearly')).toBe('2025-02-28')
    })
  })
})

