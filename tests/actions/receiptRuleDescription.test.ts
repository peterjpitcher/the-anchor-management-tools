import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a rule save does to `receipt_rules.description`.
 *
 * The rule edit form has no description input, and the write used to put `description ?? null`
 * in the update payload, so every edit blanked the description written by the approve-suggestion
 * RPC, the group-rule path or a seed migration. The rule list then showed "Matches: ..." instead
 * of the label someone had written. An absent description now means "leave it alone", while a
 * blank description field still clears it, which is what the other prefilled fields do.
 */

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

vi.mock('@/lib/receipts/ai-classification', () => ({
  recordAIUsage: vi.fn(),
}))

vi.mock('@/lib/receipts/rule-matching', () => ({
  selectBestReceiptRule: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: {
    enqueue: vi.fn().mockResolvedValue({ success: true }),
  },
}))

vi.mock('@/lib/openai', () => ({
  classifyReceiptTransaction: vi.fn(),
}))

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createReceiptRule, updateReceiptRule } from '@/app/actions/receipts'
import { called, createRecordingSupabase, firstArgsOf } from '../mocks/recordingSupabase'

const STORED_DESCRIPTION = 'Outgoing staff wage payments for Jacob Williams.'

/** A database holding one rule that already has a description, applying any update to it. */
function buildDatabase() {
  const row: Record<string, unknown> = {
    id: 'rule-1',
    name: 'Jacob Williams wages',
    description: STORED_DESCRIPTION,
    match_description: 'Jacob Williams The Anchor',
    match_transaction_type: 'FASTER PAYMENT',
    match_direction: 'out',
    auto_status: 'no_receipt_required',
    is_active: true,
  }
  const inserted: Record<string, unknown>[] = []

  const db = createRecordingSupabase({
    tables: {
      receipt_rules: (query) => {
        if (called(query, 'insert')) {
          const created = { id: 'rule-new', ...(firstArgsOf(query, 'insert')?.[0] as Record<string, unknown>) }
          inserted.push(created)
          return { data: created, error: null }
        }
        if (called(query, 'update')) {
          Object.assign(row, firstArgsOf(query, 'update')?.[0])
          return { data: { ...row }, error: null }
        }
        return { data: { ...row }, error: null }
      },
      // Read by the governance check: no super-admin role, so priority and kind are left alone.
      user_roles: () => ({ data: [], error: null }),
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return { db, row, inserted }
}

/** The fields the rule edit form sends: all prefilled, and no description input. */
function editFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData()
  formData.set('name', 'Jacob Williams wages')
  formData.set('match_description', 'Jacob Williams The Anchor')
  formData.set('match_transaction_type', '')
  formData.set('match_direction', 'out')
  formData.set('match_min_amount', '')
  formData.set('match_max_amount', '')
  formData.set('auto_status', 'no_receipt_required')
  formData.set('set_vendor_name', '')
  formData.set('set_expense_category', '')
  for (const [key, value] of Object.entries(overrides)) formData.set(key, value)
  return formData
}

function updatePayload(db: ReturnType<typeof buildDatabase>['db']): Record<string, unknown> {
  const write = db.queries.find((query) => query.table === 'receipt_rules' && called(query, 'update'))
  return firstArgsOf(write!, 'update')![0] as Record<string, unknown>
}

describe('receipt rule description on save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
    vi.mocked(getCurrentUser).mockResolvedValue({
      user_id: 'user-1',
      user_email: 'manager@the-anchor.pub',
    } as never)
  })

  it('keeps the stored description when the form has no description field', async () => {
    const { db, row } = buildDatabase()

    const result = await updateReceiptRule('rule-1', editFormData())

    expect('success' in result && result.success).toBe(true)
    expect(row.description).toBe(STORED_DESCRIPTION)
    expect(updatePayload(db)).not.toHaveProperty('description')
    // The fields that ARE on the form still clear when the manager empties them.
    expect(row.match_transaction_type).toBeNull()
  })

  it('clears the description when the field is sent blank', async () => {
    const { row } = buildDatabase()

    const result = await updateReceiptRule('rule-1', editFormData({ description: '' }))

    expect('success' in result && result.success).toBe(true)
    expect(row.description).toBeNull()
  })

  it('replaces the description when the field is sent with text', async () => {
    const { row } = buildDatabase()

    const result = await updateReceiptRule('rule-1', editFormData({ description: 'Wages, money out only' }))

    expect('success' in result && result.success).toBe(true)
    expect(row.description).toBe('Wages, money out only')
  })

  it('creates a rule with no description as null', async () => {
    const { inserted } = buildDatabase()

    const result = await createReceiptRule(editFormData({ name: 'New rule' }))

    expect('success' in result && result.success).toBe(true)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].description).toBeNull()
  })

  it('creates a rule with the description it was given', async () => {
    const { inserted } = buildDatabase()

    const result = await createReceiptRule(
      editFormData({ name: 'New rule', description: 'Seeded from a rule suggestion' })
    )

    expect('success' in result && result.success).toBe(true)
    expect(inserted[0].description).toBe('Seeded from a rule suggestion')
  })
})
