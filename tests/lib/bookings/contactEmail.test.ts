import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { preferBookingContactEmail, withBookingContactEmail } from '@/lib/bookings/contact-email'

const customer = {
  id: 'c1',
  email: 'old@example.com',
  email_status: 'bounced',
  email_deactivated_at: '2026-09-01T10:00:00Z',
}

function supabaseReturning(row: { contact_email: string | null } | null, error: unknown = null) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => ({ data: row, error }))
  return { from: vi.fn(() => builder) }
}

describe('booking contact email (BK-078)', () => {
  it('swaps in the typed address and clears the old address delivery flags', () => {
    expect(preferBookingContactEmail(customer, ' New@Example.com ')).toEqual({
      id: 'c1',
      email: 'new@example.com',
      email_status: null,
      email_deactivated_at: null,
    })
  })

  it('leaves the customer alone when the booking has no address or the same one', () => {
    expect(preferBookingContactEmail(customer, null)).toBe(customer)
    expect(preferBookingContactEmail(customer, 'OLD@example.com')).toBe(customer)
  })

  it('reads the address from the booking, and falls back to the customer when the read fails', async () => {
    const swapped = await withBookingContactEmail(supabaseReturning({ contact_email: 'new@example.com' }) as any, 'table_bookings', 'tb-1', customer)
    expect(swapped.email).toBe('new@example.com')

    const failed = await withBookingContactEmail(supabaseReturning(null, { code: '42703', message: 'boom' }) as any, 'table_bookings', 'tb-1', customer)
    expect(failed).toBe(customer)
  })
})
