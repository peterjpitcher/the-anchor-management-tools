import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, depositConfirmation: true }))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    ...state.db,
    from: (table: string) => state.db.from(table),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'manager@example.com' } } })) },
  })),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) =>
    key === 'private_booking_deposit_confirmation' ? state.depositConfirmation : false
  ),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  createSimplePayPalOrder: vi.fn(async () => ({ orderId: 'order-1', approveUrl: 'https://paypal.example/approve' })),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
}))

vi.mock('@/lib/email/private-booking-emails', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email/private-booking-emails')>('@/lib/email/private-booking-emails')
  return {
    ...actual,
    sendDepositPaymentLinkEmail: vi.fn(async () => undefined),
    sendBookingCalendarInvite: vi.fn(async () => undefined),
  }
})

import { createSimplePayPalOrder } from '@/lib/paypal'
import { sendDepositPaymentLinkEmail } from '@/lib/email/private-booking-emails'
import { sendDepositPaymentLink } from '@/app/actions/privateBookingActions'

const BOOKING_ID = '11111111-2222-4333-8444-555555555555'

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    contact_email: 'host@example.com',
    event_date: '2026-10-31',
    event_type: 'Birthday party',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    deposit_confirmed_at: null,
    ...overrides,
  }
}

function seed(row: Record<string, unknown>) {
  state.db = createFakeSupabase({ private_bookings: [row] })
}

describe('Send payment link while the deposit is to be confirmed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.depositConfirmation = true
  })

  it('is refused, so the guest hears about a deposit only through Confirm deposit', async () => {
    seed(booking())

    const result = await sendDepositPaymentLink(BOOKING_ID)

    expect(result.error).toContain('Confirm the deposit first')
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
    expect(sendDepositPaymentLinkEmail).not.toHaveBeenCalled()
  })

  it('goes as before once the deposit is confirmed', async () => {
    seed(booking({ deposit_confirmed_at: '2026-09-11T10:00:00.000Z' }))

    const result = await sendDepositPaymentLink(BOOKING_ID)

    expect(result).toEqual({ success: true })
    expect(sendDepositPaymentLinkEmail).toHaveBeenCalledTimes(1)
  })

  it('goes exactly as today with the flag off', async () => {
    state.depositConfirmation = false
    seed(booking())

    const result = await sendDepositPaymentLink(BOOKING_ID)

    expect(result).toEqual({ success: true })
    expect(sendDepositPaymentLinkEmail).toHaveBeenCalledTimes(1)
  })
})
