import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * BK-016: a phone, bar or kiosk booking has no guest rows, and the staff editor used to refuse it
 * ("The guest list has changed") so its guests could never be given answers.
 */

const BOOKING = '11111111-1111-4111-8111-111111111111'
const QUESTION = { id: '22222222-2222-4222-8222-222222222222', label: 'Any allergies?', type: 'text', required: true }
const TICKET = '33333333-3333-4333-8333-333333333333'
const GUEST_A = '44444444-4444-4444-8444-444444444441'
const GUEST_B = '44444444-4444-4444-8444-444444444442'

const state = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>>, audit: [] as Array<Record<string, unknown>> }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async (entry: Record<string, unknown>) => { state.audit.push(entry) }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'staff-1' } } }) } }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let updating: Record<string, unknown> | null = null
      const rows = (): unknown => {
        if (table === 'bookings') return { id: BOOKING, event_id: 'event-1', seats: 2, status: 'confirmed', is_reminder_only: false, attendees: [], updated_at: '2026-10-20T10:00:00Z', event: { booking_questions: [QUESTION] } }
        if (table === 'booking_items') return [{ id: 'item', booking_id: BOOKING, ticket_type_id: TICKET, quantity: 2, unit_price: 40, attendee_names: [] }]
        return null
      }
      const builder: Record<string, unknown> = {
        select: () => builder, eq: () => builder, order: () => builder, limit: () => builder,
        update: (values: Record<string, unknown>) => { updating = values; state.updates.push(values); return builder },
        maybeSingle: async () => ({ data: updating ? { id: BOOKING } : rows(), error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }),
      }
      return builder
    },
  }),
}))

import { updateEventAttendees } from '@/app/actions/event-attendees'

beforeEach(() => {
  state.updates = []
  state.audit = []
})

describe('adding guest details to a booking that has none', () => {
  it('creates a guest per ticket with the event\'s questions and the booking\'s ticket type', async () => {
    const result = await updateEventAttendees({
      bookingId: BOOKING,
      attendees: [
        { id: GUEST_A, name: 'Ann Guest', answers: { [QUESTION.id]: 'Peanuts' } },
        { id: GUEST_B, name: 'Bo Guest', answers: {} },
      ],
    })
    expect(result).toEqual({ success: true })
    const saved = state.updates[0].attendees as Array<{ id: string; name: string; ticket_type_id: string; answers: Array<{ label: string; value: string }> }>
    expect(saved.map((guest) => [guest.id, guest.name, guest.ticket_type_id])).toEqual([[GUEST_A, 'Ann Guest', TICKET], [GUEST_B, 'Bo Guest', TICKET]])
    expect(saved[0].answers).toEqual([expect.objectContaining({ label: 'Any allergies?', value: 'Peanuts', required: true })])
  })

  it('records the change with counts only', async () => {
    await updateEventAttendees({
      bookingId: BOOKING,
      attendees: [
        { id: GUEST_A, name: 'Ann Guest', answers: { [QUESTION.id]: 'Peanuts' } },
        { id: GUEST_B, name: 'Bo Guest', answers: {} },
      ],
    })
    expect(state.audit[0]).toMatchObject({ resource_type: 'event_booking', resource_id: BOOKING, additional_info: { field: 'guest_details', guest_count: 2, created: true } })
    expect(JSON.stringify(state.audit)).not.toMatch(/Peanuts|Ann Guest/)
  })
})
