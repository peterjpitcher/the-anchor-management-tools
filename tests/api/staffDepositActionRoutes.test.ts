import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireFohPermission: vi.fn(),
  requireBohTableBookingPermission: vi.fn(),
  runStaffDepositAction: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: mocks.requireFohPermission,
  requireBohTableBookingPermission: mocks.requireBohTableBookingPermission,
}))
vi.mock('@/lib/table-bookings/staff-deposit-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/staff-deposit-actions')>()),
  runStaffDepositAction: mocks.runStaffDepositAction,
}))

import { POST as postFoh } from '@/app/api/foh/bookings/[id]/deposit/route'
import { POST as postBoh } from '@/app/api/boh/table-bookings/[id]/deposit/route'

/**
 * BK-045, owner decision D18: waiving, recording a deposit taken at the bar and giving the guest
 * longer all need table_bookings manage, on the FOH iPad and the booking page alike.
 */

const BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

function request(body: unknown) {
  return new NextRequest(`https://management.orangejelly.co.uk/api/foh/bookings/${BOOKING_ID}/deposit`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
const context = { params: Promise.resolve({ id: BOOKING_ID }) }

describe('the deposit action routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireFohPermission.mockResolvedValue({ ok: true, userId: 'manager-1', supabase: {} })
    mocks.requireBohTableBookingPermission.mockResolvedValue({ ok: true, userId: 'manager-1', supabase: {} })
    mocks.runStaffDepositAction.mockResolvedValue({ ok: true, message: 'Deposit of £160.00 waived.' })
  })

  it.each([
    ['FOH', postFoh, mocks.requireFohPermission],
    ['BOH', postBoh, mocks.requireBohTableBookingPermission],
  ])('%s asks for table_bookings manage, and refuses without it', async (_label, post, permission) => {
    permission.mockResolvedValueOnce({ ok: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) })

    const response = await post(request({ action: 'waive', reason: 'Pub event' }), context)

    expect(permission).toHaveBeenCalledWith('manage')
    expect(response.status).toBe(403)
    expect(mocks.runStaffDepositAction).not.toHaveBeenCalled()
  })

  it('needs a reason, and a time to extend to', async () => {
    expect((await postFoh(request({ action: 'waive', reason: '' }), context)).status).toBe(400)
    expect((await postFoh(request({ action: 'extend', reason: 'Away until Monday' }), context)).status).toBe(400)
    expect(mocks.runStaffDepositAction).not.toHaveBeenCalled()
  })

  it('runs the action for the manager and answers with what happened', async () => {
    const response = await postBoh(request({ action: 'waive', reason: 'Pub event' }), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, message: 'Deposit of £160.00 waived.', warning: null })
    expect(mocks.runStaffDepositAction).toHaveBeenCalledWith({}, {
      bookingId: BOOKING_ID,
      userId: 'manager-1',
      request: { action: 'waive', reason: 'Pub event' },
    })
  })

  it('passes a refusal through with its status', async () => {
    mocks.runStaffDepositAction.mockResolvedValue({ ok: false, status: 409, error: 'This booking has no unpaid deposit to settle.' })

    const response = await postFoh(request({ action: 'cash', reason: 'Cash' }), context)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'This booking has no unpaid deposit to settle.' })
  })
})
