import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Who may act on the AI's suggestions, and that every change names the person who made it.
 *
 *   viewer    sees what the AI could not do
 *   manager   accepts, changes and dismisses suggestions, accepts a vendor's together, retries
 *
 * A suggested category is only ever written because someone with `receipts:manage` said yes.
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

vi.mock('@/services/receipts/receiptAiReview', () => ({
  performAcceptVendorCategoryProposals: vi.fn(),
  performDecideReceiptAiCategory: vi.fn(),
  queryOpenCategoryProposals: vi.fn(),
  queryReceiptAiStatus: vi.fn(),
}))

vi.mock('@/services/receipts/receiptMutations', () => ({
  performRequeueUnclassifiedTransactions: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import {
  performAcceptVendorCategoryProposals,
  performDecideReceiptAiCategory,
  queryOpenCategoryProposals,
  queryReceiptAiStatus,
} from '@/services/receipts/receiptAiReview'
import { performRequeueUnclassifiedTransactions } from '@/services/receipts/receiptMutations'
import {
  acceptVendorCategoryProposals,
  decideReceiptAiCategory,
  getReceiptAiStatus,
  getReceiptCategoryProposals,
  retryFailedReceiptClassification,
} from '@/app/actions/receipt-ai'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedDecide = performDecideReceiptAiCategory as unknown as Mock
const mockedAcceptAll = performAcceptVendorCategoryProposals as unknown as Mock
const mockedProposals = queryOpenCategoryProposals as unknown as Mock
const mockedStatus = queryReceiptAiStatus as unknown as Mock
const mockedRequeue = performRequeueUnclassifiedTransactions as unknown as Mock
const mockedRevalidatePath = revalidatePath as unknown as Mock

const ACTOR = { user_id: 'user-1', user_email: 'someone@example.com' }
const TX = '11111111-1111-4111-8111-111111111111'
const VENDOR = '22222222-2222-4222-8222-222222222222'

type Role = 'none' | 'viewer' | 'manager'

function signInAs(role: Role) {
  mockedPermission.mockImplementation(async (_module: string, action: string) => {
    if (role === 'none') return false
    if (role === 'viewer') return action === 'view'
    return action === 'view' || action === 'manage'
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetCurrentUser.mockResolvedValue(ACTOR)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('decideReceiptAiCategory', () => {
  it.each(['none', 'viewer'] as Role[])('refuses a %s, and does nothing', async (role) => {
    signInAs(role)

    const result = await decideReceiptAiCategory({ transactionId: TX, decision: 'accept' })

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedDecide).not.toHaveBeenCalled()
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('asks for the manage permission on receipts', async () => {
    signInAs('manager')
    mockedDecide.mockResolvedValue({ success: true, decision: 'accept', transaction: { id: TX } })

    await decideReceiptAiCategory({ transactionId: TX, decision: 'accept' })

    expect(mockedPermission).toHaveBeenCalledWith('receipts', 'manage')
  })

  it('accepts as the signed-in person, and records who did it', async () => {
    signInAs('manager')
    mockedDecide.mockResolvedValue({
      success: true,
      decision: 'accept',
      transaction: { id: TX, expense_category: 'Telephone', no_category_applies: false },
    })

    const result = await decideReceiptAiCategory({ transactionId: TX, decision: 'accept' })

    expect(mockedDecide).toHaveBeenCalledWith('user-1', {
      transactionId: TX,
      decision: 'accept',
      expenseCategory: null,
      noCategoryApplies: false,
    })
    expect(result).toMatchObject({ success: true, transaction: { id: TX, expense_category: 'Telephone' } })
    expect(mockedAudit).toHaveBeenCalledWith({
      user_id: 'user-1',
      user_email: 'someone@example.com',
      operation_type: 'ai_category_accept',
      resource_type: 'receipt_transaction',
      resource_id: TX,
      operation_status: 'success',
      additional_info: { decision: 'accept', expense_category: 'Telephone', no_category_applies: false },
    })
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/receipts')
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/receipts/pnl')
  })

  it('passes on a changed category and "no category applies"', async () => {
    signInAs('manager')
    mockedDecide.mockResolvedValue({ success: true, decision: 'edit', transaction: { id: TX, no_category_applies: true } })

    await decideReceiptAiCategory({ transactionId: TX, decision: 'edit', noCategoryApplies: true })

    expect(mockedDecide).toHaveBeenCalledWith('user-1', expect.objectContaining({ decision: 'edit', noCategoryApplies: true }))
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'ai_category_edit',
        additional_info: expect.objectContaining({ no_category_applies: true }),
      })
    )
  })

  it('writes no audit entry and refreshes nothing when nothing was saved', async () => {
    signInAs('manager')
    mockedDecide.mockResolvedValue({ error: 'This transaction has been categorised in the meantime.', superseded: true, transaction: { id: TX } })

    const result = await decideReceiptAiCategory({ transactionId: TX, decision: 'accept' })

    expect(result).toMatchObject({ error: expect.stringMatching(/in the meantime/), superseded: true, transaction: { id: TX } })
    expect(mockedAudit).not.toHaveBeenCalled()
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })

  it('does not act for somebody who is not signed in', async () => {
    signInAs('manager')
    mockedGetCurrentUser.mockResolvedValue({ user_id: null, user_email: null })

    await expect(decideReceiptAiCategory({ transactionId: TX, decision: 'accept' })).rejects.toThrow('Unauthorized')
    expect(mockedDecide).not.toHaveBeenCalled()
  })
})

describe('acceptVendorCategoryProposals', () => {
  it.each(['none', 'viewer'] as Role[])('refuses a %s, and does nothing', async (role) => {
    signInAs(role)

    expect(await acceptVendorCategoryProposals({ vendorId: VENDOR })).toEqual({ error: 'Insufficient permissions' })
    expect(mockedAcceptAll).not.toHaveBeenCalled()
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('accepts as the signed-in person and records the run', async () => {
    signInAs('manager')
    mockedAcceptAll.mockResolvedValue({ success: true, runId: 'run-1', accepted: 12, skippedChanged: 1, skippedLocked: 2 })

    const result = await acceptVendorCategoryProposals({ vendorId: VENDOR })

    expect(mockedAcceptAll).toHaveBeenCalledWith('user-1', { vendorId: VENDOR })
    expect(result).toMatchObject({ success: true, accepted: 12 })
    expect(mockedAudit).toHaveBeenCalledWith({
      user_id: 'user-1',
      user_email: 'someone@example.com',
      operation_type: 'ai_category_accept_all',
      resource_type: 'receipt_vendor',
      resource_id: VENDOR,
      operation_status: 'success',
      error_message: undefined,
      additional_info: { run_id: 'run-1', accepted: 12, skipped_changed: 1, skipped_locked: 2 },
    })
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/receipts/bulk')
  })

  it('treats a missing or empty vendor as the "no vendor yet" group', async () => {
    signInAs('manager')
    mockedAcceptAll.mockResolvedValue({ success: true, runId: 'run-1', accepted: 1 })

    await acceptVendorCategoryProposals({ vendorId: '' as never })

    expect(mockedAcceptAll).toHaveBeenCalledWith('user-1', { vendorId: null })
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ resource_id: 'no_vendor' }))
  })

  it('records a failure, and still refreshes when some were written before it stopped', async () => {
    signInAs('manager')
    mockedAcceptAll.mockResolvedValue({ error: 'Accepting stopped part-way.', runId: 'run-1', accepted: 4 })

    const result = await acceptVendorCategoryProposals({ vendorId: VENDOR })

    expect(result.error).toMatch(/stopped part-way/)
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_status: 'failure',
        error_message: 'Accepting stopped part-way.',
        additional_info: expect.objectContaining({ run_id: 'run-1', accepted: 4 }),
      })
    )
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/receipts')
  })

  it('refreshes nothing when nothing was written', async () => {
    signInAs('manager')
    mockedAcceptAll.mockResolvedValue({ error: 'There are no open suggestions for this vendor.' })

    await acceptVendorCategoryProposals({ vendorId: VENDOR })

    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })
})

describe('getReceiptCategoryProposals', () => {
  it.each(['none', 'viewer'] as Role[])('refuses a %s', async (role) => {
    signInAs(role)

    expect(await getReceiptCategoryProposals()).toEqual({ error: 'Insufficient permissions' })
    expect(mockedProposals).not.toHaveBeenCalled()
  })

  it('returns the groups to a manager', async () => {
    signInAs('manager')
    mockedProposals.mockResolvedValue([{ vendorId: VENDOR, vendorName: 'BT', proposals: [] }])

    expect(await getReceiptCategoryProposals()).toEqual({ groups: [{ vendorId: VENDOR, vendorName: 'BT', proposals: [] }] })
  })

  it('says so when they cannot be loaded, without the database error', async () => {
    signInAs('manager')
    mockedProposals.mockRejectedValue(new Error('relation "receipt_ai_attempts" does not exist'))

    expect(await getReceiptCategoryProposals()).toEqual({ error: 'The suggested categories could not be loaded.' })
  })
})

describe('getReceiptAiStatus', () => {
  it('refuses somebody with no access to receipts', async () => {
    signInAs('none')

    expect(await getReceiptAiStatus()).toEqual({ error: 'Insufficient permissions' })
    expect(mockedStatus).not.toHaveBeenCalled()
  })

  it('shows a viewer what the AI could not do', async () => {
    signInAs('viewer')
    mockedStatus.mockResolvedValue({ failed: 3, failedForGood: 1, payrollChecks: 2 })

    expect(await getReceiptAiStatus()).toEqual({ status: { failed: 3, failedForGood: 1, payrollChecks: 2 } })
    expect(mockedPermission).toHaveBeenCalledWith('receipts', 'view')
  })

  it('says so when it cannot be loaded', async () => {
    signInAs('viewer')
    mockedStatus.mockRejectedValue(new Error('connection reset'))

    expect(await getReceiptAiStatus()).toEqual({ error: 'The AI classification status could not be loaded.' })
  })
})

describe('retryFailedReceiptClassification', () => {
  it.each(['none', 'viewer'] as Role[])('refuses a %s, and queues nothing', async (role) => {
    signInAs(role)

    expect(await retryFailedReceiptClassification()).toEqual({ success: false, error: 'Insufficient permissions' })
    expect(mockedRequeue).not.toHaveBeenCalled()
  })

  it('sends again the ones that were given up on, and records who asked', async () => {
    signInAs('manager')
    mockedRequeue.mockResolvedValue({ success: true, queued: 7, alreadyAsked: 40 })

    const result = await retryFailedReceiptClassification()

    expect(mockedRequeue).toHaveBeenCalledWith({ retryFinalFailures: true })
    expect(result).toEqual({ success: true, queued: 7, error: undefined })
    expect(mockedAudit).toHaveBeenCalledWith({
      user_id: 'user-1',
      user_email: 'someone@example.com',
      operation_type: 'requeue',
      resource_type: 'receipt_transactions',
      operation_status: 'success',
      error_message: undefined,
      additional_info: { action: 'retry_failed_classification', queued: 7, already_asked: 40 },
    })
  })

  it('records a failure to queue', async () => {
    signInAs('manager')
    mockedRequeue.mockResolvedValue({ success: false, error: 'Failed to queue classification jobs' })

    const result = await retryFailedReceiptClassification()

    expect(result).toEqual({ success: false, queued: undefined, error: 'Failed to queue classification jobs' })
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operation_status: 'failure', error_message: 'Failed to queue classification jobs' })
    )
  })
})
