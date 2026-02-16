import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
}))

vi.mock('@/lib/foh/bookings', () => ({
  getTableBookingForFoh: vi.fn(),
}))

vi.mock('@/lib/events/staff-seat-updates', () => ({
  mapSeatUpdateBlockedReason: vi.fn((reason?: string) => reason || 'blocked'),
  updateTableBookingPartySizeWithLinkedEventSeats: vi.fn(),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'
import { updateTableBookingPartySizeWithLinkedEventSeats } from '@/lib/events/staff-seat-updates'
import { GET as getFohMoveTable } from '@/app/api/foh/bookings/[id]/move-table/route'
import { POST as postBohMoveTable } from '@/app/api/boh/table-bookings/[id]/move-table/route'
import { POST as postFohPartySize } from '@/app/api/foh/bookings/[id]/party-size/route'
import { POST as postBohPartySize } from '@/app/api/boh/table-bookings/[id]/party-size/route'

function buildAvailabilityLoadFailureSupabase() {
  const tablesOrderSecond = vi.fn().mockResolvedValue({
    data: null,
    error: { message: 'sensitive availability diagnostics' },
  })
  const tablesOrderFirst = vi.fn().mockReturnValue({ order: tablesOrderSecond })
  const tablesSelect = vi.fn().mockReturnValue({ order: tablesOrderFirst })

  const assignmentEq = vi.fn().mockResolvedValue({ data: [], error: null })
  const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentEq })

  return {
    from: vi.fn((table: string) => {
      if (table === 'tables') {
        return { select: tablesSelect }
      }
      if (table === 'booking_table_assignments') {
        return { select: assignmentSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('table-booking route 500 payload sanitization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns generic GET move-table error payload when availability load fails', async () => {
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase: buildAvailabilityLoadFailureSupabase(),
    })
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-1',
      status: 'confirmed',
      booking_date: '2024-01-01',
      booking_time: '12:00:00',
      start_datetime: null,
      end_datetime: null,
      duration_minutes: 90,
      party_size: 2,
    })

    const response = await getFohMoveTable({} as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to load available tables' })
  })

  it('returns generic POST move-table error payload when availability check fails', async () => {
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase: buildAvailabilityLoadFailureSupabase(),
    })
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-1',
      status: 'confirmed',
      booking_date: '2024-01-01',
      booking_time: '12:00:00',
      start_datetime: null,
      end_datetime: null,
      duration_minutes: 90,
      party_size: 2,
    })

    const request = new Request('http://localhost/api/boh/table-bookings/booking-1/move-table', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table_id: '11111111-1111-4111-8111-111111111111' }),
    })

    const response = await postBohMoveTable(request as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to check table availability' })
  })

  it('returns generic FOH party-size error payload when linked seat update throws', async () => {
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase: {},
    })
    ;(updateTableBookingPartySizeWithLinkedEventSeats as unknown as vi.Mock).mockRejectedValue(
      new Error('sensitive seat sync diagnostics')
    )

    const request = {
      json: async () => ({ party_size: 4 }),
      nextUrl: { origin: 'http://localhost' },
    }

    const response = await postFohPartySize(request as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to update booking party size' })
  })

  it('returns generic BOH party-size error payload when linked seat update throws', async () => {
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase: {},
    })
    ;(updateTableBookingPartySizeWithLinkedEventSeats as unknown as vi.Mock).mockRejectedValue(
      new Error('sensitive seat sync diagnostics')
    )

    const request = {
      json: async () => ({ party_size: 4 }),
      nextUrl: { origin: 'http://localhost' },
    }

    const response = await postBohPartySize(request as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to update booking party size' })
  })
})
