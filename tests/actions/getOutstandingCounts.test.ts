import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * The nav badges are a to-do list, so a badge stuck on zero is worse than no badge:
 * it actively tells staff there is nothing to do.
 *
 * That is what had happened to Receipts. `receipt_transactions` carries only a
 * `auth.role() = 'service_role'` policy, so counting it through the cookie client
 * returned 0 instead of an error, and the pill read 0 while 76 receipts sat pending
 * in production. These tests pin every count to the admin client so the same silent
 * failure cannot come back on any of them.
 */

vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => unknown) => fn,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
// Only today is pinned. shiftIsoDate stays real, because the seven day window the
// maintenance badge uses is computed from it and a stub would test nothing.
vi.mock('@/lib/dateUtils', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/dateUtils')>()),
  getTodayIsoDate: () => '2026-08-17',
}))
vi.mock('@/lib/checklists/settings', () => ({ currentBusinessDate: vi.fn().mockResolvedValue('2026-08-17') }))
vi.mock('@/lib/event-checklist', () => ({ buildEventChecklist: vi.fn(() => []) }))

import { getOutstandingCounts } from '@/actions/get-outstanding-counts'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const mockedCreateClient = createClient as unknown as Mock
const mockedAdmin = createAdminClient as unknown as Mock

/** Counts keyed by table, so a query routed to the wrong client is visible. */
const COUNTS: Record<string, number> = {
  private_bookings: 2,
  private_booking_sms_queue: 13,
  invoices: 3,
  receipt_transactions: 76,
  cashup_sessions: 0,
  leave_requests: 8,
  checklist_task_instances: 5,
  review_feedback: 1,
  maintenance_items: 6,
}

/** Filters seen per table, so the maintenance window can be asserted, not assumed. */
let filtersSeen: Record<string, Array<[string, unknown, unknown]>>

/** Swapped per test to simulate a failed maintenance read. */
let maintenanceError: { message: string } | null = null

/** Whether the caller is a super-admin, as the is_super_admin RPC would report. */
let callerIsSuperAdmin = true

function buildClient(tablesSeen: string[]) {
  function chain(table: string): any {
    const p: any = {}
    for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lte', 'not', 'order', 'limit']) {
      p[m] = vi.fn((...args: unknown[]) => {
        const seen = filtersSeen[table] ?? (filtersSeen[table] = [])
        seen.push([m, args[0], args[1]])
        return p
      })
    }
    const payload =
      table === 'events'
        ? { data: [], error: null, count: null }
        : table === 'cashup_sessions'
          ? { data: [], error: null, count: COUNTS.cashup_sessions }
          : table === 'maintenance_items'
            ? {
                data: null,
                error: maintenanceError,
                count: maintenanceError ? null : COUNTS.maintenance_items,
              }
            : { data: [], error: null, count: COUNTS[table] ?? 0 }
    p.then = (res: any, rej: any) => Promise.resolve(payload).then(res, rej)
    return p
  }
  return {
    from: vi.fn((table: string) => { tablesSeen.push(table); return chain(table) }),
    rpc: vi.fn((name: string) =>
      name === 'is_super_admin'
        ? Promise.resolve({ data: callerIsSuperAdmin, error: null })
        : Promise.resolve({ data: 4, error: null }),
    ),
  }
}

let adminTables: string[]
let cookieTables: string[]

function setAuth(signedIn: boolean) {
  cookieTables = []
  const cookieClient = buildClient(cookieTables) as any
  cookieClient.auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user: signedIn ? { id: 'user-1' } : null } }),
  }
  mockedCreateClient.mockResolvedValue(cookieClient)
}

beforeEach(() => {
  vi.clearAllMocks()
  adminTables = []
  filtersSeen = {}
  maintenanceError = null
  callerIsSuperAdmin = true
  mockedAdmin.mockReturnValue(buildClient(adminTables))
  setAuth(true)
})

describe('getOutstandingCounts', () => {
  it('returns all zeros and reads nothing when nobody is signed in', async () => {
    setAuth(false)

    const counts = await getOutstandingCounts()

    expect(counts).toEqual({
      events: 0, menu_management: 0, private_bookings: 0, cashing_up: 0,
      invoices: 0, receipts: 0, rota: 0, checklists: 0, feedback: 0,
    })
    expect('maintenance' in counts).toBe(false)
    expect(adminTables).toEqual([])
  })

  it('reports the real pending receipts count instead of a silent zero', async () => {
    const counts = await getOutstandingCounts()

    // The bug this guards: 0 here while 76 receipts were pending.
    expect(counts.receipts).toBe(76)
  })

  it('counts receipts through the admin client, never the cookie client', async () => {
    await getOutstandingCounts()

    // receipt_transactions is unreadable by the authenticated role, so a cookie-client
    // read silently yields 0 rather than failing loudly.
    expect(adminTables).toContain('receipt_transactions')
    expect(cookieTables).not.toContain('receipt_transactions')
  })

  it('routes every service-role-only table through the admin client', async () => {
    await getOutstandingCounts()

    for (const table of ['receipt_transactions', 'checklist_task_instances', 'review_feedback']) {
      expect(adminTables, `${table} must not be read with the cookie client`).toContain(table)
      expect(cookieTables).not.toContain(table)
    }
  })

  it('uses the cookie client only for the auth check', async () => {
    await getOutstandingCounts()

    // Any table read left on the cookie client is a candidate for the same silent zero.
    expect(cookieTables).toEqual([])
  })

  it('adds draft bookings and pending SMS approvals into one private bookings badge', async () => {
    const counts = await getOutstandingCounts()

    expect(counts.private_bookings).toBe(15)
  })

  it('adds missing cashing-up days to the draft session count', async () => {
    const counts = await getOutstandingCounts()

    // No sessions returned for the last 7 days, so all 7 are missing, plus 0 drafts.
    expect(counts.cashing_up).toBe(7)
  })

  it('passes through the menu RPC result', async () => {
    const counts = await getOutstandingCounts()

    expect(counts.menu_management).toBe(4)
  })

  it('carries the remaining counts straight through', async () => {
    const counts = await getOutstandingCounts()

    expect(counts.invoices).toBe(3)
    expect(counts.rota).toBe(8)
    expect(counts.checklists).toBe(5)
    expect(counts.feedback).toBe(1)
  })
})

/**
 * Maintenance is the only count that is not for everyone. Two things matter more
 * than the number itself: a user without access must never receive it, and a read
 * that failed must never be reported as zero.
 */
describe('the maintenance count', () => {
  it('reaches a super-admin', async () => {
    const counts = await getOutstandingCounts()

    expect(counts.maintenance).toBe(6)
  })

  it('is absent from the payload for anyone who is not a super-admin', async () => {
    callerIsSuperAdmin = false

    const counts = await getOutstandingCounts()

    // Not zero, not null, not present at all. The assertion is on the response
    // object, because hiding the badge in the UI would still have shipped the
    // number to the browser.
    expect('maintenance' in counts).toBe(false)
    expect(counts.maintenance).toBeUndefined()
    expect(JSON.parse(JSON.stringify(counts))).not.toHaveProperty('maintenance')
    // Everything else still arrives.
    expect(counts.receipts).toBe(76)
  })

  it('fails closed when the role cannot be verified', async () => {
    mockedAdmin.mockReturnValue({
      ...buildClient(adminTables),
      rpc: vi.fn((name: string) =>
        name === 'is_super_admin'
          ? Promise.resolve({ data: null, error: { message: 'rpc exploded' } })
          : Promise.resolve({ data: 4, error: null }),
      ),
    })

    const counts = await getOutstandingCounts()

    // An unverifiable role is not a permitted one.
    expect('maintenance' in counts).toBe(false)
  })

  it('reports a failed read as unavailable, never as zero', async () => {
    maintenanceError = { message: 'relation "maintenance_items" does not exist' }

    const counts = await getOutstandingCounts()

    // null means "could not be read". Zero would claim there is nothing to do.
    expect(counts.maintenance).toBeNull()
    expect(counts.maintenance).not.toBe(0)
  })

  it('counts open items due on or before today plus seven days', async () => {
    await getOutstandingCounts()

    const filters = filtersSeen.maintenance_items ?? []
    const statuses = filters.find(([method]) => method === 'in')
    const window = filters.find(([method]) => method === 'lte')

    expect(statuses?.[1]).toBe('status')
    // done and cancelled are closed, so neither may be counted.
    expect(statuses?.[2]).not.toContain('done')
    expect(statuses?.[2]).not.toContain('cancelled')
    expect(statuses?.[2]).toContain('on_hold')

    // Today is pinned to 2026-08-17, so the window ends on the 24th.
    expect(window?.[1]).toBe('target_date')
    expect(window?.[2]).toBe('2026-08-24')
  })

  it('reads maintenance through the admin client, never the cookie client', async () => {
    await getOutstandingCounts()

    expect(adminTables).toContain('maintenance_items')
    expect(cookieTables).not.toContain('maintenance_items')
  })
})
