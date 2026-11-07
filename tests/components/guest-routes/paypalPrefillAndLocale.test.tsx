import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Event checkout spec, Piece 2, on the two guest payment-link pages this app renders itself:
 * the table deposit page passes the guest to PayPal so its pay screen is prefilled, and both
 * pages load PayPal in en_GB. Without a locale PayPal follows the browser language, and a
 * US-English browser got a US address form (State, ZIP code, a +1 phone) in sandbox.
 */

const sdk = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }))

vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ options, children }: { options: Record<string, unknown>; children: React.ReactNode }) => {
    sdk.options.push(options)
    return <div>{children}</div>
  },
  PayPalButtons: () => <div data-testid="paypal-buttons" />,
}))

const paypal = vi.hoisted(() => ({
  createInlinePayPalOrder: vi.fn(async () => ({ orderId: 'ORDER-NEW' })),
  getPayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
}))
vi.mock('@/lib/paypal', () => paypal)

const prefill = vi.hoisted(() => ({ loadPayPalPayerPrefill: vi.fn() }))
vi.mock('@/lib/payments/paypal-payer-prefill', () => prefill)

const bookingRow = {
  payment_status: 'pending',
  paypal_deposit_order_id: null,
  is_outside_seating: false,
  booking_period_id: null,
  contact_email: 'booking@example.com',
}

const supabaseStub = {
  from(table: string) {
    return {
      select: () => ({
        eq: () => ({
          single: async () => ({ data: table === 'table_bookings' ? bookingRow : null, error: null }),
          maybeSingle: async () => ({ data: table === 'customers' ? { first_name: 'Sam' } : null, error: null }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }
  },
}

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => supabaseStub }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: async () => ({ allowed: true }) }))
vi.mock('@/lib/table-bookings/bookings', () => ({
  getTablePaymentPreviewByRawToken: async () => ({
    state: 'ready',
    tableBookingId: 'booking-1',
    customerId: 'customer-1',
    bookingReference: 'TB-2026-0042',
    totalAmount: 150,
    currency: 'GBP',
    partySize: 15,
    holdExpiresAt: '2099-01-01T18:00:00.000Z',
  }),
  loadChristmasFoodDeadline: async () => ({ closesAtIso: null, cutoffDays: 7 }),
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

import { EventPayPalPaymentClient } from '@/app/g/[token]/event-payment/EventPayPalPaymentClient'

beforeEach(() => {
  sdk.options = []
  vi.clearAllMocks()
})

describe('table deposit payment-link page', () => {
  it('passes the guest, with the booking contact email, to the new PayPal order', async () => {
    const payer = { firstName: 'Sam', lastName: 'Taylor', email: 'booking@example.com', mobileE164: '+447700900123' }
    prefill.loadPayPalPayerPrefill.mockResolvedValueOnce(payer)

    const { default: TablePaymentPage } = await import('@/app/g/[token]/table-payment/page')
    render(await TablePaymentPage({ params: Promise.resolve({ token: 'raw-token' }), searchParams: Promise.resolve({}) }))

    expect(prefill.loadPayPalPayerPrefill).toHaveBeenCalledWith(expect.anything(), {
      customerId: 'customer-1',
      contactEmail: 'booking@example.com',
    })
    expect(paypal.createInlinePayPalOrder).toHaveBeenCalledWith(expect.objectContaining({ payer, amount: 150 }))
    expect(sdk.options.at(-1)).toMatchObject({ locale: 'en_GB', currency: 'GBP' })
  })
})

describe('event payment-link page', () => {
  it('loads PayPal in en_GB', () => {
    render(
      <EventPayPalPaymentClient token="tok-1" paypalClientId="client-id" paypalEnvironment="sandbox" currency="GBP" fallbackUrl="/g/tok-1/event-payment" />,
    )
    expect(sdk.options.at(-1)).toMatchObject({ locale: 'en_GB', currency: 'GBP' })
  })
})
