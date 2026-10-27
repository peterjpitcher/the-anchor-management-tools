import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Owner decision D29 (review BK-072): food at private hires and events reduces the kitchen slots on
 * sale online that night, one cover per guest who eats unless staff set otherwise. Staff set the
 * number and the food time on the hire or the event; it is recorded on the audit trail.
 */

const state = vi.hoisted(() => ({ db: null as any, permissions: new Set<string>() }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: '00000000-0000-0000-0000-0000000000aa', email: 'manager@example.com' } } })) },
  })),
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async (module: string, action: string) => state.permissions.has(`${module}:${action}`)),
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setEventKitchenLoad, setPrivateBookingKitchenLoad } from '@/app/actions/kitchen-load'
import { loadKitchenLoadFor, parseKitchenSettings } from '@/services/kitchen-load'
import { logAuditEvent } from '@/app/actions/audit'

const HIRE = '11111111-1111-4111-8111-111111111111'
const EVENT = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  state.permissions = new Set(['private_bookings:edit', 'events:manage'])
  state.db = createFakeSupabase({
    private_bookings: [{ id: HIRE, status: 'confirmed', kitchen_covers: null, kitchen_food_time: null }],
    private_booking_audit: [],
    events: [{ id: EVENT, food_served: false, kitchen_covers: null, kitchen_food_time: null }],
  })
})

describe('the kitchen settings a member of staff types', () => {
  it('turns blanks into automatic and checks the rest', () => {
    expect(parseKitchenSettings({ covers: ' ', foodTime: '' })).toEqual({ ok: true, covers: null, foodTime: null })
    expect(parseKitchenSettings({ covers: '0', foodTime: '19:30' })).toEqual({ ok: true, covers: 0, foodTime: '19:30' })
    expect(parseKitchenSettings({ covers: '40', foodTime: '20:15:00' })).toEqual({ ok: true, covers: 40, foodTime: '20:15' })
    expect(parseKitchenSettings({ covers: '-1' })).toMatchObject({ ok: false })
    expect(parseKitchenSettings({ covers: '12.5' })).toMatchObject({ ok: false })
    expect(parseKitchenSettings({ covers: '1001' })).toMatchObject({ ok: false, error: 'Kitchen covers cannot be more than 1000.' })
    expect(parseKitchenSettings({ foodTime: '25:00' })).toMatchObject({ ok: false })
  })
})

describe('setting a hire\'s kitchen covers', () => {
  it('saves the number and the time, and records the change', async () => {
    const result = await setPrivateBookingKitchenLoad(HIRE, { covers: '30', foodTime: '20:00' })

    expect(result).toEqual({ success: true })
    expect(state.db.tables.private_bookings[0]).toMatchObject({ kitchen_covers: 30, kitchen_food_time: '20:00' })
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({
      booking_id: HIRE, action: 'kitchen_load_changed', old_value: 'automatic', new_value: '30',
      metadata: { before: { covers: null, food_time: null }, after: { covers: 30, food_time: '20:00' } },
    })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ resource_type: 'private_booking', resource_id: HIRE }))
  })

  it('goes back to automatic when both are cleared', async () => {
    state.db.tables.private_bookings[0].kitchen_covers = 12
    await setPrivateBookingKitchenLoad(HIRE, { covers: '', foodTime: '' })
    expect(state.db.tables.private_bookings[0]).toMatchObject({ kitchen_covers: null, kitchen_food_time: null })
  })

  it('refuses without permission, on bad input, and on a booking that is over', async () => {
    state.permissions = new Set()
    expect(await setPrivateBookingKitchenLoad(HIRE, { covers: '30' })).toEqual({ error: 'You do not have permission to change private bookings' })

    state.permissions = new Set(['private_bookings:manage'])
    expect(await setPrivateBookingKitchenLoad(HIRE, { covers: 'lots' })).toMatchObject({ error: expect.stringContaining('whole number') })
    expect(await setPrivateBookingKitchenLoad('not-a-uuid', { covers: '3' })).toEqual({ error: 'Booking not found' })

    state.db.tables.private_bookings[0].status = 'cancelled'
    expect(await setPrivateBookingKitchenLoad(HIRE, { covers: '3' })).toEqual({ error: 'Kitchen covers can only be changed on a draft or confirmed booking.' })
    expect(state.db.tables.private_bookings[0].kitchen_covers).toBeNull()
  })

  it('says nothing was saved when the booking cannot be read', async () => {
    state.db.failures.push({ table: 'private_bookings', op: 'select', error: { message: 'timeout' } })
    expect(await setPrivateBookingKitchenLoad(HIRE, { covers: '3' })).toEqual({ error: 'Nothing was saved: the booking could not be read. Please try again.' })
  })
})

describe('setting an event\'s kitchen covers', () => {
  it('saves food served, the number and the time', async () => {
    expect(await setEventKitchenLoad(EVENT, { foodServed: true, covers: '', foodTime: '18:30' })).toEqual({ success: true })
    expect(state.db.tables.events[0]).toMatchObject({ food_served: true, kitchen_covers: null, kitchen_food_time: '18:30' })
  })

  it('clears the number and time when guests do not eat, so the two always agree', async () => {
    state.db.tables.events[0] = { id: EVENT, food_served: true, kitchen_covers: 20, kitchen_food_time: '19:00' }
    await setEventKitchenLoad(EVENT, { foodServed: false, covers: '20', foodTime: '19:00' })
    expect(state.db.tables.events[0]).toMatchObject({ food_served: false, kitchen_covers: null, kitchen_food_time: null })
  })

  it('needs the events manage permission', async () => {
    state.permissions = new Set(['events:view'])
    expect(await setEventKitchenLoad(EVENT, { foodServed: true })).toEqual({ error: 'Insufficient permissions to update events' })
  })
})

describe('what the kitchen counts for one hire or event', () => {
  it('reads the database list and picks the one asked for', async () => {
    state.db.rpc = vi.fn(async () => ({
      data: [
        { source_kind: 'private_booking', source_id: HIRE, food_date: '2026-11-07', food_time: '19:30:00', covers: 30 },
        { source_kind: 'event', source_id: EVENT, food_date: '2026-11-07', food_time: '19:00:00', covers: 6 },
      ],
      error: null,
    }))
    await expect(loadKitchenLoadFor('private_booking', HIRE, '2026-11-07')).resolves.toEqual({
      sourceKind: 'private_booking', sourceId: HIRE, date: '2026-11-07', foodTime: '19:30', covers: 30,
    })
    await expect(loadKitchenLoadFor('event', 'other', '2026-11-07')).resolves.toBeNull()
    await expect(loadKitchenLoadFor('event', EVENT, null)).resolves.toBeNull()

    state.db.rpc = vi.fn(async () => ({ data: null, error: { message: 'timeout' } }))
    await expect(loadKitchenLoadFor('event', EVENT, '2026-11-07')).rejects.toThrow('Could not read the kitchen covers')
  })
})
