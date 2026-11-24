// The unpaid reminders always carry a real link (spec section 8.3).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/parking/payments', () => ({ createParkingPaymentOrder: vi.fn() }))

import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { ensurePendingPaymentLink } from '@/lib/parking/reminder-payment-link'

const mockedOrder = createParkingPaymentOrder as unknown as Mock

function client(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
  chain.maybeSingle = async () => result
  return { from: () => chain } as never
}

const booking = {
  id: 'booking-1',
  reference: 'PAR-1',
  start_at: '2026-12-10T10:00:00.000Z',
  end_at: '2026-12-14T10:00:00.000Z',
  calculated_price: 60,
  override_price: null,
  payment_due_at: null,
} as never

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('ensurePendingPaymentLink', () => {
  it('uses the pending payment link when there is one', async () => {
    const link = await ensurePendingPaymentLink(client({ data: { metadata: { approve_url: 'https://pp/existing' } }, error: null }), booking)
    expect(link).toBe('https://pp/existing')
    expect(mockedOrder).not.toHaveBeenCalled()
  })

  it('makes a new order when there is no pending payment', async () => {
    mockedOrder.mockResolvedValue({ approveUrl: 'https://pp/new' })
    const link = await ensurePendingPaymentLink(client({ data: null, error: null }), booking)
    expect(link).toBe('https://pp/new')
    expect(mockedOrder).toHaveBeenCalledTimes(1)
  })

  it('returns null (no "link shortly" text) when the order cannot be made', async () => {
    mockedOrder.mockRejectedValue(new Error('PayPal down'))
    expect(await ensurePendingPaymentLink(client({ data: null, error: null }), booking)).toBeNull()
  })

  it('makes no second order when the pending payment cannot be read', async () => {
    expect(await ensurePendingPaymentLink(client({ data: null, error: { message: 'boom' } }), booking)).toBeNull()
    expect(mockedOrder).not.toHaveBeenCalled()
  })
})
