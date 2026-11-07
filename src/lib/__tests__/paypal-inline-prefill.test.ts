import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock retry to pass through
vi.mock('../retry', () => ({
  retry: vi.fn((fn: () => Promise<unknown>) => fn()),
  RetryConfigs: { api: {} },
}))

import {
  buildInlinePayPalOrderPayload,
  buildPayPalPrefillPaymentSource,
} from '../paypal'

/**
 * Prefilling PayPal's pay screen with the guest's own details (event checkout spec, Piece 2).
 * In PayPal's sandbox, payment_source.paypal with name, email, phone and country GB filled the
 * inline card form in and cut the address down to a postcode. These tests pin the block we send.
 */

const BASE_ORDER = {
  customId: 'event_booking:booking-1',
  reference: 'event_booking',
  description: 'Quiz night (2 seats)',
  amount: 80,
  currency: 'GBP',
  requestId: 'request-1',
}

// The payload as it was before prefill existed: a guest with no usable details must get exactly this.
const PAYLOAD_WITHOUT_PREFILL = {
  intent: 'CAPTURE',
  purchase_units: [
    {
      reference_id: 'event_booking',
      custom_id: 'event_booking:booking-1',
      description: 'Quiz night (2 seats)',
      amount: { currency_code: 'GBP', value: '80.00' },
    },
  ],
}

describe('buildPayPalPrefillPaymentSource', () => {
  it('sends name, email, UK mobile and country GB with no shipping, and no redirect URLs', () => {
    const source = buildPayPalPrefillPaymentSource({
      firstName: 'Sam',
      lastName: 'Taylor',
      email: 'sam@example.com',
      mobileE164: '+447700900123',
    })

    expect(source).toEqual({
      paypal: {
        name: { given_name: 'Sam', surname: 'Taylor' },
        email_address: 'sam@example.com',
        phone: { phone_type: 'MOBILE', phone_number: { national_number: '7700900123' } },
        address: { country_code: 'GB' },
        experience_context: { shipping_preference: 'NO_SHIPPING' },
      },
    })
    // Return and cancel URLs make the inline popup close itself (src/lib/paypal.ts).
    expect(JSON.stringify(source)).not.toMatch(/return_url|cancel_url/)
  })

  it('leaves the name out when the surname is missing or blank, and keeps the rest', () => {
    for (const lastName of [null, '', '   ', undefined]) {
      const source = buildPayPalPrefillPaymentSource({
        firstName: 'Sam',
        lastName,
        email: 'sam@example.com',
      })
      expect(source?.paypal).not.toHaveProperty('name')
      expect(source?.paypal.email_address).toBe('sam@example.com')
      expect(source?.paypal).not.toHaveProperty('phone')
    }
  })

  it('leaves the phone out for a number that is not a UK +44 number', () => {
    for (const mobileE164 of ['+15551234567', '+33612345678', '07700900123', '+44', '+44abc', null]) {
      const source = buildPayPalPrefillPaymentSource({
        firstName: 'Sam',
        lastName: 'Taylor',
        mobileE164,
      })
      expect(source?.paypal).not.toHaveProperty('phone')
      expect(source?.paypal.name).toEqual({ given_name: 'Sam', surname: 'Taylor' })
    }
  })

  it('leaves out an email PayPal would refuse', () => {
    const source = buildPayPalPrefillPaymentSource({ firstName: 'Sam', lastName: 'Taylor', email: 'not an email' })
    expect(source?.paypal).not.toHaveProperty('email_address')
  })

  it('trims whitespace from what it sends', () => {
    const source = buildPayPalPrefillPaymentSource({
      firstName: '  Sam ',
      lastName: ' Taylor ',
      email: ' sam@example.com ',
      mobileE164: ' +447700900123 ',
    })
    expect(source?.paypal.name).toEqual({ given_name: 'Sam', surname: 'Taylor' })
    expect(source?.paypal.email_address).toBe('sam@example.com')
    expect(source?.paypal.phone?.phone_number.national_number).toBe('7700900123')
  })

  it('returns null when there is nothing usable', () => {
    expect(buildPayPalPrefillPaymentSource(null)).toBeNull()
    expect(buildPayPalPrefillPaymentSource(undefined)).toBeNull()
    expect(buildPayPalPrefillPaymentSource({})).toBeNull()
    // A first name alone is not a name PayPal can use, and a US number is skipped.
    expect(buildPayPalPrefillPaymentSource({ firstName: 'Sam', mobileE164: '+15551234567' })).toBeNull()
  })
})

describe('buildInlinePayPalOrderPayload', () => {
  it('is exactly the old payload when no payer is given', () => {
    expect(buildInlinePayPalOrderPayload(BASE_ORDER)).toEqual(PAYLOAD_WITHOUT_PREFILL)
    expect(buildInlinePayPalOrderPayload({ ...BASE_ORDER, payer: null })).toEqual(PAYLOAD_WITHOUT_PREFILL)
  })

  it('is exactly the old payload when the payer has nothing usable', () => {
    expect(buildInlinePayPalOrderPayload({ ...BASE_ORDER, payer: { firstName: 'Sam' } })).toEqual(PAYLOAD_WITHOUT_PREFILL)
  })

  it('adds payment_source.paypal beside the unchanged purchase unit when there are details', () => {
    const payload = buildInlinePayPalOrderPayload({
      ...BASE_ORDER,
      payer: { firstName: 'Sam', lastName: 'Taylor', email: 'sam@example.com', mobileE164: '+447700900123' },
    })
    expect(payload.purchase_units).toEqual(PAYLOAD_WITHOUT_PREFILL.purchase_units)
    expect(payload.intent).toBe('CAPTURE')
    expect(payload).toHaveProperty('payment_source.paypal.address.country_code', 'GB')
    // Never the deprecated top-level payer field: it broke the card button in sandbox.
    expect(payload).not.toHaveProperty('payer')
  })
})

describe('createInlinePayPalOrder with a mocked PayPal', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.PAYPAL_CLIENT_ID = 'test-client-id'
    process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
    process.env.PAYPAL_ENVIRONMENT = 'sandbox'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockFetchForOrder() {
    return vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ORDER-123', status: 'CREATED' }), { status: 201 }))
  }

  function sentOrderBody(fetchSpy: ReturnType<typeof mockFetchForOrder>): Record<string, unknown> {
    const orderCall = fetchSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].endsWith('/v2/checkout/orders')
    )
    expect(orderCall).toBeDefined()
    expect(String(orderCall![0])).toContain('api-m.sandbox.paypal.com')
    return JSON.parse(orderCall![1]!.body as string)
  }

  it('posts the prefill block to the orders endpoint and returns the order id', async () => {
    const fetchSpy = mockFetchForOrder()
    const { createInlinePayPalOrder } = await import('../paypal')

    const result = await createInlinePayPalOrder({
      ...BASE_ORDER,
      payer: { firstName: 'Sam', lastName: 'Taylor', email: 'sam@example.com', mobileE164: '+447700900123' },
    })

    expect(result).toEqual({ orderId: 'ORDER-123' })
    const body = sentOrderBody(fetchSpy)
    expect(body.payment_source).toEqual({
      paypal: {
        name: { given_name: 'Sam', surname: 'Taylor' },
        email_address: 'sam@example.com',
        phone: { phone_type: 'MOBILE', phone_number: { national_number: '7700900123' } },
        address: { country_code: 'GB' },
        experience_context: { shipping_preference: 'NO_SHIPPING' },
      },
    })
  })

  it('posts the old body unchanged when there is no payer', async () => {
    const fetchSpy = mockFetchForOrder()
    const { createInlinePayPalOrder } = await import('../paypal')

    await createInlinePayPalOrder(BASE_ORDER)

    expect(sentOrderBody(fetchSpy)).toEqual(PAYLOAD_WITHOUT_PREFILL)
  })
})
