import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  covers: [] as Array<{ ordinal: number; guest_name: string | null }>,
  policy: null as Record<string, unknown> | null,
  canManage: false,
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(async () => ({
    ok: true,
    userId: 'user-1',
    supabase: {
      from: (table: string) => ({
        select: () => ({
          eq: () =>
            table === 'booking_preorder_covers'
              ? Promise.resolve({ data: state.covers, error: null })
              : { maybeSingle: async () => ({ data: state.row, error: null }) },
        }),
      }),
      rpc: async () => ({ data: state.policy, error: null }),
    },
  })),
  tableBookingsManagerCheck: () => async () => state.canManage,
}))

import { GET } from '@/app/api/foh/bookings/[id]/christmas-courses/route'

const ID = '11111111-1111-4111-8111-111111111111'

async function read(row: Record<string, unknown>) {
  state.row = row
  const response = await GET(new NextRequest(`http://localhost/api/foh/bookings/${ID}/christmas-courses`), {
    params: Promise.resolve({ id: ID }),
  })
  return response.json()
}

beforeEach(() => {
  state.covers = []
  state.policy = { multiple_courses_available: true }
  state.canManage = false
})

// BK-057: the party-size dialogs offer to record courses once on a Christmas booking with none.
describe('GET /api/foh/bookings/[id]/christmas-courses', () => {
  it('lets a Christmas booking with no courses have them set', async () => {
    expect(await read({ booking_type: 'christmas', booking_period_answer: true, christmas_course_counts: null })).toEqual({
      course_counts: null,
      can_set: true,
      seat_names: [],
      deadline: 'open',
      can_change_late: false,
    })
  })

  it('returns recorded courses and does not offer to set them again', async () => {
    expect(
      await read({ booking_type: 'christmas', booking_period_answer: true, christmas_course_counts: [3, 1, 1, 1] }),
    ).toMatchObject({ course_counts: [3, 1, 1, 1], can_set: false })
  })

  it('never offers courses on another kind of booking', async () => {
    expect(await read({ booking_type: 'regular', booking_period_answer: null, christmas_course_counts: null })).toEqual({
      course_counts: null,
      can_set: false,
      seat_names: [],
      deadline: 'none',
      can_change_late: false,
    })
  })

  // BK-054: staff pick who is leaving by name, and see whether the change is late (D21).
  it('names each seat the booker named, in seat order', async () => {
    state.covers = [{ ordinal: 2, guest_name: ' Dave ' }, { ordinal: 1, guest_name: null }]
    expect(
      await read({ booking_type: 'christmas', booking_period_answer: true, christmas_course_counts: [3, 2, 1, 1] }),
    ).toMatchObject({ seat_names: [null, 'Dave', null, null] })
  })

  it('says when the deadline has passed and whether this user may still change the party', async () => {
    state.policy = { multiple_courses_available: false }
    state.canManage = true
    expect(
      await read({ booking_type: 'christmas', booking_period_answer: true, christmas_course_counts: [1, 1, 1, 1] }),
    ).toMatchObject({ deadline: 'closed', can_change_late: true })
  })
})
