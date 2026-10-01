import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Who may run a rule over existing payments, undo a run, and change the lock date or the matcher.
 *
 *   viewer        reads recent runs and settings, tests a description
 *   manager       previews, runs and undoes a rule over pending payments; sees rule health
 *   super admin   the same over all history; sets the lock date and the matcher
 *
 * Permission is checked on every step: a run is several requests, and a role can change between
 * them.
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

vi.mock('@/app/actions/receipts', () => ({
  currentUserCanGovernReceiptRules: vi.fn(),
}))

vi.mock('@/services/receipts/receiptRuleRuns', () => ({
  performApplyReceiptRuleRunStep: vi.fn(),
  performPreviewReceiptRuleRun: vi.fn(),
  performUndoReceiptRuleRunStep: vi.fn(),
  queryReceiptRuleHealth: vi.fn(),
  queryReceiptRuleRun: vi.fn(),
  queryReceiptRuleTest: vi.fn(),
  queryRecentReceiptRuleRuns: vi.fn(),
  queryRuleMatcherComparison: vi.fn(),
}))

vi.mock('@/services/receipts/receiptSettings', () => ({
  performSetReceiptsLockDate: vi.fn(),
  performSetRuleMatcher: vi.fn(),
  queryReceiptSettings: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { currentUserCanGovernReceiptRules } from '@/app/actions/receipts'
import {
  performApplyReceiptRuleRunStep,
  performPreviewReceiptRuleRun,
  performUndoReceiptRuleRunStep,
  queryReceiptRuleHealth,
  queryReceiptRuleRun,
  queryReceiptRuleTest,
  queryRecentReceiptRuleRuns,
  queryRuleMatcherComparison,
} from '@/services/receipts/receiptRuleRuns'
import { performSetReceiptsLockDate, performSetRuleMatcher, queryReceiptSettings } from '@/services/receipts/receiptSettings'
import {
  applyReceiptRuleRunStep,
  getReceiptRuleHealth,
  getReceiptSettings,
  getRecentReceiptRuleRuns,
  getRuleMatcherComparison,
  previewReceiptRuleRun,
  setReceiptRuleMatcher,
  setReceiptsLockDate,
  testReceiptRules,
  undoReceiptRuleRunStep,
} from '@/app/actions/receipt-rules'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedSuperAdmin = currentUserCanGovernReceiptRules as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedPreview = performPreviewReceiptRuleRun as unknown as Mock
const mockedApply = performApplyReceiptRuleRunStep as unknown as Mock
const mockedUndo = performUndoReceiptRuleRunStep as unknown as Mock
const mockedRun = queryReceiptRuleRun as unknown as Mock
const mockedLock = performSetReceiptsLockDate as unknown as Mock
const mockedMatcher = performSetRuleMatcher as unknown as Mock

const ME = 'user-1'
const SOMEONE_ELSE = 'user-2'
const RULE = '11111111-1111-4111-8111-111111111111'
const RUN = '55555555-5555-4555-8555-555555555555'

type Role = 'none' | 'viewer' | 'manager' | 'super_admin'

function signInAs(role: Role) {
  mockedPermission.mockImplementation(async (_module: string, action: string) => {
    if (role === 'none') return false
    if (action === 'view') return true
    return role === 'manager' || role === 'super_admin'
  })
  mockedSuperAdmin.mockResolvedValue(role === 'super_admin')
  mockedGetCurrentUser.mockResolvedValue({ user_id: ME, user_email: 'me@example.com' })
}

function run(overrides: Record<string, unknown> = {}) {
  return { id: RUN, kind: 'rule_run', ruleId: RULE, label: 'Acme', scope: 'pending', status: 'previewed', planned: 3, applied: 0, createdBy: ME, ...overrides }
}

const PREVIEW = { success: true, runId: RUN, ruleName: 'Acme', scope: 'pending', lockDate: null, reviewed: 10, matched: 4, planned: 3, protectedCount: 1, locked: 0, samples: [] }
const FIRST_STEP = { success: true, done: false, applied: 200, skippedChanged: 0, skippedLocked: 0, remaining: 50, appliedTotal: 200, skippedChangedTotal: 0, skippedLockedTotal: 0 }
const LAST_STEP = { success: true, done: true, applied: 50, skippedChanged: 1, skippedLocked: 0, remaining: 0, appliedTotal: 250, skippedChangedTotal: 1, skippedLockedTotal: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  mockedPreview.mockResolvedValue(PREVIEW)
  mockedApply.mockResolvedValue(LAST_STEP)
  mockedUndo.mockResolvedValue({ success: true, done: true, restored: 3, conflicts: 0, remaining: 0, restoredTotal: 3, conflictTotal: 0 })
  mockedRun.mockResolvedValue(run())
  mockedLock.mockResolvedValue({ success: true, previous: null, current: '2026-03-31' })
  mockedMatcher.mockResolvedValue({ success: true, previous: 'substring' })
  ;(queryRecentReceiptRuleRuns as unknown as Mock).mockResolvedValue([])
  ;(queryReceiptSettings as unknown as Mock).mockResolvedValue({ lockDate: null, matcher: 'substring' })
  ;(queryReceiptRuleHealth as unknown as Mock).mockResolvedValue({ reviewed: 0, matcher: 'substring', items: [] })
  ;(queryReceiptRuleTest as unknown as Mock).mockResolvedValue({ matched: [], status: null, vendor: null, category: null, matcher: 'substring' })
  ;(queryRuleMatcherComparison as unknown as Mock).mockResolvedValue({ reviewed: 0, paymentsAffected: 0, differences: [], byRule: [], matcher: 'substring', truncated: false })
})

describe('previewing a run', () => {
  it('is refused for a viewer', async () => {
    signInAs('viewer')

    await expect(previewReceiptRuleRun({ ruleId: RULE })).resolves.toEqual({ success: false, error: 'Insufficient permissions' })
    expect(mockedPreview).not.toHaveBeenCalled()
  })

  it('a manager previews pending transactions, under their own name', async () => {
    signInAs('manager')

    await expect(previewReceiptRuleRun({ ruleId: RULE })).resolves.toMatchObject({ success: true, runId: RUN })
    expect(mockedPreview).toHaveBeenCalledWith(ME, { ruleId: RULE, scope: 'pending' })
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      user_id: ME,
      operation_type: 'retro_run_previewed',
      resource_id: RULE,
      additional_info: { run_id: RUN, scope: 'pending', planned: 3 },
    })
  })

  it('a manager cannot preview all history; a super admin can', async () => {
    signInAs('manager')
    await expect(previewReceiptRuleRun({ ruleId: RULE, scope: 'all' })).resolves.toEqual({
      success: false,
      error: 'Only super admins can run a rule over all historical transactions.',
    })
    expect(mockedPreview).not.toHaveBeenCalled()

    signInAs('super_admin')
    await previewReceiptRuleRun({ ruleId: RULE, scope: 'all' })
    expect(mockedPreview).toHaveBeenCalledWith(ME, { ruleId: RULE, scope: 'all' })
  })

  it('treats any scope it does not know as pending', async () => {
    signInAs('manager')

    await previewReceiptRuleRun({ ruleId: RULE, scope: 'everything' as 'all' })

    expect(mockedPreview).toHaveBeenCalledWith(ME, { ruleId: RULE, scope: 'pending' })
  })
})

describe('applying a run', () => {
  it('is refused for a viewer', async () => {
    signInAs('viewer')

    await expect(applyReceiptRuleRunStep(RUN)).resolves.toEqual({ success: false, error: 'Insufficient permissions' })
    expect(mockedApply).not.toHaveBeenCalled()
  })

  it('is refused when the preview was made by someone else', async () => {
    signInAs('manager')
    mockedRun.mockResolvedValue(run({ createdBy: SOMEONE_ELSE }))

    await expect(applyReceiptRuleRunStep(RUN)).resolves.toEqual({
      success: false,
      error: 'That preview was made by someone else. Preview the rule yourself before running it.',
    })
    expect(mockedApply).not.toHaveBeenCalled()
  })

  it('a run over all history is refused for a manager on every step, even one they previewed', async () => {
    signInAs('manager')
    mockedRun.mockResolvedValue(run({ scope: 'all' }))

    await expect(applyReceiptRuleRunStep(RUN)).resolves.toEqual({
      success: false,
      error: 'Only super admins can run a rule over all historical transactions.',
    })
    expect(mockedApply).not.toHaveBeenCalled()
  })

  it('is refused when the preview no longer exists', async () => {
    signInAs('manager')
    mockedRun.mockResolvedValue(null)

    await expect(applyReceiptRuleRunStep(RUN)).resolves.toEqual({
      success: false,
      error: 'That preview no longer exists. Preview the rule again.',
    })
  })

  it('audits the start of a run and its end, and refreshes the screens once it is done', async () => {
    signInAs('manager')

    mockedApply.mockResolvedValueOnce(FIRST_STEP)
    await applyReceiptRuleRunStep(RUN)
    expect(mockedAudit).toHaveBeenCalledTimes(1)
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({ user_id: ME, operation_type: 'retro_run_started', operation_status: 'success' })
    expect(revalidatePath).not.toHaveBeenCalled()

    // A step in the middle is not audited again.
    mockedApply.mockResolvedValueOnce({ ...FIRST_STEP, applied: 50, appliedTotal: 250, remaining: 10 })
    await applyReceiptRuleRunStep(RUN)
    expect(mockedAudit).toHaveBeenCalledTimes(1)

    mockedApply.mockResolvedValueOnce(LAST_STEP)
    await applyReceiptRuleRunStep(RUN)
    expect(mockedAudit).toHaveBeenCalledTimes(2)
    expect(mockedAudit.mock.calls[1][0]).toMatchObject({
      user_id: ME,
      operation_type: 'retro_run',
      operation_status: 'success',
      resource_id: RULE,
      additional_info: { run_id: RUN, applied: 250, skipped_changed: 1, remaining: 0 },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/receipts')
  })

  it('audits a stale preview as a failure and refreshes nothing', async () => {
    signInAs('manager')
    mockedApply.mockResolvedValue({ success: false, stale: true, error: 'The rule has been changed since it was previewed. Preview it again.' })

    const step = await applyReceiptRuleRunStep(RUN)

    expect(step).toMatchObject({ success: false, stale: true })
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      operation_type: 'retro_run',
      operation_status: 'failure',
      error_message: 'The rule has been changed since it was previewed. Preview it again.',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('undoing a run', () => {
  it('is refused for a viewer', async () => {
    signInAs('viewer')

    await expect(undoReceiptRuleRunStep(RUN)).resolves.toEqual({ success: false, error: 'Insufficient permissions' })
    expect(mockedUndo).not.toHaveBeenCalled()
  })

  it('a manager undoes a run over pending transactions, whoever ran it', async () => {
    signInAs('manager')
    mockedRun.mockResolvedValue(run({ createdBy: SOMEONE_ELSE, status: 'completed', applied: 3 }))

    await expect(undoReceiptRuleRunStep(RUN)).resolves.toMatchObject({ success: true, done: true, restoredTotal: 3 })
    expect(mockedUndo).toHaveBeenCalledWith(ME, RUN)
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      user_id: ME,
      operation_type: 'retro_run_undone',
      operation_status: 'success',
      additional_info: { run_id: RUN, restored: 3, conflicts: 0 },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/receipts')
  })

  it('a run over all history can only be undone by a super admin', async () => {
    signInAs('manager')
    mockedRun.mockResolvedValue(run({ scope: 'all', status: 'completed' }))
    await expect(undoReceiptRuleRunStep(RUN)).resolves.toEqual({
      success: false,
      error: 'Only super admins can undo a run over all historical transactions.',
    })
    expect(mockedUndo).not.toHaveBeenCalled()

    signInAs('super_admin')
    await expect(undoReceiptRuleRunStep(RUN)).resolves.toMatchObject({ success: true })
  })
})

describe('the lock date and the matcher', () => {
  it.each([
    ['lock date', () => setReceiptsLockDate('2026-03-31'), mockedLock],
    ['matcher', () => setReceiptRuleMatcher('word'), mockedMatcher],
  ] as const)('the %s cannot be changed by a viewer or a manager', async (_name, call, service) => {
    signInAs('viewer')
    await expect(call()).resolves.toEqual({ error: 'Insufficient permissions' })

    signInAs('manager')
    await expect(call()).resolves.toEqual({ error: 'Only a super admin can change this setting.' })

    expect(service).not.toHaveBeenCalled()
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('a super admin sets the lock date, and the old and new dates are audited', async () => {
    signInAs('super_admin')

    await expect(setReceiptsLockDate(' 2026-03-31 ')).resolves.toEqual({ success: true })
    expect(mockedLock).toHaveBeenCalledWith(ME, '2026-03-31')
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      user_id: ME,
      operation_type: 'set_lock_date',
      operation_status: 'success',
      old_values: { locked_before: null },
      new_values: { locked_before: '2026-03-31' },
    })
  })

  it('an empty value removes the lock', async () => {
    signInAs('super_admin')
    mockedLock.mockResolvedValue({ success: true, previous: '2026-03-31', current: null })

    await setReceiptsLockDate('')

    expect(mockedLock).toHaveBeenCalledWith(ME, null)
  })

  it('a refused lock date is audited as a failure', async () => {
    signInAs('super_admin')
    mockedLock.mockResolvedValue({ error: 'Enter a real date, or clear the lock.' })

    await expect(setReceiptsLockDate('2026-02-31')).resolves.toEqual({ error: 'Enter a real date, or clear the lock.' })
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({ operation_status: 'failure', error_message: 'Enter a real date, or clear the lock.' })
  })

  it('a super admin switches the matcher, audited with the old and new mode', async () => {
    signInAs('super_admin')

    await expect(setReceiptRuleMatcher('word')).resolves.toEqual({ success: true })
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      operation_type: 'set_rule_matcher',
      old_values: { rule_matcher: 'substring' },
      new_values: { rule_matcher: 'word' },
    })
  })

  it('the comparison of the two matchers is for super admins', async () => {
    signInAs('manager')
    await expect(getRuleMatcherComparison()).resolves.toEqual({ error: 'Only a super admin can change this setting.' })

    signInAs('super_admin')
    await expect(getRuleMatcherComparison()).resolves.toMatchObject({ comparison: { paymentsAffected: 0 } })
  })
})

describe('reading', () => {
  it('a viewer reads recent runs and settings and tests a description, and nothing without view', async () => {
    signInAs('viewer')
    await expect(getRecentReceiptRuleRuns()).resolves.toEqual({ runs: [] })
    await expect(getReceiptSettings()).resolves.toEqual({ settings: { lockDate: null, matcher: 'substring' } })
    await expect(testReceiptRules({ details: 'ACME LTD' })).resolves.toMatchObject({ result: { matched: [] } })

    signInAs('none')
    await expect(getRecentReceiptRuleRuns()).resolves.toEqual({ error: 'Insufficient permissions' })
    await expect(getReceiptSettings()).resolves.toEqual({ error: 'Insufficient permissions' })
    await expect(testReceiptRules({ details: 'ACME LTD' })).resolves.toEqual({ error: 'Insufficient permissions' })
  })

  it('rule health is worked out for a manager, not a viewer', async () => {
    signInAs('viewer')
    await expect(getReceiptRuleHealth()).resolves.toEqual({ error: 'Insufficient permissions' })

    signInAs('manager')
    await expect(getReceiptRuleHealth()).resolves.toEqual({ health: { reviewed: 0, matcher: 'substring', items: [] } })
  })

  it('the test box needs a description, and tidies what it is given', async () => {
    signInAs('viewer')

    await expect(testReceiptRules({ details: '   ' })).resolves.toEqual({ error: 'Paste a bank description to test.' })

    await testReceiptRules({ details: '  ACME LTD  ', direction: 'sideways' as 'in', amount: -5 })
    expect(queryReceiptRuleTest).toHaveBeenCalledWith({ details: 'ACME LTD', transactionType: null, direction: 'out', amount: 0 })
  })

  it('reports a failed read as an error, not as an empty answer', async () => {
    signInAs('manager')
    ;(queryRecentReceiptRuleRuns as unknown as Mock).mockRejectedValue(new Error('timeout'))
    ;(queryReceiptRuleHealth as unknown as Mock).mockRejectedValue(new Error('timeout'))

    await expect(getRecentReceiptRuleRuns()).resolves.toEqual({ error: 'The recent runs could not be loaded.' })
    await expect(getReceiptRuleHealth()).resolves.toEqual({ error: 'Rule health could not be worked out.' })
  })
})
