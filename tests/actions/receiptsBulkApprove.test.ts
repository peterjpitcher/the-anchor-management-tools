import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

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

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: {
    enqueue: vi.fn().mockResolvedValue({ success: true }),
  },
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { approveReceiptRuleSuggestion, approveReceiptRuleSuggestions } from '@/app/actions/receipts'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCurrentUser = getCurrentUser as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

type Handles = {
  supabase: unknown
  approveRpcMock: Mock
  pendingRefreshCount: () => number
}

// Builds an admin-client stub covering:
//  - rpc('is_super_admin')              -> true (governance gate)
//  - rpc('approve_receipt_rule_suggestion') -> new rule id
//  - receipt_rules / receipt_rule_suggestions / receipt_classification_signals reads/inserts
//  - receipt_transactions pending query used by refreshAutomationForPendingTransactions
function makeAdmin(): Handles {
  const approveRpcMock = vi.fn().mockResolvedValue({ data: 'rule-1', error: null })
  let pendingRefreshCount = 0

  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    if (fn === 'is_super_admin') return Promise.resolve({ data: true, error: null })
    if (fn === 'approve_receipt_rule_suggestion') return approveRpcMock(fn, args)
    return Promise.resolve({ data: null, error: null })
  })

  const supabase = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === 'receipt_transactions') {
        // refreshAutomationForPendingTransactions: select('id').eq('status','pending').limit(500)
        const limit = vi.fn(() => {
          pendingRefreshCount += 1
          return Promise.resolve({ data: [], error: null })
        })
        const eq = vi.fn().mockReturnValue({ limit })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'receipt_rules') {
        const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'rule-1', name: 'r' }, error: null })
        const eq = vi.fn().mockReturnValue({ maybeSingle })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'receipt_rule_suggestions') {
        const maybeSingle = vi.fn().mockResolvedValue({
          data: { id: 'sug', set_vendor_id: null, set_vendor_name: 'V', set_expense_category: null, evidence_transaction_ids: [] },
          error: null,
        })
        const eq = vi.fn().mockReturnValue({ maybeSingle })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'receipt_classification_signals') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      if (table === 'user_roles') {
        const eq = vi.fn().mockResolvedValue({ data: [], error: null })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  return { supabase, approveRpcMock, pendingRefreshCount: () => pendingRefreshCount }
}

describe('approveReceiptRuleSuggestion / approveReceiptRuleSuggestions actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'user@example.com' })
    mockedLogAuditEvent.mockResolvedValue(undefined)
  })

  it('single approve calls the approve RPC once and refreshes pending rows once', async () => {
    const handles = makeAdmin()
    mockedCreateAdminClient.mockReturnValue(handles.supabase)

    const result = await approveReceiptRuleSuggestion('sug-1', { active: true })

    expect(result.success).toBe(true)
    expect(handles.approveRpcMock).toHaveBeenCalledTimes(1)
    expect(handles.pendingRefreshCount()).toBe(1)
  })

  it('bulk approve calls the RPC N times and refreshes pending rows exactly once', async () => {
    const handles = makeAdmin()
    mockedCreateAdminClient.mockReturnValue(handles.supabase)

    const result = await approveReceiptRuleSuggestions(['a', 'b', 'c'], { active: true })

    expect(result).toMatchObject({ approved: 3, failed: 0 })
    expect(handles.approveRpcMock).toHaveBeenCalledTimes(3)
    // One refresh after the whole batch, not per id.
    expect(handles.pendingRefreshCount()).toBe(1)
  })

  it('bulk approve dedupes ids and rejects an empty selection', async () => {
    const handles = makeAdmin()
    mockedCreateAdminClient.mockReturnValue(handles.supabase)

    const empty = await approveReceiptRuleSuggestions([])
    expect(empty.error).toBeTruthy()
    expect(handles.approveRpcMock).not.toHaveBeenCalled()

    const deduped = await approveReceiptRuleSuggestions(['a', 'a', 'b'])
    expect(deduped).toMatchObject({ approved: 2, failed: 0 })
    expect(handles.approveRpcMock).toHaveBeenCalledTimes(2)
  })

  it('blocks non-super-admins', async () => {
    const handles = makeAdmin()
    // is_super_admin → false
    ;(handles.supabase as { rpc: Mock }).rpc.mockImplementation((fn: string) =>
      fn === 'is_super_admin' ? Promise.resolve({ data: false, error: null }) : Promise.resolve({ data: 'rule-1', error: null })
    )
    mockedCreateAdminClient.mockReturnValue(handles.supabase)

    const result = await approveReceiptRuleSuggestions(['a'])
    expect(result.error).toBe('Only super admins can approve suggested rules.')
  })
})
