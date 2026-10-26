import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Owner decision D24 (24 October 2026): a hire is confirmed only when its rooms hold its guests,
 * and a manager can override the capacity, with the override audited. The override is the
 * `capacity_override` row on the booking's audit trail, with the number allowed, the rooms and
 * layout it was given for, and the manager's reason. Only gm_override (the manager and
 * super_admin roles) may give it.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { allowPrivateBookingOverCapacity } from '@/app/actions/privateBookingWorkflow'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'
const DINING = { id: 'space-dining', name: 'The Dining Room', capacity_seated: 26, capacity_standing: 50, blocks_all_spaces: false, active: true, display_order: 1 }

function signIn(): void {
  ;(createClient as unknown as Mock).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'manager-1' } } }) },
  })
}

function grant(...allowed: string[]): void {
  ;(checkUserPermission as unknown as Mock).mockImplementation(async (_module: string, action: string) => allowed.includes(action))
}

function seed(booking: Record<string, unknown> = {}, items = [{ id: 'i1', booking_id: BOOKING_ID, item_type: 'space', space_id: DINING.id }]): void {
  state.db = createFakeSupabase({
    private_bookings: [{ id: BOOKING_ID, status: 'draft', guest_count: 70, layout: null, ...booking }],
    private_booking_items: items,
    venue_spaces: [DINING],
    private_booking_audit: [],
  })
}

const REASON = 'Standing reception, the garden is open as well'

describe('allowing more guests than the rooms hold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signIn()
    grant('gm_override')
    seed()
  })

  it('records the override with the number, rooms, layout and reason, and audits it', async () => {
    const result = await allowPrivateBookingOverCapacity({ bookingId: BOOKING_ID, maxGuests: '70', reason: REASON })

    expect(result).toEqual({ success: true })
    expect(state.db.tables.private_booking_audit).toEqual([
      expect.objectContaining({
        booking_id: BOOKING_ID,
        action: 'capacity_override',
        performed_by: 'manager-1',
        metadata: expect.objectContaining({ max_guests: 70, space_ids: [DINING.id], layout: null, room_capacity: 50, reason: REASON }),
      }),
    ])
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_id: BOOKING_ID,
        additional_info: expect.objectContaining({ action: 'capacity_override', max_guests: 70, reason: REASON }),
      })
    )
  })

  it('is for managers only', async () => {
    grant('edit', 'manage_deposits')

    const result = await allowPrivateBookingOverCapacity({ bookingId: BOOKING_ID, maxGuests: 70, reason: REASON })

    expect(result.error).toBe('Only a manager can allow more guests than the rooms hold.')
    expect(state.db.tables.private_booking_audit).toHaveLength(0)
  })

  it('needs a reason', async () => {
    const result = await allowPrivateBookingOverCapacity({ bookingId: BOOKING_ID, maxGuests: 70, reason: 'ok' })

    expect(result.error).toBe('Say why the guests fit (at least 10 characters).')
    expect(state.db.tables.private_booking_audit).toHaveLength(0)
  })

  it('needs a room to give it for', async () => {
    seed({}, [])

    const result = await allowPrivateBookingOverCapacity({ bookingId: BOOKING_ID, maxGuests: 70, reason: REASON })

    expect(result.error).toContain('Add the room the party will use first')
  })

  it('has nothing to allow when the rooms already hold that many', async () => {
    const result = await allowPrivateBookingOverCapacity({ bookingId: BOOKING_ID, maxGuests: 50, reason: REASON })

    expect(result.error).toBe('The rooms already hold 50 guests, so there is nothing to allow. Enter a number above 50.')
  })

  it('allows nothing when the audit row cannot be written', async () => {
    state.db.failures.push({ table: 'private_booking_audit', op: 'insert', error: { message: 'insert failed' } })

    const result = await allowPrivateBookingOverCapacity({ bookingId: BOOKING_ID, maxGuests: 70, reason: REASON })

    expect(result.error).toContain('Could not record the override')
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})
