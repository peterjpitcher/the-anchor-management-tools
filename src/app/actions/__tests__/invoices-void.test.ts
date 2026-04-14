import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn().mockReturnValue(false),
  sendInvoiceEmail: vi.fn(),
}))

vi.mock('@/services/invoices', () => ({
  InvoiceService: {
    getInvoiceById: vi.fn(),
    recordPayment: vi.fn(),
  },
  CreateInvoiceSchema: { parse: vi.fn() },
}))

vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e as Error)?.message || String(e)),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

import { voidInvoice } from '@/app/actions/invoices'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'

function buildChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'eq', 'is', 'ilike', 'order', 'limit', 'maybeSingle', 'single', 'update']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  const proxy = new Proxy(chain, {
    get(target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result)
      }
      if (typeof target[prop as string] === 'function') {
        return (..._args: unknown[]) => proxy
      }
      return target[prop as string]
    },
  })
  return proxy
}

let permissionCallOrder: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  permissionCallOrder = []
})

describe('voidInvoice', () => {
  it('returns error when invoice has payments (paid_amount > 0)', async () => {
    // Both permissions granted
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = {
      from: vi.fn().mockReturnValue(
        buildChain({
          data: {
            id: 'inv-1',
            invoice_number: 'INV-001',
            status: 'sent',
            paid_amount: 50,
            internal_notes: null,
          },
          error: null,
        })
      ),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'admin@test.com' } },
        }),
      },
    }
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await voidInvoice('inv-1', 'Test void')

    expect(result.error).toBe('Cannot void an invoice with payments. Issue a credit note instead.')
    expect(result.success).toBeUndefined()
  })

  it('successfully voids an unpaid invoice', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = {
      from: vi.fn().mockReturnValue(
        buildChain({
          data: {
            id: 'inv-1',
            invoice_number: 'INV-001',
            status: 'sent',
            paid_amount: 0,
            internal_notes: null,
          },
          error: null,
        })
      ),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'admin@test.com' } },
        }),
      },
    }
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    // Admin client for the void updates
    const adminUpdateChain = buildChain({ data: null, error: null })
    const mockAdmin = {
      from: vi.fn().mockReturnValue(adminUpdateChain),
    }
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as any)

    const result = await voidInvoice('inv-1', 'Duplicate invoice')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    // Admin client should have been called to update invoices, oj_entries, and oj_recurring_charge_instances
    expect(mockAdmin.from).toHaveBeenCalledWith('invoices')
    expect(mockAdmin.from).toHaveBeenCalledWith('oj_entries')
    expect(mockAdmin.from).toHaveBeenCalledWith('oj_recurring_charge_instances')
  })

  it('reverses linked oj_entries and recurring instances to unbilled status', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const mockSb = {
      from: vi.fn().mockReturnValue(
        buildChain({
          data: {
            id: 'inv-1',
            invoice_number: 'INV-001',
            status: 'sent',
            paid_amount: 0,
            internal_notes: 'Some notes',
          },
          error: null,
        })
      ),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'admin@test.com' } },
        }),
      },
    }
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    // Track which tables and update payloads the admin client receives
    const updateCalls: Array<{ table: string; values: unknown }> = []

    function buildAdminChain(result: { data: unknown; error: unknown }) {
      const updateFn = vi.fn()
      const obj = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        update: updateFn,
        then: (resolve: (v: unknown) => void) => resolve(result),
      }
      updateFn.mockReturnValue(obj)
      return { obj, updateFn }
    }

    const mockAdmin = {
      from: vi.fn().mockImplementation((table: string) => {
        const { obj, updateFn } = buildAdminChain({ data: null, error: null })
        // Intercept update calls
        updateFn.mockImplementation((values: unknown) => {
          updateCalls.push({ table, values })
          return obj
        })
        return obj
      }),
    }
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as any)

    await voidInvoice('inv-1', 'Wrong vendor')

    // Admin client should have been called for all three tables
    expect(mockAdmin.from).toHaveBeenCalledWith('invoices')
    expect(mockAdmin.from).toHaveBeenCalledWith('oj_entries')
    expect(mockAdmin.from).toHaveBeenCalledWith('oj_recurring_charge_instances')

    // oj_entries should be reversed with status=unbilled, billing_run_id=null, invoice_id=null
    const entriesUpdate = updateCalls.find((c) => c.table === 'oj_entries')
    expect(entriesUpdate).toBeDefined()
    expect(entriesUpdate?.values).toEqual({
      status: 'unbilled',
      billing_run_id: null,
      invoice_id: null,
    })

    // oj_recurring_charge_instances should also be reversed
    const recurringUpdate = updateCalls.find((c) => c.table === 'oj_recurring_charge_instances')
    expect(recurringUpdate).toBeDefined()
    expect(recurringUpdate?.values).toEqual({
      status: 'unbilled',
      billing_run_id: null,
      invoice_id: null,
    })
  })

  it('requires both invoices:delete and oj_projects:manage permissions', async () => {
    // First call (invoices:delete) = true, second call (oj_projects:manage) = false
    vi.mocked(checkUserPermission)
      .mockResolvedValueOnce(true)   // invoices delete
      .mockResolvedValueOnce(false)  // oj_projects manage

    const mockSb = {
      from: vi.fn().mockReturnValue(buildChain({ data: null, error: null })),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'admin@test.com' } },
        }),
      },
    }
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await voidInvoice('inv-1', 'Test void')

    expect(result.error).toBe(
      'You do not have permission to manage OJ Projects entries (required for voiding)'
    )
  })

  it('returns error when invoices:delete permission is denied', async () => {
    vi.mocked(checkUserPermission).mockResolvedValueOnce(false) // invoices delete

    const mockSb = {
      from: vi.fn().mockReturnValue(buildChain({ data: null, error: null })),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'admin@test.com' } },
        }),
      },
    }
    vi.mocked(createClient).mockResolvedValue(mockSb as any)

    const result = await voidInvoice('inv-1', 'Test void')

    expect(result.error).toBe('You do not have permission to void invoices')
  })
})
