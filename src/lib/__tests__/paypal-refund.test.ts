import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock retry to pass through
vi.mock('../retry', () => ({
  retry: vi.fn((fn: () => Promise<any>) => fn()),
  RetryConfigs: { api: {} },
}))

describe('refundPayPalPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    // Set env vars for PayPal config
    process.env.PAYPAL_CLIENT_ID = 'test-client-id'
    process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
    process.env.PAYPAL_ENVIRONMENT = 'sandbox'
  })

  function mockFetchForRefund(refundResponse: object) {
    return vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        // Mock access token response
        new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        // Mock refund response
        new Response(JSON.stringify(refundResponse), { status: 201 })
      )
  }

  it('should send PayPal-Request-Id header for idempotency', async () => {
    const fetchSpy = mockFetchForRefund({
      id: 'REFUND-123',
      status: 'COMPLETED',
      amount: { value: '10.00', currency_code: 'GBP' },
    })

    const { refundPayPalPayment } = await import('../paypal')
    await refundPayPalPayment('CAPTURE-ABC', 10, 'test-request-id-uuid')

    const refundCall = fetchSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('/refund')
    )
    expect(refundCall).toBeDefined()
    const headers = (refundCall![1] as RequestInit).headers as Record<string, string>
    expect(headers['PayPal-Request-Id']).toBe('test-request-id-uuid')
  })

  it('should NOT include note_to_payer in request body', async () => {
    const fetchSpy = mockFetchForRefund({
      id: 'REFUND-123',
      status: 'COMPLETED',
      amount: { value: '10.00', currency_code: 'GBP' },
    })

    const { refundPayPalPayment } = await import('../paypal')
    await refundPayPalPayment('CAPTURE-ABC', 10, 'req-id')

    const refundCall = fetchSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('/refund')
    )
    expect(refundCall).toBeDefined()
    const body = JSON.parse(refundCall![1]!.body as string)
    expect(body.note_to_payer).toBeUndefined()
  })

  it('should return status and statusDetails from PayPal response', async () => {
    mockFetchForRefund({
      id: 'REFUND-456',
      status: 'PENDING',
      status_details: { reason: 'ECHECK' },
      amount: { value: '25.00', currency_code: 'GBP' },
    })

    const { refundPayPalPayment } = await import('../paypal')
    const result = await refundPayPalPayment('CAPTURE-DEF', 25, 'req-id-2')

    expect(result.refundId).toBe('REFUND-456')
    expect(result.status).toBe('PENDING')
    expect(result.statusDetails).toBe('ECHECK')
    expect(result.amount).toBe('25.00')
    expect(result.currency).toBe('GBP')
  })

  it('uses the requested refund currency instead of hardcoded GBP', async () => {
    const fetchSpy = mockFetchForRefund({
      id: 'REFUND-EUR',
      status: 'COMPLETED',
      amount: { value: '12.00', currency_code: 'EUR' },
    })

    const { refundPayPalPayment } = await import('../paypal')
    const result = await refundPayPalPayment('CAPTURE-EUR', 12, 'req-eur', 'eur')

    const refundCall = fetchSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('/refund')
    )
    const body = JSON.parse(refundCall![1]!.body as string)
    expect(body.amount.currency_code).toBe('EUR')
    expect(result.currency).toBe('EUR')
  })
})

describe('capturePayPalPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.PAYPAL_CLIENT_ID = 'test-client-id'
    process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
    process.env.PAYPAL_ENVIRONMENT = 'sandbox'
  })

  it('rejects a captured payment with the wrong currency', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: 'ORDER-1',
          status: 'COMPLETED',
          payer: { payer_id: 'PAYER-1' },
          purchase_units: [{
            custom_id: 'booking-1',
            payments: {
              captures: [{
                id: 'CAPTURE-1',
                amount: { value: '10.00', currency_code: 'EUR' },
              }],
            },
          }],
        }), { status: 201 })
      )

    const { capturePayPalPayment } = await import('../paypal')
    await expect(capturePayPalPayment('ORDER-1', 'GBP')).rejects.toThrow(
      'PayPal capture currency mismatch'
    )
  })
})
