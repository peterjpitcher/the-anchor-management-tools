import { describe, expect, it } from 'vitest'
import { isInvoiceStatusTransitionAllowed, isQuoteStatusTransitionAllowed } from '@/lib/status-transitions'

describe('status transition guards', () => {
  describe('invoice transitions', () => {
    it('allows common forward transitions', () => {
      expect(isInvoiceStatusTransitionAllowed('draft', 'sent')).toBe(true)
      expect(isInvoiceStatusTransitionAllowed('sent', 'paid')).toBe(true)
      expect(isInvoiceStatusTransitionAllowed('overdue', 'paid')).toBe(true)
    })

    it('blocks invalid or regressive transitions', () => {
      expect(isInvoiceStatusTransitionAllowed('partially_paid', 'sent')).toBe(false)
      expect(isInvoiceStatusTransitionAllowed('paid', 'sent')).toBe(false)
      expect(isInvoiceStatusTransitionAllowed('void', 'draft')).toBe(false)
      expect(isInvoiceStatusTransitionAllowed('written_off', 'paid')).toBe(false)
    })
  })

  describe('quote transitions', () => {
    it('allows draft and expiry recovery transitions', () => {
      expect(isQuoteStatusTransitionAllowed('draft', 'accepted')).toBe(true)
      expect(isQuoteStatusTransitionAllowed('sent', 'expired')).toBe(true)
      expect(isQuoteStatusTransitionAllowed('expired', 'sent')).toBe(true)
    })

    it('blocks finalized quote regressions', () => {
      expect(isQuoteStatusTransitionAllowed('sent', 'draft')).toBe(false)
      expect(isQuoteStatusTransitionAllowed('accepted', 'rejected')).toBe(false)
      expect(isQuoteStatusTransitionAllowed('rejected', 'accepted')).toBe(false)
    })
  })
})
