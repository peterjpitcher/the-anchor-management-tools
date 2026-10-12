// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({ client: null as unknown, sessionUser: null as { id: string } | null }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.sessionUser } }) } }),
}))

import { getPortalPartyContext, getPortalWorker, listPortalSigningItems } from '@/lib/signing/portal'

const MINE = '11111111-1111-4111-8111-111111111111'
const THEIRS = '22222222-2222-4222-8222-222222222222'
const GUARDIAN = '33333333-3333-4333-8333-333333333333'

let db: FakeDb

beforeEach(() => {
  db = createFakeDb({
    employees: [
      { id: 'a', employee_id: 'emp-me', auth_user_id: 'user-me', status: 'Onboarding' },
      { id: 'b', employee_id: 'emp-other', auth_user_id: 'user-other', status: 'Active' },
      { id: 'c', employee_id: 'emp-left', auth_user_id: 'user-left', status: 'Former' },
    ],
    signing_documents: [
      { id: 'doc-1', title: 'Worker agreement', mode: 'sign', status: 'part_signed', sent_at: '2026-10-01T09:00:00.000Z', expires_at: '2026-10-31T09:00:00.000Z', completed_at: null },
      { id: 'doc-2', title: 'Their agreement', mode: 'sign', status: 'sent', sent_at: '2026-10-01T09:00:00.000Z', expires_at: '2026-10-31T09:00:00.000Z', completed_at: null },
    ],
    signing_parties: [
      { id: MINE, document_id: 'doc-1', role: 'worker', employee_id: 'emp-me', status: 'pending', created_at: '2026-10-01T09:00:00.000Z' },
      { id: THEIRS, document_id: 'doc-2', role: 'worker', employee_id: 'emp-other', status: 'pending', created_at: '2026-10-01T09:00:00.000Z' },
      // A guardian on my own agreement. Mine to see on the record, not mine to sign.
      { id: GUARDIAN, document_id: 'doc-1', role: 'guardian', employee_id: null, status: 'pending', created_at: '2026-10-01T09:00:01.000Z' },
    ],
  })
  mocks.client = db.client
  mocks.sessionUser = { id: 'user-me' }
})

describe('signing in the staff portal', () => {
  it('finds the signed-in worker, including a new starter, and nobody who has left', async () => {
    expect(await getPortalWorker()).toEqual({ userId: 'user-me', employeeId: 'emp-me' })
    mocks.sessionUser = { id: 'user-left' }
    expect(await getPortalWorker()).toBeNull()
    mocks.sessionUser = { id: 'user-with-no-record' }
    expect(await getPortalWorker()).toBeNull()
    mocks.sessionUser = null
    expect(await getPortalWorker()).toBeNull()
  })

  it('lists only the documents addressed to this worker', async () => {
    const items = await listPortalSigningItems('emp-me')
    expect(items.map((item) => item.document.title)).toEqual(['Worker agreement'])
    expect(await listPortalSigningItems('emp-nobody')).toEqual([])
  })

  it('answers another worker’s document, a guardian’s slot and a bad id all the same way', async () => {
    const me = { userId: 'user-me', employeeId: 'emp-me' }
    expect((await getPortalPartyContext(me, MINE))?.party.id).toBe(MINE)
    expect(await getPortalPartyContext(me, THEIRS)).toBeNull()
    expect(await getPortalPartyContext(me, GUARDIAN)).toBeNull()
    expect(await getPortalPartyContext(me, '44444444-4444-4444-8444-444444444444')).toBeNull()
    expect(await getPortalPartyContext(me, "x' or 1=1")).toBeNull()
  })
})
