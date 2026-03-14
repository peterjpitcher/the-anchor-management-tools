import { describe, it, expect, beforeEach } from 'vitest'
import { calculateInvoiceTotals, type InvoiceLineInput } from '../invoiceCalculations'

describe('calculateInvoiceTotals', () => {
  describe('line total calculation (quantity × unit_price)', () => {
    it('should calculate the correct base after line discount when discount is zero', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 3, unit_price: 10, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.lineBreakdown[0].baseAfterLineDiscount).toBe(30)
    })

    it('should apply line-level discount percentage correctly', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 2, unit_price: 50, discount_percentage: 10, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      // 2 × 50 = 100, 10% discount = 10, base = 90
      expect(result.lineBreakdown[0].baseAfterLineDiscount).toBe(90)
    })

    it('should handle fractional unit prices correctly', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 3, unit_price: 1.5, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.lineBreakdown[0].baseAfterLineDiscount).toBeCloseTo(4.5, 10)
    })
  })

  describe('subtotal calculation (sum of line totals after line discounts)', () => {
    it('should sum multiple lines correctly', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 2, unit_price: 10, discount_percentage: 0, vat_rate: 0 },
        { quantity: 3, unit_price: 5, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      // 2×10 = 20, 3×5 = 15, subtotal = 35
      expect(result.subtotalBeforeInvoiceDiscount).toBe(35)
    })

    it('should sum lines after individual line discounts', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 4, unit_price: 25, discount_percentage: 20, vat_rate: 0 },
        { quantity: 1, unit_price: 100, discount_percentage: 50, vat_rate: 0 },
      ]
      // line1: 100 - 20% = 80, line2: 100 - 50% = 50
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.subtotalBeforeInvoiceDiscount).toBe(130)
    })

    it('should return 0 subtotal for empty line items', () => {
      const result = calculateInvoiceTotals([], 0)
      expect(result.subtotalBeforeInvoiceDiscount).toBe(0)
    })
  })

  describe('VAT calculation', () => {
    it('should calculate 0% VAT as zero', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.vatAmount).toBe(0)
      expect(result.lineBreakdown[0].vat).toBe(0)
    })

    it('should calculate 20% VAT correctly', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 20 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.vatAmount).toBeCloseTo(20, 10)
      expect(result.lineBreakdown[0].vat).toBeCloseTo(20, 10)
    })

    it('should calculate 5% VAT correctly', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 200, discount_percentage: 0, vat_rate: 5 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.vatAmount).toBeCloseTo(10, 10)
      expect(result.lineBreakdown[0].vat).toBeCloseTo(10, 10)
    })

    it('should sum VAT across multiple lines with different rates', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 20 },
        { quantity: 1, unit_price: 200, discount_percentage: 0, vat_rate: 5 },
      ]
      // VAT: 20 + 10 = 30
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.vatAmount).toBeCloseTo(30, 10)
    })

    it('should apply VAT after invoice-level discount', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 20 },
      ]
      // 10% invoice discount → base = 90, VAT = 90 × 20% = 18
      const result = calculateInvoiceTotals(lines, 10)
      expect(result.lineBreakdown[0].baseAfterAllDiscounts).toBeCloseTo(90, 10)
      expect(result.lineBreakdown[0].vat).toBeCloseTo(18, 10)
      expect(result.vatAmount).toBeCloseTo(18, 10)
    })
  })

  describe('grand total (subtotal - invoice discount + VAT)', () => {
    it('should compute grand total with no discounts and no VAT', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 5, unit_price: 20, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.totalAmount).toBe(100)
    })

    it('should compute grand total correctly with invoice discount and VAT', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 20 },
      ]
      // 10% invoice discount → net = 90, VAT 20% = 18, total = 108
      const result = calculateInvoiceTotals(lines, 10)
      expect(result.totalAmount).toBeCloseTo(108, 10)
    })

    it('should compute grand total with line discount, invoice discount, and VAT', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: 10, vat_rate: 20 },
      ]
      // Line discount 10%: base = 90
      // Invoice discount 10%: 90 × 10% = 9 → base after all = 81
      // VAT 20%: 81 × 20% = 16.2
      // Total = 81 + 16.2 = 97.2
      const result = calculateInvoiceTotals(lines, 10)
      expect(result.invoiceDiscountAmount).toBeCloseTo(9, 10)
      expect(result.lineBreakdown[0].baseAfterAllDiscounts).toBeCloseTo(81, 10)
      expect(result.lineBreakdown[0].vat).toBeCloseTo(16.2, 10)
      expect(result.totalAmount).toBeCloseTo(97.2, 10)
    })
  })

  describe('invoice-level discount', () => {
    it('should calculate invoice discount amount correctly', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 200, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, 25)
      expect(result.invoiceDiscountAmount).toBe(50)
    })

    it('should distribute invoice discount share proportionally across lines', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 0 },
        { quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, 20)
      // Subtotal = 200; 20% invoice discount = 40 total. Each line is 50% of subtotal → 20 each.
      expect(result.invoiceDiscountAmount).toBeCloseTo(40, 10)
      expect(result.lineBreakdown[0].invoiceDiscountShare).toBeCloseTo(20, 10)
      expect(result.lineBreakdown[1].invoiceDiscountShare).toBeCloseTo(20, 10)
    })
  })

  describe('edge cases', () => {
    it('should handle zero quantity as zero line total', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 0, unit_price: 50, discount_percentage: 0, vat_rate: 20 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.lineBreakdown[0].baseAfterLineDiscount).toBe(0)
      expect(result.subtotalBeforeInvoiceDiscount).toBe(0)
      expect(result.totalAmount).toBe(0)
      expect(result.vatAmount).toBe(0)
    })

    it('should handle zero unit_price as zero line total', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 10, unit_price: 0, discount_percentage: 0, vat_rate: 20 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.lineBreakdown[0].baseAfterLineDiscount).toBe(0)
      expect(result.totalAmount).toBe(0)
    })

    it('should clamp negative discount_percentage to zero', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: -10, vat_rate: 0 },
      ]
      // Negative discount treated as 0 — no extra amount added
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.lineBreakdown[0].baseAfterLineDiscount).toBe(100)
    })

    it('should clamp negative invoice discount percentage to zero', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, -5)
      expect(result.invoiceDiscountAmount).toBe(0)
      expect(result.totalAmount).toBe(100)
    })

    it('should handle non-finite quantity gracefully (treat as 0)', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: NaN, unit_price: 50, discount_percentage: 0, vat_rate: 20 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.subtotalBeforeInvoiceDiscount).toBe(0)
      expect(result.totalAmount).toBe(0)
    })

    it('should handle non-finite invoiceDiscountPercentage gracefully (treat as 0)', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, NaN)
      expect(result.invoiceDiscountAmount).toBe(0)
      expect(result.totalAmount).toBe(100)
    })

    it('should produce zero VAT when subtotal is zero even with positive VAT rate', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 0, unit_price: 100, discount_percentage: 0, vat_rate: 20 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.vatAmount).toBe(0)
    })

    it('should handle the classic floating-point edge case without NaN', () => {
      // 0.1 + 0.2 → not NaN; the exact value may differ from 0.3 but must be close
      const lines: InvoiceLineInput[] = [
        { quantity: 1, unit_price: 0.1, discount_percentage: 0, vat_rate: 0 },
        { quantity: 1, unit_price: 0.2, discount_percentage: 0, vat_rate: 0 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.subtotalBeforeInvoiceDiscount).toBeCloseTo(0.3, 10)
      expect(Number.isFinite(result.totalAmount)).toBe(true)
    })

    it('should handle 100% line discount correctly', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 2, unit_price: 50, discount_percentage: 100, vat_rate: 20 },
      ]
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.lineBreakdown[0].baseAfterLineDiscount).toBe(0)
      expect(result.totalAmount).toBe(0)
    })

    it('should handle single line with all three: line discount, invoice discount, and VAT', () => {
      const lines: InvoiceLineInput[] = [
        { quantity: 10, unit_price: 10, discount_percentage: 5, vat_rate: 20 },
      ]
      // Gross = 100, line 5% → 95, invoice 0% → 95, VAT 20% → 19, total = 114
      const result = calculateInvoiceTotals(lines, 0)
      expect(result.subtotalBeforeInvoiceDiscount).toBeCloseTo(95, 10)
      expect(result.vatAmount).toBeCloseTo(19, 10)
      expect(result.totalAmount).toBeCloseTo(114, 10)
    })
  })
})
