import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ allowed: true, update: vi.fn(), audit: vi.fn(), saved: true }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'staff' } } }) } }) }))
vi.mock('../rbac', () => ({ checkUserPermission: async () => mock.allowed }))
vi.mock('../audit', () => ({ logAuditEvent: mock.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const bookingId = '11111111-1111-4111-8111-111111111111'
const guestId = '22222222-2222-4222-8222-222222222222'
const questionId = '33333333-3333-4333-8333-333333333333'
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => {
  let updating = false
  const chain = {
    select: () => chain, eq: () => chain,
    update: (input: unknown) => { updating = true; mock.update(input); return chain },
    maybeSingle: async () => ({ error: null, data: updating ? (mock.saved ? { id: bookingId } : null) : {
      id: bookingId, event_id: 'event', seats: 1, updated_at: '2026-09-10T00:00:00Z',
      attendees: [{ id: guestId, name: 'Guest', ticket_type_id: null, answers: [{ question_id: questionId, label: 'Meal', type: 'choice', required: true, options: ['A', 'B'], value: 'A' }] }],
    } }),
  }; return chain
} }) }))
import { updateEventAttendees } from '../event-attendees'
const input = (value: string) => ({ bookingId, attendees: [{ id: guestId, name: 'Changed', answers: { [questionId]: value } }] })
beforeEach(() => { vi.clearAllMocks(); mock.allowed = true; mock.saved = true })
describe('staff guest answer editing', () => {
  it('refuses unauthorised changes', async () => {
    mock.allowed = false
    expect((await updateEventAttendees(input('B'))).error).toContain('permission')
    expect(mock.update).not.toHaveBeenCalled()
  })
  it('cannot erase a required answer', async () => {
    expect((await updateEventAttendees(input(''))).error).toContain('required')
    expect(mock.update).not.toHaveBeenCalled()
  })
  it('validates choices against the question snapshot', async () => {
    expect((await updateEventAttendees(input('C'))).error).toContain('available')
    expect(mock.update).not.toHaveBeenCalled()
  })
  it('preserves question wording and excludes answers from the audit record', async () => {
    expect(await updateEventAttendees(input('B'))).toEqual({ success: true })
    expect(mock.update.mock.calls[0][0].attendees[0].answers[0]).toEqual(expect.objectContaining({ label: 'Meal', value: 'B', required: true }))
    // BK-133: which guest and which question changed, by id, never the answer itself.
    expect(mock.audit.mock.calls[0][0].additional_info).toEqual({
      field: 'guest_details',
      guest_count: 1,
      changed_guest_ids: ['22222222-2222-4222-8222-222222222222'],
      changed_question_ids: ['33333333-3333-4333-8333-333333333333'],
    })
    expect(JSON.stringify(mock.audit.mock.calls[0][0].additional_info)).not.toContain('"B"')
  })
  it('reports concurrent changes without claiming a save', async () => {
    mock.saved = false
    expect((await updateEventAttendees(input('B'))).error).toContain('Someone else')
    expect(mock.audit).not.toHaveBeenCalled()
  })
  it('stores a guest mobile in E.164 on that guest, and keeps it out of the audit record (BK-013)', async () => {
    const result = await updateEventAttendees({ bookingId, attendees: [{ id: guestId, name: 'Changed', phone: '07700 900123', answers: { [questionId]: 'B' } }] })
    expect(result).toEqual({ success: true })
    expect(mock.update.mock.calls[0][0].attendees[0].phone).toBe('+447700900123')
    expect(JSON.stringify(mock.audit.mock.calls[0][0])).not.toContain('900123')
  })
  it('refuses a guest mobile that is not a phone number', async () => {
    const result = await updateEventAttendees({ bookingId, attendees: [{ id: guestId, name: 'Changed', phone: '12', answers: { [questionId]: 'B' } }] })
    expect(result.error).toContain('mobile')
    expect(mock.update).not.toHaveBeenCalled()
  })
  it('removes a stored mobile when it is cleared', async () => {
    await updateEventAttendees({ bookingId, attendees: [{ id: guestId, name: 'Changed', phone: '', answers: { [questionId]: 'B' } }] })
    expect(mock.update.mock.calls[0][0].attendees[0]).not.toHaveProperty('phone')
  })
})
