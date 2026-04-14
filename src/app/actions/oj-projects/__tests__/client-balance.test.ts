import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock dependencies before importing the module under test
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

import { getClientBalance } from '@/app/actions/oj-projects/client-balance'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'

// Helper to build a chainable Supabase query mock
function mockQuery(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  const methods = ['from', 'select', 'eq', 'is', 'ilike', 'order', 'limit']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Terminal — returns { data, error }
  chain.then = undefined
  // Make the chain thenable at the end
  Object.defineProperty(chain, Symbol.for('vitest:result'), { value: { data, error } })

  // Patch the last method to resolve
  for (const m of methods) {
    (chain[m] as ReturnType<typeof vi.fn>).mockReturnValue(
      new Proxy(chain, {
        get(target, prop) {
          if (prop === 'then') {
            // Make it act as a promise
            return (resolve: (v: unknown) => void) => resolve({ data, error })
          }
          return target[prop as string]
        },
      })
    )
  }

  return chain
}

/**
 * Creates a mock Supabase client that responds differently per table.
 * tableResponses is a map of table_name -> { data, error }
 */
function createMockSupabase(tableResponses: Record<string, { data: unknown; error?: unknown }>) {
  const callIndex: Record<string, number> = {}

  return {
    from: vi.fn().mockImplementation((table: string) => {
      // Some tables are queried multiple times (e.g. invoices); support indexed access
      if (!callIndex[table]) callIndex[table] = 0
      const responses = tableResponses[table]
      const resp = Array.isArray(responses)
        ? responses[callIndex[table]++] || responses[responses.length - 1]
        : responses || { data: [], error: null }

      const chain: Record<string, ReturnType<typeof vi.fn>> = {}
      const methods = ['select', 'eq', 'is', 'ilike', 'order', 'limit']
      for (const m of methods) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }
      // Make the entire chain resolve with resp
      const proxy = new Proxy(chain, {
        get(target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) =>
              resolve({ data: resp.data, error: resp.error || null })
          }
          if (typeof target[prop as string] === 'function') {
            return (...args: unknown[]) => proxy
          }
          return target[prop as string]
        },
      })
      return proxy
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getClientBalance', () => {
  it('returns permission error when user lacks oj_projects view', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)

    const result = await getClientBalance('vendor-1')

    expect(result.error).toBe('You do not have permission to view OJ Projects data')
    expect(result.balance).toBeUndefined()
  })

  it('includes one_off entries in unbilled total', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      invoices: { data: [] },
      oj_entries: {
        data: [
          {
            entry_type: 'one_off',
            duration_minutes_rounded: null,
            miles: null,
            hourly_rate_ex_vat_snapshot: null,
            vat_rate_snapshot: null,
            mileage_rate_snapshot: null,
            amount_ex_vat_snapshot: 150,
          },
        ],
      },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: { data: [] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    expect(result.error).toBeUndefined()
    expect(result.balance?.unbilledOneOffTotal).toBe(150)
    expect(result.balance?.unbilledTotal).toBe(150)
  })

  it('subtracts credit notes from unpaid invoice balance', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      invoices: {
        data: [
          {
            id: 'inv-1',
            invoice_number: 'INV-001',
            invoice_date: '2026-01-01',
            due_date: '2026-01-31',
            reference: 'OJ Projects Jan',
            status: 'sent',
            total_amount: 500,
            paid_amount: 0,
          },
        ],
      },
      oj_entries: { data: [] },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: {
        data: [{ amount_inc_vat: 100 }],
      },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    expect(result.balance?.unpaidInvoiceBalance).toBe(400) // 500 - 100
    expect(result.balance?.creditNoteTotal).toBe(100)
  })

  it('excludes void, written_off, and paid invoices from unpaid balance', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      invoices: {
        data: [
          { id: 'inv-void', invoice_number: 'V1', invoice_date: '2026-01-01', due_date: '2026-01-31', reference: 'OJ Projects', status: 'void', total_amount: 200, paid_amount: 0 },
          { id: 'inv-wo', invoice_number: 'V2', invoice_date: '2026-01-01', due_date: '2026-01-31', reference: 'OJ Projects', status: 'written_off', total_amount: 300, paid_amount: 0 },
          { id: 'inv-paid', invoice_number: 'V3', invoice_date: '2026-01-01', due_date: '2026-01-31', reference: 'OJ Projects', status: 'paid', total_amount: 400, paid_amount: 400 },
          { id: 'inv-sent', invoice_number: 'V4', invoice_date: '2026-01-01', due_date: '2026-01-31', reference: 'OJ Projects', status: 'sent', total_amount: 100, paid_amount: 0 },
        ],
      },
      oj_entries: { data: [] },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: { data: [] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    // Only the 'sent' invoice (100) should count; void, written_off, paid are excluded
    expect(result.balance?.unpaidInvoiceBalance).toBe(100)
  })

  it('produces correct 2dp values with roundMoney', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      invoices: {
        data: [
          { id: 'inv-1', invoice_number: 'INV-1', invoice_date: '2026-01-01', due_date: '2026-01-31', reference: 'OJ Projects', status: 'sent', total_amount: 33.33, paid_amount: 0 },
        ],
      },
      oj_entries: {
        data: [
          {
            entry_type: 'time',
            duration_minutes_rounded: 90,
            miles: null,
            hourly_rate_ex_vat_snapshot: 75,
            vat_rate_snapshot: 0.2,
            mileage_rate_snapshot: null,
            amount_ex_vat_snapshot: null,
          },
        ],
      },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: { data: [] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    // 90 mins at 75/hr = 112.50
    expect(result.balance?.unbilledTimeTotal).toBe(112.5)
    // Total outstanding = 33.33 + 112.50 = 145.83
    expect(result.balance?.totalOutstanding).toBe(145.83)
  })
})
