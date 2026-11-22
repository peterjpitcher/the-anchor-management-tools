import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../retry', () => ({
  retry: vi.fn((fn: () => Promise<unknown>) => fn()),
  RetryConfigs: { api: {} },
}))

import { describePayPalError } from '../paypal-error-detail'

/**
 * When PayPal refuses to create an order, the error used to be a bare message: the HTTP status,
 * PayPal's error name, its debug id and its issue codes were thrown away, so a deposit pay page
 * that could not be set up was recorded with nothing to tell one failure from another or to give
 * PayPal's support. The message is unchanged; the rest now travels with it.
 */
describe('createInlinePayPalOrder when PayPal refuses the order', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.PAYPAL_CLIENT_ID = 'test-client-id'
    process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
    process.env.PAYPAL_ENVIRONMENT = 'sandbox'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  const ORDER = {
    customId: 'table_booking:booking-1',
    reference: 'table_booking',
    description: 'Table deposit',
    amount: 150,
    currency: 'GBP',
    requestId: 'request-1',
  }

  function refuseWith(body: string, status: number) {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(body, { status }))
  }

  it('keeps its message and carries the status, name, debug id and issue codes', async () => {
    refuseWith(JSON.stringify({
      name: 'UNPROCESSABLE_ENTITY',
      message: 'The requested action could not be performed.',
      debug_id: 'abc123def456',
      details: [{ issue: 'payee_account_restricted', description: 'The merchant account is restricted.' }],
    }), 422)
    const { createInlinePayPalOrder } = await import('../paypal')

    const error = await createInlinePayPalOrder(ORDER).then(() => null, (thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('The merchant account is restricted.')
    expect(describePayPalError(error)).toEqual({
      status: 422,
      name: 'UNPROCESSABLE_ENTITY',
      issues: ['PAYEE_ACCOUNT_RESTRICTED'],
      debugId: 'abc123def456',
      message: 'The requested action could not be performed.',
    })
  })

  it('still carries the status when PayPal answers with something that is not JSON', async () => {
    refuseWith('Bad Gateway', 502)
    const { createInlinePayPalOrder } = await import('../paypal')

    const error = await createInlinePayPalOrder(ORDER).then(() => null, (thrown: unknown) => thrown)

    expect((error as Error).message).toBe('Failed to create PayPal order')
    expect(describePayPalError(error)).toMatchObject({ status: 502, name: null, issues: [], message: 'Failed to create PayPal order' })
  })
})
