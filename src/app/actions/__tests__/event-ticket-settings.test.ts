import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ allowed: vi.fn(), from: vi.fn(), audit: vi.fn(), update: vi.fn(), eventError: false, typesError: false, saveError: false }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) } })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }))
vi.mock('../rbac', () => ({ checkUserPermission: mocks.allowed }))
vi.mock('../audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { saveEventTicketSettings } from '../event-ticket-settings'

const input = { payment_mode: 'prepaid' as const, online_discount_type: 'fixed' as const, online_discount_value: 5, online_discount_ends_at: '2026-11-19T18:00:00.000Z', booking_questions: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.allowed.mockResolvedValue(true)
  mocks.eventError = mocks.typesError = mocks.saveError = false
  mocks.from.mockImplementation((table: string) => {
    if (table === 'events') return {
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'event', start_datetime: '2026-11-20T18:00:00Z' }, error: mocks.eventError ? {} : null }) }) }),
      update: (values: unknown) => { mocks.update(values); return { eq: async () => ({ error: mocks.saveError ? {} : null }) } },
    }
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
})
