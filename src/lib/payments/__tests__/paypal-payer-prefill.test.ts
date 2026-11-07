import { beforeEach, describe, expect, it, vi } from 'vitest'

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: log }))

import { loadPayPalPayerPrefill } from '../paypal-payer-prefill'

function clientReturning(result: { data: unknown; error: unknown } | (() => never)) {
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (typeof result === 'function') return result()
          return result
        },
      }),
    }),
  }))
  return { client: { from } as any, from }
}

const CUSTOMER = {
  first_name: 'Sam',
  last_name: 'Taylor',
  email: 'record@example.com',
  mobile_e164: '+447700900123',
  is_placeholder: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadPayPalPayerPrefill', () => {
  it('reads the customer and prefers the booking contact email', async () => {
    const { client, from } = clientReturning({ data: CUSTOMER, error: null })

    const payer = await loadPayPalPayerPrefill(client, { customerId: 'customer-1', contactEmail: ' booking@example.com ' })

    expect(from).toHaveBeenCalledWith('customers')
    expect(payer).toEqual({
      firstName: 'Sam',
      lastName: 'Taylor',
      email: 'booking@example.com',
      mobileE164: '+447700900123',
    })
  })

  it('falls back to the customer email when the booking has none', async () => {
    const { client } = clientReturning({ data: CUSTOMER, error: null })

    const payer = await loadPayPalPayerPrefill(client, { customerId: 'customer-1', contactEmail: null })

    expect(payer?.email).toBe('record@example.com')
  })

  it('gives nothing for a placeholder customer', async () => {
    const { client } = clientReturning({ data: { ...CUSTOMER, is_placeholder: true }, error: null })

    expect(await loadPayPalPayerPrefill(client, { customerId: 'customer-1', contactEmail: 'booking@example.com' })).toBeNull()
  })

  it('returns null and logs, never throws, when the read fails', async () => {
    const { client } = clientReturning({ data: null, error: { message: 'boom', code: '500' } })

    expect(await loadPayPalPayerPrefill(client, { customerId: 'customer-1' })).toBeNull()
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('PayPal prefill'),
      expect.objectContaining({ metadata: expect.objectContaining({ message: 'boom', code: '500' }) }),
    )
  })

  it('returns null when the client itself throws', async () => {
    const { client } = clientReturning(() => { throw new Error('network down') })

    expect(await loadPayPalPayerPrefill(client, { customerId: 'customer-1' })).toBeNull()
  })

  it('uses the contact email alone when there is no customer id', async () => {
    const { client, from } = clientReturning({ data: CUSTOMER, error: null })

    expect(await loadPayPalPayerPrefill(client, { customerId: null, contactEmail: 'booking@example.com' })).toEqual({
      email: 'booking@example.com',
    })
    expect(from).not.toHaveBeenCalled()
  })
})
