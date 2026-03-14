import { describe, it, expect } from 'vitest'
import {
  isInvoiceStatusTransitionAllowed,
  isQuoteStatusTransitionAllowed,
} from '../status-transitions'
import type { InvoiceStatus, QuoteStatus } from '@/types/invoices'

describe('isInvoiceStatusTransitionAllowed', () => {
  describe('valid transitions from draft', () => {
    const validTargets: InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off']
    it.each(validTargets)('should allow draft → %s', (to) => {
      expect(isInvoiceStatusTransitionAllowed('draft', to)).toBe(true)
    })
  })

  describe('valid transitions from sent', () => {
    const validTargets: InvoiceStatus[] = ['sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off']
    it.each(validTargets)('should allow sent → %s', (to) => {
      expect(isInvoiceStatusTransitionAllowed('sent', to)).toBe(true)
    })

    it('should not allow sent → draft', () => {
      expect(isInvoiceStatusTransitionAllowed('sent', 'draft')).toBe(false)
    })
  })

  describe('valid transitions from partially_paid', () => {
    const validTargets: InvoiceStatus[] = ['partially_paid', 'paid', 'overdue', 'void', 'written_off']
    it.each(validTargets)('should allow partially_paid → %s', (to) => {
      expect(isInvoiceStatusTransitionAllowed('partially_paid', to)).toBe(true)
    })

    it('should not allow partially_paid → draft', () => {
      expect(isInvoiceStatusTransitionAllowed('partially_paid', 'draft')).toBe(false)
    })

    it('should not allow partially_paid → sent', () => {
      expect(isInvoiceStatusTransitionAllowed('partially_paid', 'sent')).toBe(false)
    })
  })

  describe('valid transitions from overdue', () => {
    const validTargets: InvoiceStatus[] = ['overdue', 'sent', 'partially_paid', 'paid', 'void', 'written_off']
    it.each(validTargets)('should allow overdue → %s', (to) => {
      expect(isInvoiceStatusTransitionAllowed('overdue', to)).toBe(true)
    })

    it('should not allow overdue → draft', () => {
      expect(isInvoiceStatusTransitionAllowed('overdue', 'draft')).toBe(false)
    })
  })

  describe('terminal state: paid', () => {
    it('should allow paid → paid (same-state)', () => {
      expect(isInvoiceStatusTransitionAllowed('paid', 'paid')).toBe(true)
    })

    const lockedTargets: InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'overdue', 'void', 'written_off']
    it.each(lockedTargets)('should not allow paid → %s', (to) => {
      expect(isInvoiceStatusTransitionAllowed('paid', to)).toBe(false)
    })
  })

  describe('terminal state: void', () => {
    it('should allow void → void (same-state)', () => {
      expect(isInvoiceStatusTransitionAllowed('void', 'void')).toBe(true)
    })

    const lockedTargets: InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'overdue', 'paid', 'written_off']
    it.each(lockedTargets)('should not allow void → %s', (to) => {
      expect(isInvoiceStatusTransitionAllowed('void', to)).toBe(false)
    })
  })

  describe('terminal state: written_off', () => {
    it('should allow written_off → written_off (same-state)', () => {
      expect(isInvoiceStatusTransitionAllowed('written_off', 'written_off')).toBe(true)
    })

    const lockedTargets: InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'overdue', 'paid', 'void']
    it.each(lockedTargets)('should not allow written_off → %s', (to) => {
      expect(isInvoiceStatusTransitionAllowed('written_off', to)).toBe(false)
    })
  })

  describe('same-state transitions', () => {
    const statuses: InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'overdue']
    it.each(statuses)('should allow %s → %s (idempotent)', (status) => {
      expect(isInvoiceStatusTransitionAllowed(status, status)).toBe(true)
    })
  })
})

describe('isQuoteStatusTransitionAllowed', () => {
  describe('valid transitions from draft', () => {
    const validTargets: QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired']
    it.each(validTargets)('should allow draft → %s', (to) => {
      expect(isQuoteStatusTransitionAllowed('draft', to)).toBe(true)
    })
  })

  describe('valid transitions from sent', () => {
    const validTargets: QuoteStatus[] = ['sent', 'accepted', 'rejected', 'expired']
    it.each(validTargets)('should allow sent → %s', (to) => {
      expect(isQuoteStatusTransitionAllowed('sent', to)).toBe(true)
    })

    it('should not allow sent → draft', () => {
      expect(isQuoteStatusTransitionAllowed('sent', 'draft')).toBe(false)
    })
  })

  describe('terminal state: accepted', () => {
    it('should allow accepted → accepted (same-state)', () => {
      expect(isQuoteStatusTransitionAllowed('accepted', 'accepted')).toBe(true)
    })

    const lockedTargets: QuoteStatus[] = ['draft', 'sent', 'rejected', 'expired']
    it.each(lockedTargets)('should not allow accepted → %s', (to) => {
      expect(isQuoteStatusTransitionAllowed('accepted', to)).toBe(false)
    })
  })

  describe('terminal state: rejected', () => {
    it('should allow rejected → rejected (same-state)', () => {
      expect(isQuoteStatusTransitionAllowed('rejected', 'rejected')).toBe(true)
    })

    const lockedTargets: QuoteStatus[] = ['draft', 'sent', 'accepted', 'expired']
    it.each(lockedTargets)('should not allow rejected → %s', (to) => {
      expect(isQuoteStatusTransitionAllowed('rejected', to)).toBe(false)
    })
  })

  describe('transitions from expired', () => {
    const validTargets: QuoteStatus[] = ['expired', 'sent', 'accepted', 'rejected']
    it.each(validTargets)('should allow expired → %s', (to) => {
      expect(isQuoteStatusTransitionAllowed('expired', to)).toBe(true)
    })

    it('should not allow expired → draft', () => {
      expect(isQuoteStatusTransitionAllowed('expired', 'draft')).toBe(false)
    })
  })

  describe('same-state transitions', () => {
    const statuses: QuoteStatus[] = ['draft', 'sent', 'expired']
    it.each(statuses)('should allow %s → %s (idempotent)', (status) => {
      expect(isQuoteStatusTransitionAllowed(status, status)).toBe(true)
    })
  })
})
