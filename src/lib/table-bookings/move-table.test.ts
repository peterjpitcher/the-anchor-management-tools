import { describe, expect, it, vi } from 'vitest'
import { isAssignmentConflictError, moveBookingAssignmentToTables } from './move-table'

describe('isAssignmentConflictError', () => {
  it('should match the exclusion-constraint SQLSTATE 23P01 when code is set', () => {
    expect(isAssignmentConflictError({ code: '23P01', message: 'conflicting key value' })).toBe(true)
  })

  it('should match table_assignment_overlap when only the message survives', () => {
    expect(isAssignmentConflictError({ message: 'table_assignment_overlap' })).toBe(true)
  })

  it('should match table_assignment_private_blocked when only the message survives', () => {
    expect(isAssignmentConflictError({ message: 'table_assignment_private_blocked' })).toBe(true)
  })

  it('should match table_assignment_communal_overlap when only the message survives', () => {
    // Regression (TP-02): the communal trigger error is NOT a substring of
    // 'table_assignment_overlap' and used to fall through to a raw 500.
    expect(isAssignmentConflictError({ message: 'table_assignment_communal_overlap' })).toBe(true)
  })

  it('should not match unrelated database errors', () => {
    expect(isAssignmentConflictError({ code: '42703', message: 'column does not exist' })).toBe(false)
  })

  it('should handle null and undefined errors', () => {
    expect(isAssignmentConflictError(null)).toBe(false)
    expect(isAssignmentConflictError(undefined)).toBe(false)
  })
})

describe('moveBookingAssignmentToTables', () => {
  const input = {
    bookingId: 'booking-1',
    targetTableIds: ['table-a', 'table-b', 'table-a'],
    startIso: '2026-07-10T18:00:00.000Z',
    endIso: '2026-07-10T20:00:00.000Z',
    nowIso: '2026-07-10T17:00:00.000Z'
  }

  function createClient(rpcResult: { data?: unknown; error?: unknown }) {
    return {
      rpc: vi.fn().mockResolvedValue({ data: rpcResult.data ?? null, error: rpcResult.error ?? null })
    } as unknown as Parameters<typeof moveBookingAssignmentToTables>[0]
  }

  it('should call the atomic RPC once with deduped table ids and succeed when moved', async () => {
    const client = createClient({ data: { state: 'moved', table_ids: ['table-a', 'table-b'] } })

    const result = await moveBookingAssignmentToTables(client, input)

    expect(result).toEqual({ ok: true })
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('move_table_booking_assignments_v05', {
      p_table_booking_id: 'booking-1',
      p_table_ids: ['table-a', 'table-b'],
      p_start_datetime: input.startIso,
      p_end_datetime: input.endIso
    })
  })

  it('should map a communal trigger conflict from the RPC to a friendly 409', async () => {
    const client = createClient({
      error: { code: '23P01', message: 'table_assignment_communal_overlap' }
    })

    const result = await moveBookingAssignmentToTables(client, input)

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That table is no longer available. Please refresh and choose another.'
    })
  })

  it('should return 500 for unknown RPC errors', async () => {
    const client = createClient({ error: { code: '42883', message: 'function does not exist' } })

    const result = await moveBookingAssignmentToTables(client, input)

    expect(result).toEqual({ ok: false, status: 500, error: 'Failed to move table assignment' })
  })

  it('should return a 409 when the RPC reports the booking no longer exists', async () => {
    const client = createClient({ data: { state: 'blocked', reason: 'booking_not_found' } })

    const result = await moveBookingAssignmentToTables(client, input)

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Current table assignment changed. Refresh and retry.'
    })
  })

  it('should reject an empty target table list without calling the RPC', async () => {
    const client = createClient({ data: { state: 'moved' } })

    const result = await moveBookingAssignmentToTables(client, { ...input, targetTableIds: [] })

    expect(result).toEqual({ ok: false, status: 409, error: 'Select a table to move this booking' })
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
  })
})
