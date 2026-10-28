import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * BK-014 and owner decision D4: one setting on each event says whether every ticket needs a name
 * and the event's answers. Ticket settings saves it, refuses questions nobody would be asked, and
 * puts a free event back on the default.
 */

const state = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>>, allowed: true, price: 45, previousQuestions: [] as unknown[], liveBookings: 0 }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => state.allowed) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'manager-1', email: 'manager@example.com' } }, error: null })) },
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        in: () => builder,
        single: async () => ({ data: { id: 'event-1', start_datetime: '2099-11-20T19:00:00Z', date: '2099-11-20', time: '19:00', booking_questions: state.previousQuestions }, error: null }),
        update: (values: Record<string, unknown>) => {
          state.updates.push(values)
          return { eq: async () => ({ error: null }) }
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve(table === 'bookings'
            ? { data: null, count: state.liveBookings, error: null }
            : { data: table === 'event_ticket_types' ? [{ base_price: state.price }] : [], error: null }),
      }
      return builder
    },
  }),
}))

import { saveEventTicketSettings } from '@/app/actions/event-ticket-settings'

const QUESTION = { id: '55555555-5555-4555-8555-555555555555', label: 'Any allergies?', type: 'text' as const, required: true }
const base = {
  online_discount_type: null,
  online_discount_value: null,
  online_discount_ends_at: null,
}

beforeEach(() => {
  state.updates = []
  state.allowed = true
  state.price = 45
  state.previousQuestions = []
  state.liveBookings = 0
})

describe('saveEventTicketSettings guest details switch', () => {
  it('saves a pay-on-arrival event switched on to ask every guest', async () => {
    const result = await saveEventTicketSettings('event-1', { ...base, payment_mode: 'cash_only', booking_questions: [QUESTION], collect_guest_details: true })
    expect(result).toEqual({ success: true })
    expect(state.updates[0]).toMatchObject({ payment_mode: 'cash_only', collect_guest_details: true, booking_questions: [QUESTION] })
  })

  it('saves a prepaid event switched off', async () => {
    const result = await saveEventTicketSettings('event-1', { ...base, payment_mode: 'prepaid', booking_questions: [], collect_guest_details: false })
    expect(result).toEqual({ success: true })
    expect(state.updates[0]).toMatchObject({ collect_guest_details: false })
  })

  it('refuses questions that nobody would be asked because guest details are off', async () => {
    const result = await saveEventTicketSettings('event-1', { ...base, payment_mode: 'prepaid', booking_questions: [QUESTION], collect_guest_details: false })
    expect(result.error).toBe('Guest questions are asked of each guest. Switch on guest details, or remove the questions.')
    expect(state.updates).toEqual([])
  })

  it('puts a free event back on the default, so it asks nothing and follows the payment method if it is ever paid', async () => {
    state.price = 0
    const result = await saveEventTicketSettings('event-1', { ...base, payment_mode: 'free', booking_questions: [QUESTION], collect_guest_details: true })
    expect(result).toEqual({ success: true })
    expect(state.updates[0]).toMatchObject({ payment_mode: 'free', collect_guest_details: null, booking_questions: [] })
  })

  // BK-016: a question added now is not asked of anyone already booked.
  it('warns how many bookings were made before a new question', async () => {
    state.liveBookings = 3
    const result = await saveEventTicketSettings('event-1', { ...base, payment_mode: 'prepaid', booking_questions: [QUESTION], collect_guest_details: true })
    expect(result).toEqual({
      success: true,
      warning: "Saved. 3 bookings were made before this question, so those guests have not been asked. Add their answers from each booking's guest details.",
    })
  })

  it('does not warn when the question was already there', async () => {
    state.liveBookings = 3
    state.previousQuestions = [QUESTION]
    expect(await saveEventTicketSettings('event-1', { ...base, payment_mode: 'prepaid', booking_questions: [QUESTION], collect_guest_details: true })).toEqual({ success: true })
  })
})
