import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Deposit deductions take money off what a customer gets back, so the controls that
 * matter are the separation of duties and the one-way door.
 *
 * SOP 25 splits the job deliberately: staff with `manage_deposits` propose a deduction
 * with evidence, and only the General Manager, who holds `gm_override`, decides it.
 * These tests pin that split, so a single permission can never both raise and approve a
 * deduction. They also pin that an already-applied deduction cannot be re-decided: the
 * money has gone back through the refund flow by then, and re-deciding it would either
 * double-count the deduction or silently reverse a completed refund.
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import {
  proposeDeduction,
  decideDeduction,
  lockBookingRecord,
} from '@/app/actions/privateBookingWorkflow'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'

const mockedCreateClient = createClient as unknown as Mock
const mockedAdmin = createAdminClient as unknown as Mock
const mockedPermission = checkUserPermission as unknown as Mock

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'
const DEDUCTION_ID = '22222222-2222-4222-8222-222222222222'

const DEDUCTION = {
  id: DEDUCTION_ID,
  booking_id: BOOKING_ID,
  amount: 50,
  reason: 'Broken glassware',
  evidence_document_id: null,
  customer_discussion_note: null,
  status: 'discussed',
  approved_by: null,
  approved_at: null,
  created_by: 'user-1',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
}

let updates: any[]

function setAuth(signedIn: boolean) {
  mockedCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: signedIn ? { id: 'user-1' } : null },
      }),
    },
  })
}

/**
 * Grants only the named permissions, so a test can hold `manage_deposits` without
 * `gm_override` and prove the split is real.
 */
function grant(...allowed: string[]) {
  mockedPermission.mockImplementation(async (_module: string, action: string) =>
    allowed.includes(action)
  )
}

function setAdmin(opts: { deduction?: any; booking?: any; insertError?: any } = {}) {
  updates = []

  function chain(table: string): any {
    const p: any = {}
    for (const m of ['select', 'eq', 'order']) p[m] = vi.fn(() => p)
    p.insert = vi.fn(() => p)
    p.update = vi.fn((payload: any) => { updates.push({ table, payload }); return p })
    p.single = vi.fn(() => {
      if (table === 'private_bookings') {
        return Promise.resolve({ data: opts.booking ?? { id: BOOKING_ID, locked_at: null, locked_reason: null }, error: null })
      }
      if (opts.insertError) return Promise.resolve({ data: null, error: opts.insertError })
      return Promise.resolve({ data: opts.deduction ?? DEDUCTION, error: null })
    })
    p.then = (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej)
    return p
  }

  mockedAdmin.mockReturnValue({ from: vi.fn((t: string) => chain(t)) })
}

beforeEach(() => {
  vi.clearAllMocks()
  setAuth(true)
  grant('manage_deposits', 'gm_override')
  setAdmin()
})

describe('proposeDeduction', () => {
  const input = { bookingId: BOOKING_ID, amount: 50, reason: 'Broken glassware' }

  it('refuses a caller without manage_deposits', async () => {
    grant('gm_override')

    const result = await proposeDeduction(input)

    expect(result.error).toMatch(/permission to propose deposit deductions/i)
  })

  it('refuses an unauthenticated caller', async () => {
    setAuth(false)

    const result = await proposeDeduction(input)

    expect(result).toEqual({ error: 'Not authenticated' })
  })

  it('refuses a zero or negative amount', async () => {
    for (const amount of [0, -25]) {
      const result = await proposeDeduction({ ...input, amount })
      expect(result.error).toMatch(/greater than zero/i)
    }
  })

  it('refuses a deduction with no reason, because the reason is the evidence', async () => {
    const result = await proposeDeduction({ ...input, reason: '   ' })

    expect(result.error).toMatch(/reason is required/i)
  })

  it('records a valid proposal as proposed, not approved', async () => {
    setAdmin({ deduction: { ...DEDUCTION, status: 'proposed' } })

    const result = await proposeDeduction(input)

    expect(result.success).toBe(true)
    // Proposing must never be self-approving.
    expect(result.data?.status).toBe('proposed')
  })
})

describe('decideDeduction: separation of duties', () => {
  it('refuses someone who can propose deductions but is not the GM', async () => {
    // The whole point of SOP 25: the person who raises it cannot be the person who
    // signs it off.
    grant('manage_deposits')

    const result = await decideDeduction(DEDUCTION_ID, 'approved')

    expect(result.error).toMatch(/only the general manager/i)
    expect(updates).toHaveLength(0)
  })

  it('allows the GM to approve', async () => {
    grant('gm_override')
    setAdmin({ deduction: { ...DEDUCTION, status: 'approved' } })

    const result = await decideDeduction(DEDUCTION_ID, 'approved')

    expect(result.success).toBe(true)
    expect(updates[0].payload).toMatchObject({ status: 'approved', approved_by: 'user-1' })
  })

  it('allows the GM to reject', async () => {
    grant('gm_override')
    setAdmin({ deduction: { ...DEDUCTION, status: 'rejected' } })

    const result = await decideDeduction(DEDUCTION_ID, 'rejected')

    expect(result.success).toBe(true)
    expect(updates[0].payload).toMatchObject({ status: 'rejected' })
  })

  it('refuses an unauthenticated caller', async () => {
    setAuth(false)

    const result = await decideDeduction(DEDUCTION_ID, 'approved')

    expect(result).toEqual({ error: 'Not authenticated' })
  })
})

describe('decideDeduction: the one-way door', () => {
  it('refuses to re-decide a deduction that has already been applied', async () => {
    // By this point the money has gone back through the refund flow. Re-deciding
    // would either double-count the deduction or silently reverse a done refund.
    setAdmin({ deduction: { ...DEDUCTION, status: 'applied' } })

    const result = await decideDeduction(DEDUCTION_ID, 'rejected')

    expect(result.error).toMatch(/already been applied/i)
    expect(updates).toHaveLength(0)
  })

  it('still allows a decision on one that was only discussed', async () => {
    setAdmin({ deduction: { ...DEDUCTION, status: 'discussed' } })

    const result = await decideDeduction(DEDUCTION_ID, 'approved')

    expect(result.success).toBe(true)
  })
})

describe('lockBookingRecord', () => {
  it('refuses anyone but the GM', async () => {
    grant('manage_deposits')

    const result = await lockBookingRecord(BOOKING_ID, 'Final invoice issued')

    expect(result.error).toMatch(/only the general manager/i)
    expect(updates).toHaveLength(0)
  })

  it('requires a reason, which goes on the record', async () => {
    const result = await lockBookingRecord(BOOKING_ID, '   ')

    expect(result.error).toMatch(/reason is required/i)
    expect(updates).toHaveLength(0)
  })

  it('refuses to lock a record that is already locked', async () => {
    setAdmin({ booking: { id: BOOKING_ID, locked_at: '2026-08-01T00:00:00.000Z', locked_reason: 'Audit' } })

    const result = await lockBookingRecord(BOOKING_ID, 'Final invoice issued')

    expect(result.error).toMatch(/already locked/i)
    expect(result.error).toContain('Audit')
    expect(updates).toHaveLength(0)
  })

  it('locks an unlocked record with the trimmed reason and who did it', async () => {
    const result = await lockBookingRecord(BOOKING_ID, '  Final invoice issued  ')

    expect(result.success).toBe(true)
    expect(updates[0].payload).toMatchObject({
      locked_reason: 'Final invoice issued',
      locked_by: 'user-1',
    })
  })
})
