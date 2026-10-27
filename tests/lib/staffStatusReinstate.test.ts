import { describe, expect, it, vi } from 'vitest'

/**
 * BK-048 (customer bookings review, 24 October 2026): 'Mark Confirmed' turned a cancelled or
 * completed booking confirmed again in one click, with no check that its table was still free, no
 * new deposit after a refund and nothing said to the guest. A no-show can still be put back, but
 * only when its table is free and its deposit is still held.
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { buildStaffStatusTransitionPlan, staffStatusActionsFor } from '@/lib/table-bookings/staff-status-actions'
import { checkNoShowCanComeBack } from '@/lib/table-bookings/reinstate-check'
import { createRecordingSupabase, type RecordedQuery } from '../mocks/recordingSupabase'

const BOOKING = { booking_date: '2026-11-20', booking_time: '19:00:00', start_datetime: '2026-11-20T19:00:00.000Z' }

describe('Mark Confirmed', () => {
  it.each(['cancelled', 'completed'])('refuses to bring back a %s booking', (status) => {
    const result = buildStaffStatusTransitionPlan({ action: 'confirmed', booking: { ...BOOKING, status }, nowIso: '2026-10-26T12:00:00Z' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })

  it('still puts a no-show back, once the routes have checked it', () => {
    const result = buildStaffStatusTransitionPlan({ action: 'confirmed', booking: { ...BOOKING, status: 'no_show' }, nowIso: '2026-10-26T12:00:00Z' })
    expect(result.ok).toBe(true)
  })
})

describe('the status buttons the booking page shows', () => {
  it('shows none on a cancelled or completed booking', () => {
    expect(staffStatusActionsFor({ status: 'cancelled' })).toEqual([])
    expect(staffStatusActionsFor({ status: 'completed', seated_at: 'x', left_at: 'y' })).toEqual([])
  })

  it('offers to put a no-show back', () => {
    expect(staffStatusActionsFor({ status: 'no_show' })).toEqual(['seated', 'confirmed'])
  })

  it('follows the seated and left times on a live booking', () => {
    expect(staffStatusActionsFor({ status: 'confirmed' })).toEqual(['seated', 'completed'])
    expect(staffStatusActionsFor({ status: 'confirmed', seated_at: 'x' })).toEqual(['left', 'completed'])
    expect(staffStatusActionsFor({ status: 'confirmed', seated_at: 'x', left_at: 'y' })).toEqual(['completed'])
    expect(staffStatusActionsFor({ status: 'pending_payment' })).toEqual(['seated', 'confirmed', 'completed'])
  })
})

const NO_SHOW = {
  id: 'b-1',
  status: 'no_show',
  payment_status: null,
  deposit_waived: false,
  party_size: 4,
  committed_party_size: 4,
  booking_type: 'regular',
}

function tables(answers: {
  mine?: unknown
  others?: unknown
  bookings?: unknown
}) {
  return createRecordingSupabase({
    tables: {
      booking_table_assignments: (query: RecordedQuery) =>
        query.calls.some((call) => call.method === 'neq')
          ? answers.others ?? { data: [], error: null }
          : answers.mine ?? {
              data: [{ table_id: 't-1', start_datetime: '2026-11-20T19:00:00.000Z', end_datetime: '2026-11-20T21:00:00.000Z' }],
              error: null,
            },
      table_bookings: () => answers.bookings ?? { data: [], error: null },
    },
  })
}

describe('putting a no-show back', () => {
  it('refuses when its table is now booked by someone else', async () => {
    const db = tables({
      others: { data: [{ table_id: 't-1', table_booking_id: 'b-2', start_datetime: '2026-11-20T20:00:00.000Z', end_datetime: '2026-11-20T22:00:00.000Z' }], error: null },
      bookings: { data: [{ id: 'b-2', booking_reference: 'TB-OTHER', status: 'confirmed', left_at: null }], error: null },
    })

    const problem = await checkNoShowCanComeBack(db.client as never, NO_SHOW)

    expect(problem).toBe('Its table is now booked by TB-OTHER at that time, so this booking cannot be put back. Move one of them first.')
  })

  it('allows it when the other booking on that table was cancelled or has left', async () => {
    const db = tables({
      others: { data: [{ table_id: 't-1', table_booking_id: 'b-2', start_datetime: '2026-11-20T20:00:00.000Z', end_datetime: '2026-11-20T22:00:00.000Z' }], error: null },
      bookings: { data: [{ id: 'b-2', booking_reference: 'TB-OTHER', status: 'cancelled', left_at: null }], error: null },
    })

    expect(await checkNoShowCanComeBack(db.client as never, NO_SHOW)).toBeNull()
  })

  it('allows it when nothing else is on the table', async () => {
    expect(await checkNoShowCanComeBack(tables({}).client as never, NO_SHOW)).toBeNull()
  })

  it('refuses when a required deposit was refunded', async () => {
    const problem = await checkNoShowCanComeBack(tables({}).client as never, {
      ...NO_SHOW,
      party_size: 16,
      committed_party_size: 16,
      payment_status: 'refunded',
    })
    expect(problem).toMatch(/deposit on this booking has been refunded/)
  })

  it('refuses a refunded Christmas deposit at any size', async () => {
    const problem = await checkNoShowCanComeBack(tables({}).client as never, {
      ...NO_SHOW,
      booking_type: 'christmas',
      payment_status: 'refunded',
    })
    expect(problem).toMatch(/refunded/)
  })

  it('refuses, rather than guess, when the tables cannot be read', async () => {
    const problem = await checkNoShowCanComeBack(
      tables({ mine: { data: null, error: { message: 'boom' } } }).client as never,
      NO_SHOW,
    )
    expect(problem).toMatch(/Could not check the table is still free/)
  })
})
