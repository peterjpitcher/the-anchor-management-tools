import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// ---------- Module mocks (must come before imports) ----------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn(),
}))

// Keep the real service barrel (so fileSchema and the rest stay intact) but
// replace the import mutation with a spy.
vi.mock('@/services/receipts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/receipts')>()
  return {
    ...actual,
    performImportReceiptStatement: vi.fn(),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// ---------- Imports ----------

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock

const TEST_USER = { user_id: 'user-1', user_email: 'test@example.com' }

function makeFile(content: string, name: string): File {
  const file = new File([content], name, { type: 'text/csv' })
  // Node's File implementation may lack arrayBuffer — patch it for Vitest
  ;(file as File & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () =>
    new TextEncoder().encode(content).buffer
  return file
}

describe('importReceiptStatement sourceType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue(TEST_USER)
  })

  it('passes sourceType=amex through to the service', async () => {
    const { importReceiptStatement } = await import('@/app/actions/receipts')
    const { performImportReceiptStatement } = await import('@/services/receipts')
    ;(performImportReceiptStatement as unknown as Mock).mockResolvedValue({
      success: true, inserted: 1, skipped: 0, batch: { id: 'b1' },
    })

    const fd = new FormData()
    fd.append('statement', makeFile('Date,Description,Card Member,Account #,Amount\n', 'amex.csv'))
    fd.append('sourceType', 'amex')

    await importReceiptStatement(fd)

    expect(performImportReceiptStatement).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(File), expect.any(Buffer), 'amex',
    )
  })

  it('defaults to bank when sourceType is missing', async () => {
    const { importReceiptStatement } = await import('@/app/actions/receipts')
    const { performImportReceiptStatement } = await import('@/services/receipts')
    ;(performImportReceiptStatement as unknown as Mock).mockResolvedValue({ success: true, batch: { id: 'b' } })

    const fd = new FormData()
    fd.append('statement', makeFile('Date,Details,In,Out\n', 'bank.csv'))

    await importReceiptStatement(fd)

    expect(performImportReceiptStatement).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(File), expect.any(Buffer), 'bank',
    )
  })
})
