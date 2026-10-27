import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase } from '../helpers/fakeSupabase'

vi.mock('@/lib/foh/api-auth', () => ({
  requireBohTableBookingPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-12-05'),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { GET } from '@/app/api/boh/table-bookings/route'

/**
 * BK-043: the back-office list shows "Deposit to check" on a booking whose paid deposit a
 * party-size change left to settle on the bill, until a manager clears it.
 */

function booking(id: string, flagged: boolean) {
  return {
    id,
    booking_reference: id.toUpperCase(),
    booking_date: '2026-12-05',
    booking_time: '19:00:00',
    party_size: 16,
    status: 'confirmed',
    payment_status: 'completed',
    deposit_amount_locked: 160,
    start_datetime: '2026-12-05T19:00:00.000Z',
    end_datetime: '2026-12-05T21:00:00.000Z',
    cancellation_reason: null,
    deposit_review_needed_at: flagged ? '2026-12-01T10:00:00.000Z' : null,
    customer_id: null,
    event_id: null,
  }
}

describe('the back-office list', () => {
  beforeEach(() => {
    const db = createFakeSupabase({
      table_bookings: [booking('tb-flagged', true), booking('tb-plain', false)],
      booking_table_assignments: [],
      tables: [],
      events: [],
    })
    vi.mocked(requireBohTableBookingPermission).mockResolvedValue({ ok: true, userId: 'user-1', supabase: db } as never)
  })

  it('marks only the booking whose deposit needs checking', async () => {
    const response = await GET(new NextRequest('https://management.orangejelly.co.uk/api/boh/table-bookings?date=2026-12-05&view=day'))
    const body = await response.json()
    const rows = JSON.stringify(body)

    expect(response.status).toBe(200)
    const bookings = (body.data?.bookings ?? []) as Array<{ id: string; deposit_review_needed?: boolean }>
    expect(bookings.length, rows).toBe(2)
    expect(bookings.find((row) => row.id === 'tb-flagged')?.deposit_review_needed).toBe(true)
    expect(bookings.find((row) => row.id === 'tb-plain')?.deposit_review_needed).toBe(false)
  })
})
