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
vi.mock('@/lib/dateUtils', () => ({ getTodayIsoDate: () => '2026-08-17' }))
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
}

function buildClient(tablesSeen: string[]) {
  function chain(table: string): any {
    const p: any = {}
    for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lte', 'not', 'order', 'limit']) {
      p[m] = vi.fn(() => p)
    }
    const payload =
      table === 'events'
        ? { data: [], error: null, count: null }
        : table === 'cashup_sessions'
          ? { data: [], error: null, count: COUNTS.cashup_sessions }
          : { data: [], error: null, count: COUNTS[table] ?? 0 }
    p.then = (res: any, rej: any) => Promise.resolve(payload).then(res, rej)
    return p
  }
  return {
    from: vi.fn((table: string) => { tablesSeen.push(table); return chain(table) }),
    rpc: vi.fn(() => Promise.resolve({ data: 4, error: null })),
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
