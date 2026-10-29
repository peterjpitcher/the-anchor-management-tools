import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Ticket type edits on a night that already has bookings (BK-036, BK-139, BK-143; owner decision
 * D9). A price change applies to new sales only and is confirmed first; taking the first ticket
 * off sale says what the headline price becomes; the database's payment method lock is explained.
 */

const state = vi.hoisted(() => ({
  existing: { event_id: 'event-1', name: 'Standard', base_price: 10, capacity: null as number | null, is_active: true, sort_order: 0, description: null },
  activeTypes: [{ id: 'standard', name: 'Standard', base_price: 10 }, { id: 'late', name: 'Late Entry', base_price: 12 }],
  bookings: [{ seats: 2, is_reminder_only: false }],
  soldOnType: [{ quantity: 3, booking: { is_reminder_only: false } }],
  updateError: null as { message: string } | null,
  updates: [] as Array<Record<string, unknown>>,
}))
const audit = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: audit }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/lib/events/ticket-types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/events/ticket-types')>()),
  eventTicketTypesEnabled: () => true,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'manager-1', email: 'peter@example.com' } }, error: null })) } })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let filteredActive = false
      let limited = false
      const builder: Record<string, unknown> = {}
      Object.assign(builder, {
        select: () => builder,
        eq: (column: string) => { if (column === 'is_active') filteredActive = true; return builder },
        in: () => builder,
        order: () => builder,
        limit: () => { limited = true; return builder },
        single: async () => (table === 'events'
          ? { data: { payment_mode: 'cash_only', online_discount_type: null, online_discount_value: null }, error: null }
          : { data: state.existing, error: null }),
        update: (values: Record<string, unknown>) => {
          state.updates.push(values)
          const write = { eq: () => write, select: () => write, single: async () => ({ data: state.updateError ? null : { id: 'standard', ...state.existing, ...values }, error: state.updateError }) }
          return write
        },
        then: (resolve: (value: unknown) => unknown) => {
          if (table === 'bookings') return resolve({ data: state.bookings, error: null })
          if (table === 'booking_items') return resolve({ data: state.soldOnType, error: null })
          if (table === 'event_ticket_types' && filteredActive) {
            return resolve({ data: limited ? state.activeTypes.slice(0, 2) : state.activeTypes, count: state.activeTypes.length, error: null })
          }
          return resolve({ data: [], count: 0, error: null })
        },
      })
      return builder
    },
  }),
}))

import { deleteEventTicketType, updateEventTicketType } from '@/app/actions/eventTicketTypes'

beforeEach(() => {
  vi.clearAllMocks()
  state.existing = { event_id: 'event-1', name: 'Standard', base_price: 10, capacity: null, is_active: true, sort_order: 0, description: null }
  state.activeTypes = [{ id: 'standard', name: 'Standard', base_price: 10 }, { id: 'late', name: 'Late Entry', base_price: 12 }]
  state.bookings = [{ seats: 2, is_reminder_only: false }]
  state.soldOnType = [{ quantity: 3, booking: { is_reminder_only: false } }]
  state.updateError = null
  state.updates = []
})

describe('ticket type changes on a booked night', () => {
  it('asks to confirm a price change and saves nothing until then', async () => {
    const result = await updateEventTicketType('standard', { base_price: 12 })
    expect(result).toEqual({
      error: 'Confirm this change before it is saved.',
      confirmation: { lines: ['1 booking already made keeps the price they booked at. The new price applies to new sales only.'] },
    })
    expect(state.updates).toEqual([])
  })

  it('saves the confirmed price change and logs the before and after price', async () => {
    const result = await updateEventTicketType('standard', { base_price: 12 }, { confirmed: true })
    expect(result.success).toBe(true)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      old_values: { base_price: 10 },
      new_values: { base_price: 12 },
      additional_info: expect.objectContaining({ changed_after_first_booking: true, confirmed_by_manager: true }),
    }))
  })

  it('does not ask when nobody has booked', async () => {
    state.bookings = []
    expect((await updateEventTicketType('standard', { base_price: 12 })).success).toBe(true)
  })

  it('says what the headline price becomes before the first ticket goes off sale (BK-143)', async () => {
    const result = await updateEventTicketType('standard', { is_active: false })
    expect(result.confirmation?.lines).toEqual([
      "This is the first ticket on sale, so the event's headline price becomes £12.00, the price of Late Entry. Guests already booked on Standard keep it.",
    ])
    expect(state.updates).toEqual([])
  })

  it('warns when a ticket limit falls below the tickets already sold', async () => {
    const result = await updateEventTicketType('standard', { capacity: 2 })
    expect(result.confirmation?.lines[0]).toContain('3 tickets are already sold on Standard, so a limit of 2 stops its sales')
  })

  it('explains the payment method lock when the price change would make a booked night free', async () => {
    state.updateError = { message: 'event_payment_mode_locked' }
    const result = await updateEventTicketType('standard', { base_price: 0, is_free_ticket: true }, { confirmed: true })
    expect(result.error).toContain('payment method is locked')
  })

  it('confirms before removing the first ticket on sale', async () => {
    const result = await deleteEventTicketType('standard')
    expect(result.confirmation?.lines[0]).toContain('headline price becomes £12.00')
    expect(state.updates).toEqual([])
  })
})
