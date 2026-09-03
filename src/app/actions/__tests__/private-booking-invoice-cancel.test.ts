import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('./../audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e as Error)?.message || String(e)),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn().mockReturnValue(false),
  sendInvoiceEmail: vi.fn(),
}))

import { cancelPrivateBookingInvoice } from '@/app/actions/privateBookingInvoice'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const SUPER_ADMIN = 'user-1'
const BOOKING_ID = 'booking-1'
const INVOICE_ID = 'invoice-1'

/** Minimal admin client: `get_user_roles` plus the booking select and the RPC. */
function mockAdmin(options: {
  roles?: Array<{ role_name: string }>
  booking?: Record<string, unknown> | null
  rpcResult?: unknown
  rpcError?: { message: string } | null
}) {
  const rpc = vi.fn((fn: string) => {
    if (fn === 'get_user_roles') {
      return Promise.resolve({ data: options.roles ?? [{ role_name: 'super_admin' }], error: null })
    }
    return Promise.resolve({
      data: options.rpcError ? null : (options.rpcResult ?? null),
      error: options.rpcError ?? null,
    })
  })

  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'eq']) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    chain.maybeSingle = vi.fn().mockResolvedValue({
      data: 'booking' in options ? options.booking : { id: BOOKING_ID, invoice_id: INVOICE_ID },
      error: null,
    })
    return chain
  })

  return { rpc, from } as unknown as ReturnType<typeof createAdminClient>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: SUPER_ADMIN } } }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>)
})

describe('cancelPrivateBookingInvoice', () => {
  it('refuses a caller who is not a super admin', async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin({ roles: [{ role_name: 'manager' }] }))

    const result = await cancelPrivateBookingInvoice(BOOKING_ID, 'Items changed')

    expect(result.error).toMatch(/super admins/i)
  })

  it('refuses an empty reason without touching the database', async () => {
    const admin = mockAdmin({})
    vi.mocked(createAdminClient).mockReturnValue(admin)

    const result = await cancelPrivateBookingInvoice(BOOKING_ID, '   ')

    expect(result.error).toBe('Give a reason for cancelling this invoice.')
    expect(admin.rpc).not.toHaveBeenCalledWith(
      'cancel_private_booking_invoice_atomic',
      expect.anything(),
    )
  })

  it('refuses a booking that has no invoice', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      mockAdmin({ booking: { id: BOOKING_ID, invoice_id: null } }),
    )

    const result = await cancelPrivateBookingInvoice(BOOKING_ID, 'Items changed')

    expect(result.error).toBe('This booking has no invoice to cancel.')
  })

  it('turns a real payment on the invoice into plain guidance', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      mockAdmin({ rpcError: { message: 'invoice_has_real_payments' } }),
    )

    const result = await cancelPrivateBookingInvoice(BOOKING_ID, 'Items changed')

    expect(result.error).toMatch(/credit note/i)
  })

  it('voids and unlinks, returning the cancelled invoice number', async () => {
    const admin = mockAdmin({
      rpcResult: { unlinked: true, voided: true, invoice_number: 'INV-003WJ' },
    })
    vi.mocked(createAdminClient).mockReturnValue(admin)

    const result = await cancelPrivateBookingInvoice(BOOKING_ID, 'Booked items changed')

    expect(result.error).toBeUndefined()
    expect(result.voided).toBe(true)
    expect(result.invoiceNumber).toBe('INV-003WJ')
    expect(admin.rpc).toHaveBeenCalledWith('cancel_private_booking_invoice_atomic', {
      p_booking_id: BOOKING_ID,
      p_reason: 'Booked items changed',
      p_actor_id: SUPER_ADMIN,
    })
  })
})
