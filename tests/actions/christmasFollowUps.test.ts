import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Mark called" on the Christmas follow-ups tab (Christmas funnel spec, owner decision 7): needs
 * table_bookings edit, records who rang and the note, writes an audit row with ids only.
 */

const state = vi.hoisted(() => ({ granted: new Set<string>(), user: { id: 'user-1', email: 'staff@example.com' } as null | { id: string; email: string } }))
const { logAuditEvent, revalidatePath, logError } = vi.hoisted(() => ({ logAuditEvent: vi.fn(), revalidatePath: vi.fn(), logError: vi.fn() }))
const db = vi.hoisted(() => ({ current: null as null | { client: unknown } }))

vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent }))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async (module: string, action: string) => state.granted.has(`${module}:${action}`)),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db.current?.client }))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }))

import { leadsDb } from '../helpers/christmasLeadsDb'
import { markChristmasLeadCalled } from '@/app/actions/christmas-follow-ups'

const LEAD_ID = '5d8e7f60-1a2b-4c3d-8e9f-0a1b2c3d4e5f'

beforeEach(() => {
  vi.clearAllMocks()
  state.granted = new Set(['table_bookings:view', 'table_bookings:edit'])
  state.user = { id: 'user-1', email: 'staff@example.com' }
  db.current = leadsDb({ table_booking_leads: [{ id: LEAD_ID, source: 'website', called_at: null, called_by: null, call_note: null }] })
})

function lead() {
  return (db.current as ReturnType<typeof leadsDb>).fake.rows('table_booking_leads')[0]
}

describe('markChristmasLeadCalled', () => {
  it('records who rang, when, and the note, with an audit row that names no guest', async () => {
    const result = await markChristmasLeadCalled({ leadId: LEAD_ID, note: '  Rebooking by phone  ' })

    expect(result).toEqual({ success: true })
    expect(lead()).toEqual(expect.objectContaining({ called_by: 'user-1', call_note: 'Rebooking by phone' }))
    expect(typeof lead().called_at).toBe('string')
    expect(logAuditEvent).toHaveBeenCalledWith({
      user_id: 'user-1',
      user_email: 'staff@example.com',
      operation_type: 'christmas_lead.called',
      resource_type: 'table_booking_lead',
      resource_id: LEAD_ID,
      operation_status: 'success',
      additional_info: { has_note: true },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/table-bookings/christmas-follow-ups')
  })

  it('saves no note when none is given', async () => {
    await markChristmasLeadCalled({ leadId: LEAD_ID })

    expect(lead().call_note).toBeNull()
  })

  it('refuses a login with view but not edit, and writes nothing', async () => {
    state.granted = new Set(['table_bookings:view'])

    const result = await markChristmasLeadCalled({ leadId: LEAD_ID })

    expect(result).toEqual({ error: 'You do not have permission to update Christmas follow-ups.' })
    expect(lead().called_at).toBeNull()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('refuses a lead id that is not a uuid, and a note over 500 characters', async () => {
    expect((await markChristmasLeadCalled({ leadId: 'nope' })).error).toBeTruthy()
    expect(await markChristmasLeadCalled({ leadId: LEAD_ID, note: 'x'.repeat(501) })).toEqual({ error: 'Keep the note under 500 characters.' })
    expect(lead().called_at).toBeNull()
  })

  it('answers Unauthorized with no signed-in user', async () => {
    state.user = null

    expect(await markChristmasLeadCalled({ leadId: LEAD_ID })).toEqual({ error: 'Unauthorized' })
  })

  it('says the follow-up has gone when the lead no longer exists', async () => {
    expect(await markChristmasLeadCalled({ leadId: '00000000-0000-4000-8000-000000000000' })).toEqual({ error: 'That follow-up no longer exists.' })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('says it was not saved, and logs it, when the database cannot be written', async () => {
    ;(db.current as ReturnType<typeof leadsDb>).fake.failNext({ table: 'table_booking_leads', operation: 'update', message: 'deadlock' })

    expect(await markChristmasLeadCalled({ leadId: LEAD_ID })).toEqual({ error: 'That was not saved. Try again.' })
    expect(logError).toHaveBeenCalledTimes(1)
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})
