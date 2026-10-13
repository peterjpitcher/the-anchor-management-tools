import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock retry to pass through
vi.mock('../retry', () => ({
  retry: vi.fn((fn: () => Promise<any>) => fn()),
  RetryConfigs: { api: {} },
}))

// The name PayPal shows the customer on its own pay screen. Parking is the one caller that
// leaves it to the default, and the default used to be "The Anchor Pub" (website SSOT §1: the
// venue is "The Anchor").
describe('createSimplePayPalOrder brand name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.PAYPAL_CLIENT_ID = 'test-client-id'
    process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
    process.env.PAYPAL_ENVIRONMENT = 'sandbox'
  })

  function mockFetchForOrder() {
    return vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'ORDER-123', links: [{ rel: 'payer-action', href: 'https://paypal.test/approve' }] }),
          { status: 201 }
        )
      )
  }

  function sentBrandName(fetchSpy: ReturnType<typeof mockFetchForOrder>): unknown {
    const orderCall = fetchSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('/v2/checkout/orders')
    )
    expect(orderCall).toBeDefined()
    const body = JSON.parse(orderCall![1]!.body as string)
    return body.payment_source.paypal.experience_context.brand_name
  }

  const order = {
    customId: 'booking-1',
    reference: 'PARK-1',
    description: 'Parking booking PARK-1',
    amount: 15,
    returnUrl: 'https://example.test/return',
    cancelUrl: 'https://example.test/cancel',
  }

  it('shows the venue as "The Anchor" when the caller names no brand', async () => {
    const fetchSpy = mockFetchForOrder()

    const { createSimplePayPalOrder } = await import('../paypal')
    await createSimplePayPalOrder(order)

    expect(sentBrandName(fetchSpy)).toBe('The Anchor')
  })

  it('still sends a brand the caller chose', async () => {
    const fetchSpy = mockFetchForOrder()

    const { createSimplePayPalOrder } = await import('../paypal')
    await createSimplePayPalOrder({ ...order, brandName: 'Orange Jelly' })

    expect(sentBrandName(fetchSpy)).toBe('Orange Jelly')
  })
})
