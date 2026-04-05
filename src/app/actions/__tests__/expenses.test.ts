import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Build a chainable mock that mirrors the Supabase query builder.
// Each method returns the same chain, and the chain is also a promise
// that resolves to { data, error, count }.
// ---------------------------------------------------------------------------

function createQueryChain(resolvedValue: { data?: unknown; error?: unknown; count?: number } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'lte', 'ilike', 'order', 'single', 'maybeSingle']

  for (const method of methods) {
    chain[method] = vi.fn(() => chain)
  }

  // Make it thenable so `await supabase.from(...).select(...).eq(...)` works
  chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue)

  return chain
}

let latestQueryResult = { data: null as unknown, error: null as unknown, count: 0 }

const mockFrom = vi.fn(() => createQueryChain(latestQueryResult))
const mockUpload = vi.fn().mockResolvedValue({ error: null })
const mockRemove = vi.fn().mockResolvedValue({ error: null })
const mockCreateSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.com/signed' } })

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        remove: mockRemove,
        createSignedUrl: mockCreateSignedUrl,
      })),
    },
  })),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    user_id: 'test-user-id',
    user_email: 'test@example.com',
  }),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/expenses/imageProcessor', () => ({
  validateFileType: vi.fn().mockReturnValue({ valid: true, mimeType: 'image/jpeg' }),
  optimiseImage: vi.fn().mockResolvedValue({
    buffer: Buffer.alloc(50),
    mimeType: 'image/jpeg',
    width: 800,
    height: 600,
    originalSizeBytes: 100,
    optimisedSizeBytes: 50,
  }),
  extensionForMimeType: vi.fn().mockReturnValue('jpg'),
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import {
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseFiles,
} from '../expenses'
import { checkUserPermission } from '@/app/actions/rbac'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  latestQueryResult = { data: null, error: null, count: 0 }
})

// ---------------------------------------------------------------------------
// createExpense
// ---------------------------------------------------------------------------

describe('createExpense', () => {
  it('should create an expense with valid data', async () => {
    latestQueryResult = { data: { id: 'new-expense-id' }, error: null }

    const result = await createExpense({
      expense_date: '2026-04-05',
      company_ref: 'Costco',
      justification: 'Kitchen supplies',
      amount: 42.50,
      vat_applicable: true,
      vat_amount: 8.50,
      notes: null,
    })

    expect(result.success).toBe(true)
    expect(result.data?.id).toBe('new-expense-id')
  })

  it('should reject amount <= 0', async () => {
    const result = await createExpense({
      expense_date: '2026-04-05',
      company_ref: 'Test',
      justification: 'Test',
      amount: -5,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.error).toBeDefined()
    expect(result.success).toBeUndefined()
  })

  it('should reject empty company_ref', async () => {
    const result = await createExpense({
      expense_date: '2026-04-05',
      company_ref: '',
      justification: 'Test',
      amount: 10,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.error).toBeDefined()
  })

  it('should reject company_ref exceeding max length', async () => {
    const result = await createExpense({
      expense_date: '2026-04-05',
      company_ref: 'x'.repeat(201),
      justification: 'Test',
      amount: 10,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.error).toBeDefined()
  })

  it('should reject justification exceeding max length', async () => {
    const result = await createExpense({
      expense_date: '2026-04-05',
      company_ref: 'Test',
      justification: 'x'.repeat(501),
      amount: 10,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.error).toBeDefined()
  })

  it('should reject invalid date format', async () => {
    const result = await createExpense({
      expense_date: '05-04-2026', // wrong format
      company_ref: 'Test',
      justification: 'Test',
      amount: 10,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.error).toBeDefined()
  })

  it('should reject negative VAT amount', async () => {
    const result = await createExpense({
      expense_date: '2026-04-05',
      company_ref: 'Test',
      justification: 'Test',
      amount: 10,
      vat_applicable: true,
      vat_amount: -1,
    })

    expect(result.error).toBeDefined()
  })

  it('should return error when permission denied', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)

    const result = await createExpense({
      expense_date: '2026-04-05',
      company_ref: 'Test',
      justification: 'Test',
      amount: 10,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.error).toContain('permissions')
  })

  it('should return error when DB insert fails', async () => {
    latestQueryResult = { data: null, error: { message: 'DB error' } }

    const result = await createExpense({
      expense_date: '2026-04-05',
      company_ref: 'Test',
      justification: 'Test',
      amount: 10,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.error).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// updateExpense
// ---------------------------------------------------------------------------

describe('updateExpense', () => {
  it('should update with valid data', async () => {
    latestQueryResult = { data: { id: 'existing-id' }, error: null }

    const result = await updateExpense({
      id: 'existing-id',
      expense_date: '2026-04-06',
      company_ref: 'B&Q',
      justification: 'Maintenance supplies',
      amount: 25.00,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.success).toBe(true)
  })

  it('should reject missing ID', async () => {
    const result = await updateExpense({
      id: '',
      expense_date: '2026-04-06',
      company_ref: 'B&Q',
      justification: 'Test',
      amount: 25.00,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.error).toContain('required')
  })

  it('should reject invalid amount', async () => {
    const result = await updateExpense({
      id: 'existing-id',
      expense_date: '2026-04-06',
      company_ref: 'B&Q',
      justification: 'Test',
      amount: 0,
      vat_applicable: false,
      vat_amount: 0,
    })

    expect(result.error).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// deleteExpense
// ---------------------------------------------------------------------------

describe('deleteExpense', () => {
  it('should delete expense and clean up storage files', async () => {
    // First call: select expense_files, second call: delete expense
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Fetching files
        return createQueryChain({ data: [{ storage_path: 'exp-id/file1.jpg' }], error: null })
      }
      // Deleting expense
      return createQueryChain({ data: null, error: null })
    })

    const result = await deleteExpense('expense-to-delete')
    expect(result.success).toBe(true)
  })

  it('should reject empty ID', async () => {
    const result = await deleteExpense('')
    expect(result.error).toContain('required')
  })
})

// ---------------------------------------------------------------------------
// getExpenseFiles
// ---------------------------------------------------------------------------

describe('getExpenseFiles', () => {
  it('should return empty array when no files exist', async () => {
    latestQueryResult = { data: [], error: null }

    const result = await getExpenseFiles('exp-id')
    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })

  it('should reject empty expense ID', async () => {
    const result = await getExpenseFiles('')
    expect(result.success).toBe(false)
    expect(result.error).toContain('required')
  })

  it('should return error when permission denied', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)

    const result = await getExpenseFiles('exp-id')
    expect(result.success).toBe(false)
    expect(result.error).toContain('permissions')
  })
})
