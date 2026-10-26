import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(async () => ({
    ok: true,
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) }),
      }),
    },
  })),
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

// BK-057: the party-size dialogs offer to record courses once on a Christmas booking with none.
describe('GET /api/foh/bookings/[id]/christmas-courses', () => {
  it('lets a Christmas booking with no courses have them set', async () => {
    expect(await read({ booking_type: 'christmas', booking_period_answer: true, christmas_course_counts: null })).toEqual({
      course_counts: null,
      can_set: true,
    })
  })

  it('returns recorded courses and does not offer to set them again', async () => {
    expect(
      await read({ booking_type: 'christmas', booking_period_answer: true, christmas_course_counts: [3, 1, 1, 1] }),
    ).toEqual({ course_counts: [3, 1, 1, 1], can_set: false })
  })

  it('never offers courses on another kind of booking', async () => {
    expect(await read({ booking_type: 'regular', booking_period_answer: null, christmas_course_counts: null })).toEqual({
      course_counts: null,
      can_set: false,
    })
  })
})
