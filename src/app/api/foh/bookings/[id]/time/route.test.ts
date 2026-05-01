import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PATCH } from './route'
import { NextRequest } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
  getLondonDateIso: vi.fn((date: Date) => date.toISOString().slice(0, 10)),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}))

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

const makeRequest = (body: unknown, id = VALID_UUID) =>
  new NextRequest(`http://localhost/api/foh/bookings/${id}/time`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const makeParams = (id = VALID_UUID) => ({
  params: Promise.resolve({ id }),
})

const mockAuthFail = () => {
  vi.mocked(requireFohPermission).mockResolvedValueOnce({
    ok: false,
    response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  } as unknown as Awaited<ReturnType<typeof requireFohPermission>>)
}

const createSupabaseMock = () => {
  // Track calls to from() so we can differentiate between tables
  const assignmentEq = vi.fn().mockResolvedValue({
    data: [{
      start_datetime: '2026-03-15T13:00:00.000Z',
      end_datetime: '2026-03-15T15:00:00.000Z',
    }],
    error: null,
  })
  const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentEq })

  const rpc = vi.fn().mockResolvedValue({
    data: { state: 'updated', assignment_count: 1 },
    error: null,
  })

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'booking_table_assignments') {
      return { select: assignmentSelect }
    }
    if (table === 'table_bookings') {
      return { select: assignmentSelect }
    }
    return { select: assignmentSelect }
  })

  return { from, rpc, _assignmentEq: assignmentEq }
}

const mockAuthSuccess = (dbMock: Record<string, unknown> = {}) => {
  vi.mocked(requireFohPermission).mockResolvedValueOnce({
    ok: true,
    userId: 'user-1',
    supabase: dbMock as unknown as Awaited<ReturnType<typeof requireFohPermission>>['supabase'],
  } as unknown as Awaited<ReturnType<typeof requireFohPermission>>)
}

describe('PATCH /api/foh/bookings/[id]/time', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockAuthFail()
    const res = await PATCH(makeRequest({ time: '14:00' }), makeParams())
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid UUID in params', async () => {
    mockAuthSuccess({})
    const res = await PATCH(makeRequest({ time: '14:00' }), makeParams('not-a-uuid'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/invalid booking id/i)
  })

  it('returns 400 for missing time field', async () => {
    mockAuthSuccess({})
    const res = await PATCH(makeRequest({}), makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid time format (e.g. "25:00")', async () => {
    mockAuthSuccess({})
    const res = await PATCH(makeRequest({ time: '25:00' }), makeParams())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/hh:mm/i)
  })

  it('returns 400 for invalid time format (e.g. "9:00" without leading zero)', async () => {
    mockAuthSuccess({})
    const res = await PATCH(makeRequest({ time: '9:00' }), makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 200 and moves booking plus assignments through the atomic RPC', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await PATCH(makeRequest({ time: '14:00' }), makeParams())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)

    // Duration comes from assignments; mutation happens in the database RPC transaction.
    expect(db.from).toHaveBeenCalledWith('booking_table_assignments')
    expect(db.rpc).toHaveBeenCalledWith('move_table_booking_time_v05', expect.objectContaining({
      p_table_booking_id: VALID_UUID,
      p_booking_time: '14:00:00',
    }))
  })
})
