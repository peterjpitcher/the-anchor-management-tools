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
  isGraphConfigured: vi.fn().mockReturnValue(true),
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

import { recordPayment } from '@/app/actions/invoices'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { InvoiceService } from '@/services/invoices'

// Helper: build a mock Supabase client for receipt/payment tests
function buildMockSupabase(overrides: {
  invoiceBeforeStatus?: string
  invoiceAfterStatus?: string
  existingEmailLog?: boolean
  invoiceData?: Record<string, unknown>
  emailLogInsertError?: boolean
}) {
  const {
    invoiceBeforeStatus = 'sent',
    invoiceAfterStatus = 'paid',
    existingEmailLog = false,
    emailLogInsertError = false,
  } = overrides

  let fromCallCount = 0
  const invoiceSelectCalls: string[] = []

  const mock = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'invoices') {
        const callIdx = invoiceSelectCalls.length
        invoiceSelectCalls.push(table)
        const statusForCall =
          callIdx === 0 ? invoiceBeforeStatus : invoiceAfterStatus
        return chainMock({
          data: { status: statusForCall },
          error: null,
        })
      }
      if (table === 'invoice_email_logs') {
        fromCallCount++
        // First call is the dedup check (select), subsequent calls are insert
        if (fromCallCount === 1) {
          return chainMock({
            data: existingEmailLog ? { id: 'existing-log' } : null,
            error: null,
          })
        }
        // insert call
        return {
          insert: vi.fn().mockReturnValue({
            data: null,
            error: emailLogInsertError ? { message: 'insert failed' } : null,
          }),
        }
      }
      return chainMock({ data: null, error: null })
    }),
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: 'user-1', email: 'u@test.com' } } }),
    },
  }

  return mock
}

function chainMock(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'eq', 'is', 'ilike', 'order', 'limit', 'maybeSingle', 'single']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Make the chain thenable
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

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('invoiceId', overrides.invoiceId || 'inv-1')
  fd.set('paymentDate', overrides.paymentDate || '2026-04-14')
  fd.set('amount', overrides.amount || '100')
  fd.set('paymentMethod', overrides.paymentMethod || 'bank_transfer')
  if (overrides.reference) fd.set('reference', overrides.reference)
  if (overrides.notes) fd.set('notes', overrides.notes)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: permission granted
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  // Default: email is configured
  vi.mocked(isGraphConfigured).mockReturnValue(true)
})

describe('recordPayment — receipt triggering logic', () => {
  it('triggers receipt when status changes to paid', async () => {
    const mockSb = buildMockSupabase({
      invoiceBeforeStatus: 'sent',
      invoiceAfterStatus: 'paid',
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)
    vi.mocked(InvoiceService.recordPayment).mockResolvedValue({
      id: 'pay-1',
      invoice_id: 'inv-1',
      amount: 100,
      payment_date: '2026-04-14',
      payment_method: 'bank_transfer',
    } as any)

    // Mock the InvoiceService.getInvoiceById for receipt flow
    vi.mocked(InvoiceService.getInvoiceById).mockResolvedValue({
      id: 'inv-1',
      invoice_number: 'INV-001',
      status: 'paid',
      vendor_id: 'v-1',
      vendor: { email: 'vendor@test.com', name: 'Test Vendor', contact_name: 'John' },
      total_amount: 100,
      paid_amount: 100,
      payments: [{ id: 'pay-1', amount: 100, payment_date: '2026-04-14', payment_method: 'bank_transfer' }],
    } as any)

    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true } as any)

    const result = await recordPayment(makeFormData())

    expect(result.success).toBe(true)
    // sendInvoiceEmail should have been called for the receipt
    expect(sendInvoiceEmail).toHaveBeenCalled()
  })

  it('triggers receipt when status changes to partially_paid', async () => {
    const mockSb = buildMockSupabase({
      invoiceBeforeStatus: 'sent',
      invoiceAfterStatus: 'partially_paid',
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)
    vi.mocked(InvoiceService.recordPayment).mockResolvedValue({
      id: 'pay-1',
      invoice_id: 'inv-1',
      amount: 50,
      payment_date: '2026-04-14',
      payment_method: 'bank_transfer',
    } as any)

    vi.mocked(InvoiceService.getInvoiceById).mockResolvedValue({
      id: 'inv-1',
      invoice_number: 'INV-001',
      status: 'partially_paid',
      vendor_id: 'v-1',
      vendor: { email: 'vendor@test.com', name: 'Test Vendor', contact_name: 'John' },
      total_amount: 200,
      paid_amount: 50,
      payments: [{ id: 'pay-1', amount: 50, payment_date: '2026-04-14', payment_method: 'bank_transfer' }],
    } as any)

    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true } as any)

    const result = await recordPayment(makeFormData({ amount: '50' }))

    expect(result.success).toBe(true)
    expect(sendInvoiceEmail).toHaveBeenCalled()
  })

  it('does NOT trigger receipt when status was already paid', async () => {
    const mockSb = buildMockSupabase({
      invoiceBeforeStatus: 'paid',
      invoiceAfterStatus: 'paid',
    })
    vi.mocked(createClient).mockResolvedValue(mockSb as any)
    vi.mocked(InvoiceService.recordPayment).mockResolvedValue({
      id: 'pay-2',
      invoice_id: 'inv-1',
      amount: 10,
      payment_date: '2026-04-14',
      payment_method: 'bank_transfer',
    } as any)

    const result = await recordPayment(makeFormData({ amount: '10' }))

    expect(result.success).toBe(true)
    // Receipt should NOT have been triggered because before status was already paid
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })
})
