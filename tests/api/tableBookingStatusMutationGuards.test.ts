import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
}))

vi.mock('@/lib/foh/bookings', () => ({
  getTableBookingForFoh: vi.fn(),
  getFeePerHead: vi.fn(),
  createChargeRequestForBooking: vi.fn(),
  hasUnpaidSundayLunchDeposit: vi.fn(() => false),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import {
  createChargeRequestForBooking,
  getFeePerHead,
  getTableBookingForFoh,
} from '@/lib/foh/bookings'
import { POST as postFohSeated } from '@/app/api/foh/bookings/[id]/seated/route'
import { POST as postFohNoShow } from '@/app/api/foh/bookings/[id]/no-show/route'
import { POST as postBohStatus } from '@/app/api/boh/table-bookings/[id]/status/route'
import { POST as postFohMoveTable } from '@/app/api/foh/bookings/[id]/move-table/route'

function buildUpdateNoRowSupabase() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const select = vi.fn().mockReturnValue({ maybeSingle })
  const eq = vi.fn().mockReturnValue({ select })
  const update = vi.fn().mockReturnValue({ eq })

  return {
    supabase: {
      from: vi.fn().mockReturnValue({ update }),
    },
    update,
    eq,
  }
}

function buildUpdateSuccessSupabase(data: Record<string, unknown>) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const select = vi.fn().mockReturnValue({ maybeSingle })
  const eq = vi.fn().mockReturnValue({ select })
  const update = vi.fn().mockReturnValue({ eq })

  return {
    supabase: {
      from: vi.fn().mockReturnValue({ update }),
    },
    update,
    eq,
  }
}

describe('Table-booking mutation row-effect guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when FOH seated update affects no rows', async () => {
    const { supabase, eq } = buildUpdateNoRowSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-1',
      status: 'confirmed',
    })

    const response = await postFohSeated({} as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const payload = await response.json()

    expect(eq).toHaveBeenCalledWith('id', 'booking-1')
    expect(response.status).toBe(404)
    expect(payload).toEqual({ error: 'Booking not found' })
  })

  it('returns 404 and skips charge-request creation when FOH no-show update affects no rows', async () => {
    const { supabase } = buildUpdateNoRowSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-1',
      customer_id: 'customer-1',
      status: 'confirmed',
      party_size: 2,
      committed_party_size: 2,
      booking_date: '2024-01-01',
      booking_time: '12:00:00',
      start_datetime: null,
      end_datetime: null,
    })
    ;(getFeePerHead as unknown as vi.Mock).mockResolvedValue(15)

    const response = await postFohNoShow({} as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload).toEqual({ error: 'Booking not found' })
    expect(createChargeRequestForBooking).not.toHaveBeenCalled()
  })

  it('returns 404 and skips charge-request creation when BOH no-show update affects no rows', async () => {
    const { supabase } = buildUpdateNoRowSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-1',
      customer_id: 'customer-1',
      status: 'confirmed',
      party_size: 3,
      committed_party_size: 3,
      booking_date: '2024-01-01',
      booking_time: '12:00:00',
      start_datetime: null,
      end_datetime: null,
    })
    ;(getFeePerHead as unknown as vi.Mock).mockResolvedValue(20)

    const request = new Request('http://localhost/api/boh/table-bookings/booking-1/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'no_show' }),
    })

    const response = await postBohStatus(request as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload).toEqual({ error: 'Booking not found' })
    expect(createChargeRequestForBooking).not.toHaveBeenCalled()
  })

  it('clears no-show markers and normalizes pending_card_capture when seating via FOH', async () => {
    const { supabase, update } = buildUpdateSuccessSupabase({
      id: 'booking-1',
      status: 'confirmed',
      seated_at: '2026-02-23T10:00:00.000Z',
      left_at: null,
      no_show_at: null,
      no_show_marked_at: null,
      no_show_marked_by: null,
    })

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-1',
      status: 'pending_card_capture',
    })

    const response = await postFohSeated({} as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        left_at: null,
        no_show_at: null,
        no_show_marked_at: null,
        no_show_marked_by: null,
      })
    )
  })

  it('clears no-show markers and normalizes pending_card_capture when seating via BOH', async () => {
    const { supabase, update } = buildUpdateSuccessSupabase({
      id: 'booking-1',
      status: 'confirmed',
      seated_at: '2026-02-23T10:00:00.000Z',
      left_at: null,
      no_show_at: null,
      no_show_marked_at: null,
      no_show_marked_by: null,
    })

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-1',
      status: 'pending_card_capture',
    })

    const request = new Request('http://localhost/api/boh/table-bookings/booking-1/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'seated' }),
    })

    const response = await postBohStatus(request as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        left_at: null,
        no_show_at: null,
        no_show_marked_at: null,
        no_show_marked_by: null,
      })
    )
  })

  it('returns 409 consistently for invalid seated transitions in FOH and BOH', async () => {
    const { supabase, update } = buildUpdateNoRowSupabase()

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-1',
      status: 'completed',
      booking_date: '2026-02-23',
      booking_time: '12:00:00',
      start_datetime: null,
    })

    const fohResponse = await postFohSeated({} as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const fohPayload = await fohResponse.json()

    const bohRequest = new Request('http://localhost/api/boh/table-bookings/booking-1/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'seated' }),
    })
    const bohResponse = await postBohStatus(bohRequest as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const bohPayload = await bohResponse.json()

    expect(fohResponse.status).toBe(409)
    expect(bohResponse.status).toBe(409)
    expect(fohPayload).toEqual({ error: 'Cannot mark booking as seated from current status' })
    expect(bohPayload).toEqual({ error: 'Cannot mark booking as seated from current status' })
    expect(update).not.toHaveBeenCalled()
  })

  it('returns 409 consistently for invalid no-show transitions in FOH and BOH', async () => {
    const { supabase, update } = buildUpdateNoRowSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })
    ;(getTableBookingForFoh as unknown as vi.Mock).mockResolvedValue({
      id: 'booking-1',
      customer_id: 'customer-1',
      status: 'completed',
      party_size: 2,
      committed_party_size: 2,
      booking_date: '2026-02-23',
      booking_time: '12:00:00',
      start_datetime: null,
      end_datetime: null,
    })

    const fohResponse = await postFohNoShow({} as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const fohPayload = await fohResponse.json()

    const bohRequest = new Request('http://localhost/api/boh/table-bookings/booking-1/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'no_show' }),
    })
    const bohResponse = await postBohStatus(bohRequest as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const bohPayload = await bohResponse.json()

    expect(fohResponse.status).toBe(409)
    expect(bohResponse.status).toBe(409)
    expect(fohPayload).toEqual({ error: 'Cannot mark booking as no-show from current status' })
    expect(bohPayload).toEqual({ error: 'Cannot mark booking as no-show from current status' })
    expect(update).not.toHaveBeenCalled()
    expect(createChargeRequestForBooking).not.toHaveBeenCalled()
  })

  it('returns 409 when FOH move-table target assignment update affects no rows', async () => {
    const targetTableId = '11111111-1111-4111-8111-111111111111'

    const tablesOrderSecond = vi.fn().mockResolvedValue({
      data: [
        {
          id: targetTableId,
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
      data: [],
      error: null,
    })
    const moveLookupEq = vi.fn().mockResolvedValue({
      data: [
        { table_booking_id: 'booking-1', table_id: targetTableId },
        { table_booking_id: 'booking-1', table_id: '22222222-2222-4222-8222-222222222222' },
      ],
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

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEqTarget = vi.fn().mockReturnValue({ select: updateSelect })
    const updateEqBooking = vi.fn().mockReturnValue({ eq: updateEqTarget })
    const update = vi.fn().mockReturnValue({ eq: updateEqBooking })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'tables') {
          return { select: tablesSelect }
        }
        if (table === 'booking_table_assignments') {
          return { select: assignmentSelect, update }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
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

    const request = new Request('http://localhost/api/foh/bookings/booking-1/move-table', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table_id: targetTableId }),
    })
    const response = await postFohMoveTable(request as any, {
      params: Promise.resolve({ id: 'booking-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toEqual({ error: 'Current table assignment changed. Refresh and retry.' })
  })
})
