import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
}))

vi.mock('@/lib/foh/bookings', () => ({
  getTableBookingForFoh: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'
import { GET as getFohMoveTable, POST as postFohMoveTable } from '@/app/api/foh/bookings/[id]/move-table/route'
import { GET as getBohMoveTable, POST as postBohMoveTable } from '@/app/api/boh/table-bookings/[id]/move-table/route'

const BOOKING_ID = 'booking-1'
const TARGET_TABLE_ID = '11111111-1111-4111-8111-111111111111'
const CURRENT_TABLE_ID = '22222222-2222-4222-8222-222222222222'

function buildMoveTableSupabase() {
  const tablesOrderSecond = vi.fn().mockResolvedValue({
    data: [
      {
        id: TARGET_TABLE_ID,
        table_number: '1',
        name: 'One',
        capacity: 4,
        is_bookable: true,
      },
    ],
    error: null,
  })
  const tablesOrderFirst = vi.fn().mockReturnValue({ order: tablesOrderSecond })
  const tablesSelect = vi.fn().mockReturnValue({ order: tablesOrderFirst })

  const existingAssignmentEq = vi.fn().mockResolvedValue({
    data: [{ table_id: CURRENT_TABLE_ID }],
    error: null,
  })
  const moveLookupEq = vi.fn().mockResolvedValue({
    data: [{ table_booking_id: BOOKING_ID, table_id: CURRENT_TABLE_ID }],
    error: null,
  })
  const overlapGt = vi.fn().mockResolvedValue({ data: [], error: null })
  const overlapLt = vi.fn().mockReturnValue({ gt: overlapGt })
  const overlapNeq = vi.fn().mockReturnValue({ lt: overlapLt })
  const overlapIn = vi.fn().mockReturnValue({ neq: overlapNeq })

  const assignmentSelect = vi.fn((columns: string) => {
    if (columns === 'table_id') {
      return { eq: existingAssignmentEq }
    }
    if (columns === 'table_booking_id, table_id') {
      return { eq: moveLookupEq }
    }
    if (columns === 'table_id, table_booking_id') {
      return { in: overlapIn }
    }
    throw new Error(`Unexpected select columns: ${columns}`)
  })

  const insert = vi.fn().mockResolvedValue({ error: null })
  const deleteNeq = vi.fn().mockResolvedValue({ error: null })
  const deleteEq = vi.fn().mockReturnValue({ neq: deleteNeq })
  const del = vi.fn().mockReturnValue({ eq: deleteEq })

  return {
    from: vi.fn((table: string) => {
      if (table === 'tables') {
        return { select: tablesSelect }
      }
      if (table === 'booking_table_assignments') {
        return { select: assignmentSelect, insert, delete: del }
      }
      if (table === 'table_bookings') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
  }
}

describe('FOH/BOH move-table parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: BOOKING_ID,
      status: 'confirmed',
      booking_date: '2026-02-23',
      booking_time: '12:00:00',
      start_datetime: null,
      end_datetime: null,
      duration_minutes: 90,
      party_size: 2,
    })
  })

  it('returns equivalent GET availability payloads for FOH and BOH', async () => {
    const fohSupabase = buildMoveTableSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValueOnce({
      ok: true,
      userId: 'user-1',
      supabase: fohSupabase,
    })
    const fohResponse = await getFohMoveTable({} as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })
    const fohPayload = await fohResponse.json()

    const bohSupabase = buildMoveTableSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValueOnce({
      ok: true,
      userId: 'user-1',
      supabase: bohSupabase,
    })
    const bohResponse = await getBohMoveTable({} as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })
    const bohPayload = await bohResponse.json()

    expect(fohResponse.status).toBe(200)
    expect(bohResponse.status).toBe(200)
    expect(bohPayload).toEqual(fohPayload)
  })

  it('returns equivalent POST move-table payloads for FOH and BOH', async () => {
    const fohSupabase = buildMoveTableSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValueOnce({
      ok: true,
      userId: 'user-1',
      supabase: fohSupabase,
    })
    const fohRequest = new Request('http://localhost/api/foh/bookings/booking-1/move-table', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table_id: TARGET_TABLE_ID }),
    })
    const fohResponse = await postFohMoveTable(fohRequest as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })
    const fohPayload = await fohResponse.json()

    const bohSupabase = buildMoveTableSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValueOnce({
      ok: true,
      userId: 'user-1',
      supabase: bohSupabase,
    })
    const bohRequest = new Request('http://localhost/api/boh/table-bookings/booking-1/move-table', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table_id: TARGET_TABLE_ID }),
    })
    const bohResponse = await postBohMoveTable(bohRequest as any, {
      params: Promise.resolve({ id: BOOKING_ID }),
    })
    const bohPayload = await bohResponse.json()

    expect(fohResponse.status).toBe(200)
    expect(bohResponse.status).toBe(200)
    expect(bohPayload).toEqual(fohPayload)
  })
})
