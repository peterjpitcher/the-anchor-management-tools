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
  // Terminal: returns { data, error }
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
function createMockSupabase(tableResponses: Record<string, { data: unknown; error?: unknown } | Array<{ data: unknown; error?: unknown }>>) {
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
      const methods = ['select', 'eq', 'is', 'ilike', 'not', 'in', 'lt', 'lte', 'gt', 'gte', 'order', 'limit', 'maybeSingle', 'single']
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

  it('includes one_off entries in unbilled total, inc VAT', async () => {
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
            vat_rate_snapshot: 20,
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
    // Unbilled work must be inc VAT, because it is summed with the invoice
    // balance, which is inc VAT. 150 ex VAT at 20% is 180.
    expect(result.balance?.unbilledOneOffTotal).toBe(180)
    expect(result.balance?.unbilledTotal).toBe(180)
  })

  it('bills mileage with no VAT, matching the billing engine', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      invoices: { data: [] },
      oj_entries: {
        data: [
          {
            entry_type: 'mileage',
            duration_minutes_rounded: null,
            miles: 100,
            hourly_rate_ex_vat_snapshot: null,
            vat_rate_snapshot: 20,
            mileage_rate_snapshot: 0.55,
            amount_ex_vat_snapshot: null,
          },
        ],
      },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: { data: [] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    expect(result.balance?.unbilledMileageTotal).toBe(55)
  })

  it('ignores unbilled charges whose recurring charge has been switched off', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      invoices: { data: [] },
      oj_entries: { data: [] },
      oj_recurring_charge_instances: {
        data: [
          { amount_ex_vat_snapshot: 30, vat_rate_snapshot: 20, recurring_charge: { is_active: false } },
          { amount_ex_vat_snapshot: 40, vat_rate_snapshot: 20, recurring_charge: { is_active: true } },
        ],
      },
      credit_notes: { data: [] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    // Only the active charge counts: 40 ex VAT at 20% is 48. The billing run
    // will never bill the inactive one, so counting it would overstate.
    expect(result.balance?.unbilledRecurringTotal).toBe(48)
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

  it('uses all unsettled invoices for balance while limiting display invoices', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const unsettledInvoices = Array.from({ length: 60 }, (_, index) => ({
      id: `inv-${index}`,
      invoice_number: `INV-${index}`,
      invoice_date: '2026-01-01',
      due_date: '2026-01-31',
      reference: 'OJ Projects',
      status: 'sent',
      total_amount: 10,
      paid_amount: 0,
    }))

    const mockSb = createMockSupabase({
      invoices: [
        { data: unsettledInvoices },
        { data: unsettledInvoices.slice(0, 50) },
      ],
      oj_entries: { data: [] },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: { data: [] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    expect(result.balance?.unpaidInvoiceBalance).toBe(600)
    expect(result.balance?.invoices).toHaveLength(50)
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
            vat_rate_snapshot: 20,
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

    // 90 mins at 75/hr = 112.50 ex VAT, 135.00 inc VAT
    expect(result.balance?.unbilledTimeTotal).toBe(135)
    // Both halves are now inc VAT: 33.33 + 135.00 = 168.33
    expect(result.balance?.totalOutstanding).toBe(168.33)
  })

  it('never lets credit notes push the invoice balance below zero', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      invoices: {
        data: [
          { id: 'inv-1', invoice_number: 'INV-1', invoice_date: '2026-01-01', due_date: '2026-01-31', reference: 'OJ Projects', status: 'sent', total_amount: 100, paid_amount: 0 },
        ],
      },
      oj_entries: { data: [] },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: { data: [{ amount_inc_vat: 500, invoice_id: 'inv-1' }] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    expect(result.balance?.unpaidInvoiceBalance).toBe(0)
    expect(result.balance?.totalOutstanding).toBe(0)
  })

  it('ignores credit notes entirely when no OJ invoice is unsettled', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      // Every OJ invoice is settled, so none is counted in the balance and no
      // credit note against one should reduce it either.
      invoices: [{ data: [] }, { data: [] }],
      oj_entries: { data: [] },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: { data: [{ amount_inc_vat: 200, invoice_id: 'inv-settled' }] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    expect(result.balance?.creditNoteTotal).toBe(0)
    expect(result.balance?.totalOutstanding).toBe(0)
  })

  it('keeps draft invoices out of what the client owes, and reports them separately', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      invoices: [
        {
          data: [
            { id: 'inv-sent', status: 'sent', total_amount: 500, paid_amount: 0 },
            { id: 'inv-draft', status: 'draft', total_amount: 460.5, paid_amount: 0 },
          ],
        },
        { data: [] },
      ],
      oj_entries: { data: [] },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: { data: [] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    // A draft has never been sent, so it is not a receivable. Counting it made
    // an abandoned reissue look like money the client owed.
    expect(result.balance?.unpaidInvoiceBalance).toBe(500)
    expect(result.balance?.draftInvoiceTotal).toBe(460.5)
    expect(result.balance?.totalOutstanding).toBe(500)
  })

  it('values unbilled time at the client rate, not the default, when the snapshot is null', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = createMockSupabase({
      invoices: { data: [] },
      oj_entries: {
        data: [
          {
            entry_type: 'time',
            duration_minutes_rounded: 60,
            miles: null,
            hourly_rate_ex_vat_snapshot: null,
            vat_rate_snapshot: 20,
            mileage_rate_snapshot: null,
            amount_ex_vat_snapshot: null,
          },
        ],
      },
      // The billing engine resolves snapshot, then this setting, then the
      // default. Omitting the middle candidate billed the drawer at GBP 75.
      oj_vendor_billing_settings: { data: { vat_rate: 20, hourly_rate_ex_vat: 62.5, mileage_rate: 0.55 } },
      oj_recurring_charge_instances: { data: [] },
      credit_notes: { data: [] },
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await getClientBalance('vendor-1')

    // 1 hour at GBP 62.50 plus 20% VAT, not GBP 75 plus VAT (which would be 90).
    expect(result.balance?.unbilledTimeTotal).toBe(75)
  })
})
