// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({ client: null as unknown, sessionUser: null as { id: string } | null }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.sessionUser } }) } }),
}))

import { getPortalWorker, getPortalWorkerName } from '@/lib/portal/worker'
import { getPortalWorker as getPortalWorkerFromSigning } from '@/lib/signing/portal'

let db: FakeDb

beforeEach(() => {
  db = createFakeDb({
    employees: [
      { id: 'a', employee_id: 'emp-me', auth_user_id: 'user-me', status: 'Active', first_name: ' Jo ', last_name: 'Bloggs' },
      { id: 'b', employee_id: 'emp-new', auth_user_id: 'user-new', status: 'Onboarding', first_name: 'Sam', last_name: null },
      { id: 'c', employee_id: 'emp-going', auth_user_id: 'user-going', status: 'Started Separation', first_name: null, last_name: null },
      { id: 'd', employee_id: 'emp-left', auth_user_id: 'user-left', status: 'Former', first_name: 'Al', last_name: 'Gone' },
    ],
  })
  mocks.client = db.client
  mocks.sessionUser = { id: 'user-me' }
})

describe('the shared portal worker', () => {
  it('admits Onboarding, Active and Started Separation, and nobody else', async () => {
    expect(await getPortalWorker()).toEqual({ userId: 'user-me', employeeId: 'emp-me' })
    mocks.sessionUser = { id: 'user-new' }
    expect(await getPortalWorker()).toEqual({ userId: 'user-new', employeeId: 'emp-new' })
    mocks.sessionUser = { id: 'user-going' }
    expect(await getPortalWorker()).toEqual({ userId: 'user-going', employeeId: 'emp-going' })
    mocks.sessionUser = { id: 'user-left' }
    expect(await getPortalWorker()).toBeNull()
    mocks.sessionUser = null
    expect(await getPortalWorker()).toBeNull()
  })

  it('throws on a read error rather than answering "not linked"', async () => {
    db.failNext({ table: 'employees', operation: 'select', message: 'connection reset' })
    await expect(getPortalWorker()).rejects.toThrow(/Could not read your employee record/)
  })

  it('is the same function the signing portal re-exports', () => {
    expect(getPortalWorkerFromSigning).toBe(getPortalWorker)
  })

  it('gives the name as a record snapshot, or null when there is none', async () => {
    expect(await getPortalWorkerName('emp-me')).toBe('Jo Bloggs')
    expect(await getPortalWorkerName('emp-new')).toBe('Sam')
    expect(await getPortalWorkerName('emp-going')).toBeNull()
    expect(await getPortalWorkerName('emp-nobody')).toBeNull()
  })
})
