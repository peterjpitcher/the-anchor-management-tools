import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { readPayPalCaptureFee, recordPayPalCaptureFee } from './paypal-fees'
import { logger } from '@/lib/logger'

describe('PayPal capture fees (BK-117)', () => {
  it('reads the fee from a capture', () => {
    expect(readPayPalCaptureFee({
      id: 'CAP-1',
      amount: { value: '160.00', currency_code: 'GBP' },
      seller_receivable_breakdown: {
        gross_amount: { value: '160.00', currency_code: 'GBP' },
        paypal_fee: { value: '5.42', currency_code: 'GBP' },
        net_amount: { value: '154.58' },
      },
    })).toEqual({ captureId: 'CAP-1', fee: 5.42, gross: 160, net: 154.58, currency: 'GBP' })
  })

  it('reads nothing when PayPal reported no fee or no capture id', () => {
    expect(readPayPalCaptureFee({ id: 'CAP-1', amount: { value: '1.00' } })).toBeNull()
    expect(readPayPalCaptureFee({ seller_receivable_breakdown: { paypal_fee: { value: '1.00' } } })).toBeNull()
    expect(readPayPalCaptureFee({ id: 'CAP-1', seller_receivable_breakdown: { paypal_fee: { value: 'x' } } })).toBeNull()
    expect(readPayPalCaptureFee(null)).toBeNull()
  })

  it('never throws when the write fails', async () => {
    const db = { from: () => ({ upsert: async () => { throw new Error('network down') } }) }
    const recorded = await recordPayPalCaptureFee(db as never, { captureId: 'CAP-1', fee: 1, gross: 10, net: 9, currency: 'GBP' }, 'test')
    expect(recorded).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('Failed to record a PayPal capture fee', expect.anything())
  })
})
