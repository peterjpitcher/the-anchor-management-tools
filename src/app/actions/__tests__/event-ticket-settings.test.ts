import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ allowed: vi.fn(), from: vi.fn(), audit: vi.fn(), update: vi.fn(), eventError: false, typesError: false, saveError: false, saveErrorMessage: '', currentMode: 'prepaid', activeBookings: [] as Array<{ seats: number; is_reminder_only: boolean }> }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) } })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }))
vi.mock('../rbac', () => ({ checkUserPermission: mocks.allowed }))
vi.mock('../audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { saveEventTicketSettings } from '../event-ticket-settings'

const input = { payment_mode: 'prepaid' as const, online_discount_type: 'fixed' as const, online_discount_value: 5, online_discount_ends_at: '2026-11-19T18:00:00.000Z', booking_questions: [], collect_guest_details: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.allowed.mockResolvedValue(true)
  mocks.eventError = mocks.typesError = mocks.saveError = false
  mocks.saveErrorMessage = ''
  mocks.currentMode = 'prepaid'
  mocks.activeBookings = []
  mocks.from.mockImplementation((table: string) => {
    if (table === 'events') return {
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'event', start_datetime: '2026-11-20T18:00:00Z', payment_mode: mocks.currentMode, online_discount_type: 'fixed', online_discount_value: 5, online_discount_ends_at: null, collect_guest_details: true }, error: mocks.eventError ? {} : null }) }) }),
      update: (values: unknown) => { mocks.update(values); return { eq: async () => ({ error: mocks.saveError ? { message: mocks.saveErrorMessage } : null }) } },
    }
    if (table === 'bookings') return { select: () => ({ eq: () => ({ in: async () => ({ data: mocks.activeBookings, error: null }) }) }) }
    return { select: () => ({ eq: () => ({ eq: async () => ({ data: [{ base_price: 45 }], error: mocks.typesError ? {} : null }) }) }) }
  })
})

describe('saveEventTicketSettings', () => {
  it('refuses unauthorised writes before querying event data', async () => {
    mocks.allowed.mockResolvedValue(false)
    expect(await saveEventTicketSettings('event', input)).toEqual({ error: 'You do not have permission to manage event tickets' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('fails closed if ticket price validation cannot run', async () => {
    mocks.typesError = true
    expect((await saveEventTicketSettings('event', input)).error).toContain('could not be checked')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('rejects a fixed discount that makes a paid ticket free', async () => {
    expect((await saveEventTicketSettings('event', { ...input, online_discount_value: 45 })).error).toContain('less than every paid ticket price')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('clears all discount fields explicitly', async () => {
    expect(await saveEventTicketSettings('event', { ...input, online_discount_type: null, online_discount_value: null })).toEqual({ success: true })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ online_discount_type: null, online_discount_value: null, online_discount_ends_at: null }))
  })
  it('reports database failures without claiming success', async () => {
    mocks.saveError = true
    expect((await saveEventTicketSettings('event', input)).error).toContain('could not be saved')
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('rejects a deadline after the event starts', async () => {
    expect((await saveEventTicketSettings('event', { ...input, online_discount_ends_at: '2026-11-21T18:00:00.000Z' })).error).toContain('by the event start time')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  // Owner decision D9 (BK-027, BK-036): once anyone has booked, the payment method is locked.
  it('refuses to change the payment method once the event has bookings', async () => {
    mocks.currentMode = 'cash_only'
    mocks.activeBookings = [{ seats: 2, is_reminder_only: false }]
    expect((await saveEventTicketSettings('event', input)).error).toContain('payment method is locked')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('lets the payment method change while only reminders exist', async () => {
    mocks.currentMode = 'cash_only'
    mocks.activeBookings = [{ seats: 0, is_reminder_only: true }]
    expect(await saveEventTicketSettings('event', input)).toEqual({ success: true })
  })
  it('shows the lock message when the database refuses the change', async () => {
    mocks.saveError = true
    mocks.saveErrorMessage = 'event_payment_mode_locked'
    expect((await saveEventTicketSettings('event', input)).error).toContain('payment method is locked')
  })
  // BK-139: the log records what changed.
  it('logs the before and after values of what changed', async () => {
    await saveEventTicketSettings('event', { ...input, online_discount_value: 8 })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      old_values: { online_discount_value: 5, online_discount_ends_at: null },
      new_values: { online_discount_value: 8, online_discount_ends_at: '2026-11-19T18:00:00.000Z' },
    }))
  })
})
