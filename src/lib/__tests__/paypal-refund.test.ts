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
  })
})
