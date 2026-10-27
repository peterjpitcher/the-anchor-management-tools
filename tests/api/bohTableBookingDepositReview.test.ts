import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase } from '../helpers/fakeSupabase'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/foh/api-auth', () => ({ requireBohTableBookingPermission: vi.fn() }))
const logAuditEvent = vi.fn(async () => undefined)
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: (...args: unknown[]) => logAuditEvent(...(args as [])) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { POST } from '@/app/api/boh/table-bookings/[id]/deposit-review/route'

/**
 * BK-043 (owner decision D20): a paid deposit that a party-size change left to settle on the bill
 * shows "Deposit to check" until a manager marks it checked. Managers only.
 */

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

function post() {
  return POST(new NextRequest(`https://management.orangejelly.co.uk/api/boh/table-bookings/${BOOKING_ID}/deposit-review`, { method: 'POST' }), {
    params: Promise.resolve({ id: BOOKING_ID }),
  })
}

describe('marking a deposit as checked', () => {
  beforeEach(() => vi.clearAllMocks())

  it('needs table_bookings manage', async () => {
    vi.mocked(requireBohTableBookingPermission).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    } as never)

    expect((await post()).status).toBe(403)
    expect(requireBohTableBookingPermission).toHaveBeenCalledWith('manage')
  })

  it('clears the flag and records who did it', async () => {
    const db = createFakeSupabase({
      table_bookings: [{ id: BOOKING_ID, deposit_review_needed_at: '2026-10-26T20:00:00.000Z', deposit_review_note: 'Party size 16 to 20.' }],
    })
    vi.mocked(requireBohTableBookingPermission).mockResolvedValue({ ok: true, userId: 'manager-1', supabase: db } as never)

    const response = await post()

    expect(response.status).toBe(200)
    expect(db.tables.table_bookings[0]).toMatchObject({ deposit_review_needed_at: null, deposit_review_note: null })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'manager-1',
      operation_type: 'table_booking.deposit_review_cleared',
      resource_id: BOOKING_ID,
    }))
  })

  it('says so when there is nothing to check', async () => {
    const db = createFakeSupabase({ table_bookings: [{ id: BOOKING_ID, deposit_review_needed_at: null }] })
    vi.mocked(requireBohTableBookingPermission).mockResolvedValue({ ok: true, userId: 'manager-1', supabase: db } as never)

    expect((await post()).status).toBe(409)
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})
