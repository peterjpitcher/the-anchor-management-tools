import { describe, expect, it } from 'vitest'
import { buildInvoiceSentUpdate } from '@/lib/invoices/delivery-state'

describe('buildInvoiceSentUpdate', () => {
  it('records status, delivery time, and primary recipient together', () => {
    const sentAtIso = '2026-09-01T11:59:35.000Z'

    expect(buildInvoiceSentUpdate('billing@example.com', sentAtIso)).toEqual({
      status: 'sent',
      sent_at: sentAtIso,
      sent_to: 'billing@example.com',
      updated_at: sentAtIso,
    })
  })
})
