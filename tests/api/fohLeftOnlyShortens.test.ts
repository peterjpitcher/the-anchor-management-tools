import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  getBooking: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: mocks.permission,
  requireBohTableBookingPermission: mocks.permission,
}))
vi.mock('@/lib/foh/bookings', () => ({ getTableBookingForFoh: mocks.getBooking }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/foh/bookings/[id]/left/route'
import { buildStaffStatusTransitionPlan, leftEndDatetime } from '@/lib/table-bookings/staff-status-actions'

const ID = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-24T19:00:00.000Z'
// Booked 16:00 to 17:30 London (BST), 'left' pressed an hour and a half late at 20:00.
const PLANNED_END = '2026-10-24T16:30:00.000Z'

function buildSupabase(assignmentResult: { error: unknown }) {
  const calls: { assignmentFilters: Array<[string, string, string]>; bookingUpdate: Record<string, unknown> | null } = {
    assignmentFilters: [],
    bookingUpdate: null,
  }
  const assignmentChain = {
    eq: (column: string, value: string) => { calls.assignmentFilters.push(['eq', column, value]); return assignmentChain },
    lt: (column: string, value: string) => { calls.assignmentFilters.push(['lt', column, value]); return assignmentChain },
    gt: (column: string, value: string) => { calls.assignmentFilters.push(['gt', column, value]); return Promise.resolve(assignmentResult) },
  }
  const bookingChain = {
    eq: () => bookingChain,
    select: () => ({ maybeSingle: async () => ({ data: { id: ID, status: 'confirmed', left_at: NOW }, error: null }) }),
  }
  const supabase = {
    from: (table: string) => {
      if (table === 'booking_table_assignments') return { update: () => assignmentChain }
      return {
        update: (values: Record<string, unknown>) => { calls.bookingUpdate = values; return bookingChain },
      }
    },
  }
  return { supabase, calls }
}

const call = () => POST(new NextRequest(`http://localhost/api/foh/bookings/${ID}/left`, { method: 'POST' }), {
  params: Promise.resolve({ id: ID }),
})

describe("'left' pressed late only ever shortens the table time (BK-093)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    mocks.getBooking.mockResolvedValue({ id: ID, status: 'confirmed', end_datetime: PLANNED_END })
  })
  afterEach(() => vi.useRealTimers())

  it('keeps the planned end when it is earlier, and cuts only assignments still running', async () => {
    const { supabase, calls } = buildSupabase({ error: null })
    mocks.permission.mockResolvedValue({ ok: true, userId: 'user-1', supabase })

    const res = await call()

    expect(res.status).toBe(200)
    expect(calls.bookingUpdate).toMatchObject({ left_at: NOW, end_datetime: PLANNED_END })
    expect(calls.assignmentFilters).toContainEqual(['gt', 'end_datetime', NOW])
  })

  it('still records the party as left when the assignment update is refused', async () => {
    const { supabase, calls } = buildSupabase({ error: { message: 'overlapping assignment' } })
    mocks.permission.mockResolvedValue({ ok: true, userId: 'user-1', supabase })

    const res = await call()

    expect(res.status).toBe(200)
    expect(calls.bookingUpdate).toMatchObject({ left_at: NOW })
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
  })
})

describe('leftEndDatetime and the BOH left plan', () => {
  it('uses the click time when the party leaves early', () => {
    expect(leftEndDatetime('2026-10-24T21:00:00.000Z', NOW)).toBe(NOW)
    expect(leftEndDatetime(null, NOW)).toBe(NOW)
  })

  it('never moves the end later', () => {
    const plan = buildStaffStatusTransitionPlan({
      action: 'left',
      booking: { status: 'confirmed', booking_date: '2026-10-24', booking_time: '16:00', start_datetime: '2026-10-24T15:00:00.000Z', end_datetime: PLANNED_END },
      nowIso: NOW,
    })
    expect(plan.ok && plan.plan.update).toMatchObject({ left_at: NOW, end_datetime: PLANNED_END })
  })
})
