import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a rule save does to the review mark (`receipt_rules.reviewed_at` and `reviewed_by`).
 *
 * The rule form has a "Mark reviewed" box, shown only to someone who governs rules. The save
 * read it from the form and then validated the form with a schema that had no `reviewed` key,
 * so the tick was stripped before the write and the box never saved. Worse, an edit that
 * changed what a reviewed rule matched or did then cleared the mark even with the box ticked,
 * which un-reviewed two live rules on 2 October 2026.
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

const ME = 'user-1'
const EARLIER_REVIEWER = 'user-earlier'
const EARLIER_REVIEW = '2026-09-01T09:00:00.000Z'
const NOW = '2026-10-02T10:00:00.000Z'

/**
 * A database holding one rule, applying any update to it. `governs` is the answer to the
 * super-admin check, which decides whether the person saving may set priority, kind and the
 * review mark.
 */
function buildDatabase(options: { governs: boolean; reviewed?: boolean }) {
  const row: Record<string, unknown> = {
    id: 'rule-1',
    name: 'HMRC PAYE auto-tag',
    description: null,
    priority: 1000,
    kind: 'standard',
    match_description: 'HMRC PAYE',
    match_transaction_type: null,
    match_direction: 'out',
    match_min_amount: null,
    match_max_amount: null,
    auto_status: 'no_receipt_required',
    set_vendor_name: null,
    set_expense_category: null,
    set_no_category: false,
    vendor_id: null,
    is_active: true,
    reviewed_at: options.reviewed ? EARLIER_REVIEW : null,
    reviewed_by: options.reviewed ? EARLIER_REVIEWER : null,
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
        // A plain read is the list of rules, used for the duplicate check.
        return { data: [{ ...row }], error: null }
      },
    },
    rpc: (fn) => (fn === 'is_super_admin' ? { data: options.governs, error: null } : { data: null, error: null }),
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return { db, row, inserted }
}

/** The fields the rule edit form sends for the stored rule, unchanged unless overridden. */
function editFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData()
  formData.set('name', 'HMRC PAYE auto-tag')
  formData.set('match_description', 'HMRC PAYE')
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

/** A new rule that is not a duplicate of the stored one. */
function newRuleFormData(overrides: Record<string, string> = {}): FormData {
  return editFormData({ name: 'Amex settlement', match_description: 'AMERICAN EXPRESS', ...overrides })
}

// A ticked checkbox with no value of its own is sent as "on".
const TICKED = { reviewed: 'on' }
// What the rule matches is part of its behaviour; its name is not.
const BEHAVIOUR_CHANGE = { match_description: 'HMRC PAYE, HMRC NIC' }
const RENAME_ONLY = { name: 'HMRC PAYE and NIC' }

function updatePayload(db: ReturnType<typeof buildDatabase>['db']): Record<string, unknown> {
  const write = db.queries.find((query) => query.table === 'receipt_rules' && called(query, 'update'))
  return firstArgsOf(write!, 'update')![0] as Record<string, unknown>
}

describe('the "Mark reviewed" box on a receipt rule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    vi.mocked(checkUserPermission).mockResolvedValue(true)
    vi.mocked(getCurrentUser).mockResolvedValue({
      user_id: ME,
      user_email: 'owner@the-anchor.pub',
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('for someone who governs rules', () => {
    it('creates a rule as reviewed when the box is ticked', async () => {
      const { inserted } = buildDatabase({ governs: true })

      const result = await createReceiptRule(newRuleFormData(TICKED))

      expect('success' in result && result.success).toBe(true)
      expect(inserted).toHaveLength(1)
      expect(inserted[0].reviewed_at).toBe(NOW)
      expect(inserted[0].reviewed_by).toBe(ME)
    })

    it('creates a rule as not reviewed when the box is left empty', async () => {
      const { inserted } = buildDatabase({ governs: true })

      const result = await createReceiptRule(newRuleFormData())

      expect('success' in result && result.success).toBe(true)
      expect(inserted[0].reviewed_at ?? null).toBeNull()
      expect(inserted[0].reviewed_by ?? null).toBeNull()
    })

    it('marks an unreviewed rule reviewed when the box is ticked and nothing else changes', async () => {
      const { row } = buildDatabase({ governs: true })

      const result = await updateReceiptRule('rule-1', editFormData(TICKED))

      expect('success' in result && result.success).toBe(true)
      expect(row.reviewed_at).toBe(NOW)
      expect(row.reviewed_by).toBe(ME)
    })

    it('keeps the earlier review when the box stays ticked and the rule still does the same thing', async () => {
      const { db, row } = buildDatabase({ governs: true, reviewed: true })

      const result = await updateReceiptRule('rule-1', editFormData({ ...TICKED, ...RENAME_ONLY }))

      expect('success' in result && result.success).toBe(true)
      expect(row.name).toBe('HMRC PAYE and NIC')
      expect(row.reviewed_at).toBe(EARLIER_REVIEW)
      expect(row.reviewed_by).toBe(EARLIER_REVIEWER)
      expect(updatePayload(db)).not.toHaveProperty('reviewed_at')
      expect(updatePayload(db)).not.toHaveProperty('reviewed_by')
    })

    it('keeps a reviewed rule reviewed, by the person saving, when its behaviour changes with the box ticked', async () => {
      const { row } = buildDatabase({ governs: true, reviewed: true })

      const result = await updateReceiptRule('rule-1', editFormData({ ...TICKED, ...BEHAVIOUR_CHANGE }))

      expect('success' in result && result.success).toBe(true)
      expect(row.match_description).toBe('HMRC PAYE, HMRC NIC')
      expect(row.reviewed_at).toBe(NOW)
      expect(row.reviewed_by).toBe(ME)
    })

    it('clears the review when the behaviour changes and the box is not ticked', async () => {
      const { row } = buildDatabase({ governs: true, reviewed: true })

      const result = await updateReceiptRule('rule-1', editFormData(BEHAVIOUR_CHANGE))

      expect('success' in result && result.success).toBe(true)
      expect(row.reviewed_at).toBeNull()
      expect(row.reviewed_by).toBeNull()
    })

    it('clears the review when the box is unticked, even with nothing else changed', async () => {
      const { row } = buildDatabase({ governs: true, reviewed: true })

      const result = await updateReceiptRule('rule-1', editFormData())

      expect('success' in result && result.success).toBe(true)
      expect(row.reviewed_at).toBeNull()
      expect(row.reviewed_by).toBeNull()
    })

    it('saves the priority and kind from the form', async () => {
      const { row, inserted } = buildDatabase({ governs: true })

      await updateReceiptRule('rule-1', editFormData({ priority: '5', kind: 'tax' }))
      await createReceiptRule(newRuleFormData({ priority: '20', kind: 'income_settlement' }))

      expect(row.priority).toBe(5)
      expect(row.kind).toBe('tax')
      expect(inserted[0].priority).toBe(20)
      expect(inserted[0].kind).toBe('income_settlement')
    })
  })

  describe('for a manager who does not govern rules', () => {
    it('cannot create a reviewed rule by sending the field', async () => {
      const { inserted } = buildDatabase({ governs: false })

      const result = await createReceiptRule(newRuleFormData(TICKED))

      expect('success' in result && result.success).toBe(true)
      expect(inserted[0].reviewed_at ?? null).toBeNull()
      expect(inserted[0].reviewed_by ?? null).toBeNull()
    })

    it('cannot mark a rule reviewed by sending the field', async () => {
      const { db, row } = buildDatabase({ governs: false })

      const result = await updateReceiptRule('rule-1', editFormData({ ...TICKED, ...RENAME_ONLY }))

      expect('success' in result && result.success).toBe(true)
      expect(row.reviewed_at).toBeNull()
      expect(row.reviewed_by).toBeNull()
      expect(updatePayload(db)).not.toHaveProperty('reviewed_at')
    })

    it('leaves an existing review alone when the rule still does the same thing', async () => {
      const { db, row } = buildDatabase({ governs: false, reviewed: true })

      // Their form has no box, so no `reviewed` field arrives at all.
      const result = await updateReceiptRule('rule-1', editFormData(RENAME_ONLY))

      expect('success' in result && result.success).toBe(true)
      expect(row.reviewed_at).toBe(EARLIER_REVIEW)
      expect(row.reviewed_by).toBe(EARLIER_REVIEWER)
      expect(updatePayload(db)).not.toHaveProperty('reviewed_at')
    })

    it('still loses the review on a behaviour change, and cannot keep it by sending the field', async () => {
      const { row } = buildDatabase({ governs: false, reviewed: true })

      const result = await updateReceiptRule('rule-1', editFormData({ ...TICKED, ...BEHAVIOUR_CHANGE }))

      expect('success' in result && result.success).toBe(true)
      expect(row.reviewed_at).toBeNull()
      expect(row.reviewed_by).toBeNull()
    })

    it('cannot set the priority or kind by sending the fields', async () => {
      const { db, inserted } = buildDatabase({ governs: false })

      await updateReceiptRule('rule-1', editFormData({ priority: '5', kind: 'tax' }))
      await createReceiptRule(newRuleFormData({ priority: '20', kind: 'income_settlement' }))

      expect(updatePayload(db)).not.toHaveProperty('priority')
      expect(updatePayload(db)).not.toHaveProperty('kind')
      expect(inserted[0]).not.toHaveProperty('priority')
      expect(inserted[0]).not.toHaveProperty('kind')
    })
  })
})
