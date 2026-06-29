import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  performApproveReceiptRuleSuggestion,
  performApproveReceiptRuleSuggestions,
} from './receiptGovernance'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

type MockOptions = {
  // Map of suggestionId -> { ruleId, error } for the rpc response.
  rpcResults?: Record<string, { ruleId: string | null; error: unknown }>
  // Default rpc result when an id isn't in rpcResults.
  defaultRpc?: { ruleId: string | null; error: unknown }
}

type MockHandles = {
  supabase: unknown
  rpcMock: Mock
  signalInserts: Record<string, unknown>[][]
}

function makeMockSupabase(options: MockOptions = {}): MockHandles {
  const signalInserts: Record<string, unknown>[][] = []

  const rpcMock = vi.fn((_fn: string, args: { p_suggestion_id: string }) => {
    const match = options.rpcResults?.[args.p_suggestion_id]
    const result = match ?? options.defaultRpc ?? { ruleId: 'rule-1', error: null }
    return Promise.resolve({ data: result.ruleId, error: result.error })
  })

  const supabase = {
    rpc: rpcMock,
    from: vi.fn((table: string) => {
      if (table === 'receipt_rules') {
        const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'rule-1', name: 'Tesco auto-tag' }, error: null })
        const eq = vi.fn().mockReturnValue({ maybeSingle })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'receipt_rule_suggestions') {
        const maybeSingle = vi.fn().mockResolvedValue({
          data: {
            id: 'sug-1',
            set_vendor_id: 'vendor-1',
            set_vendor_name: 'Tesco',
            set_expense_category: 'General Purchases',
            evidence_transaction_ids: ['tx-1', 'tx-2'],
          },
          error: null,
        })
        const eq = vi.fn().mockReturnValue({ maybeSingle })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'receipt_classification_signals') {
        return {
          insert: vi.fn((rows: Record<string, unknown>[]) => {
            signalInserts.push(rows)
            return Promise.resolve({ error: null })
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  return { supabase, rpcMock, signalInserts }
}

describe('performApproveReceiptRuleSuggestion (atomic RPC)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the approve RPC exactly once and returns the created rule', async () => {
    const handles = makeMockSupabase({ defaultRpc: { ruleId: 'rule-1', error: null } })
    mockedCreateAdminClient.mockReturnValue(handles.supabase)

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-1', { active: true })

    expect(result.success).toBe(true)
    expect(result.rule?.id).toBe('rule-1')
    expect(handles.rpcMock).toHaveBeenCalledTimes(1)
    expect(handles.rpcMock).toHaveBeenCalledWith('approve_receipt_rule_suggestion', {
      p_suggestion_id: 'sug-1',
      p_user_id: 'user-1',
      p_active: true,
    })
    // Signals recorded against the suggestion evidence.
    expect(handles.signalInserts).toHaveLength(1)
    expect(handles.signalInserts[0]).toHaveLength(2)
  })

  it('does NOT do the legacy two-step insert/update on receipt_rules', async () => {
    const handles = makeMockSupabase()
    mockedCreateAdminClient.mockReturnValue(handles.supabase)

    await performApproveReceiptRuleSuggestion('user-1', 'sug-1')

    const fromMock = (handles.supabase as { from: Mock }).from
    const rulesCalls = fromMock.mock.calls.filter((call) => call[0] === 'receipt_rules')
    // Only the read-back select on receipt_rules — never an insert.
    expect(rulesCalls).toHaveLength(1)
  })

  it('returns an error and records no signals when the RPC fails', async () => {
    const handles = makeMockSupabase({ defaultRpc: { ruleId: null, error: { message: 'boom' } } })
    mockedCreateAdminClient.mockReturnValue(handles.supabase)

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-1')

    expect(result.error).toBeTruthy()
    expect(result.success).toBeUndefined()
    expect(handles.rpcMock).toHaveBeenCalledTimes(1)
    expect(handles.signalInserts).toHaveLength(0)
  })
})

describe('performApproveReceiptRuleSuggestions (bulk)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the RPC once per id and counts successes', async () => {
    const handles = makeMockSupabase({ defaultRpc: { ruleId: 'rule-x', error: null } })
    mockedCreateAdminClient.mockReturnValue(handles.supabase)

    const result = await performApproveReceiptRuleSuggestions('user-1', ['a', 'b', 'c'], { active: true })

    expect(result).toEqual({ approved: 3, failed: 0 })
    expect(handles.rpcMock).toHaveBeenCalledTimes(3)
  })

  it('does not abort the batch when one id fails', async () => {
    const handles = makeMockSupabase({
      rpcResults: {
        a: { ruleId: 'rule-a', error: null },
        b: { ruleId: null, error: { message: 'nope' } },
        c: { ruleId: 'rule-c', error: null },
      },
    })
    mockedCreateAdminClient.mockReturnValue(handles.supabase)

    const result = await performApproveReceiptRuleSuggestions('user-1', ['a', 'b', 'c'])

    expect(result).toEqual({ approved: 2, failed: 1 })
    expect(handles.rpcMock).toHaveBeenCalledTimes(3)
  })
})
