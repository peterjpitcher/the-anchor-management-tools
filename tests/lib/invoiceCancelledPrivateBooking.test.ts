import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * BK-065: a guest whose private booking was cancelled could still pay its invoice online. An
 * invoice of a cancelled booking (its own invoice or an extras one) is closed to online payment,
 * and not knowing counts as closed.
 */
const state = vi.hoisted(() => ({ db: null as any }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { invoiceBookingCancelled } from '@/lib/invoices/cancelled-private-booking'

function seed(bookings: Record<string, unknown>[], links: Record<string, unknown>[] = []) {
  state.db = createFakeSupabase({ private_bookings: bookings, private_booking_invoices: links })
}

describe('whether an invoice belongs to a cancelled private booking', () => {
  it("is true for the booking's own invoice once the booking is cancelled", async () => {
    seed([{ id: 'b1', status: 'cancelled', invoice_id: 'inv-1' }])
    expect(await invoiceBookingCancelled('inv-1')).toBe(true)
  })

  it('is true for an extras invoice of a cancelled booking', async () => {
    seed([{ id: 'b1', status: 'cancelled', invoice_id: null }], [{ booking_id: 'b1', invoice_id: 'inv-2', kind: 'supplementary' }])
    expect(await invoiceBookingCancelled('inv-2')).toBe(true)
  })

  it('is false for a live booking, and for an invoice with no booking', async () => {
    seed([{ id: 'b1', status: 'confirmed', invoice_id: 'inv-1' }])
    expect(await invoiceBookingCancelled('inv-1')).toBe(false)
    expect(await invoiceBookingCancelled('inv-9')).toBe(false)
  })

  it('is unknown when it cannot be read', async () => {
    seed([])
    state.db.failures.push({ table: 'private_bookings', op: 'select', error: { message: 'timeout' } })
    expect(await invoiceBookingCancelled('inv-1')).toBe('unknown')
  })
})
