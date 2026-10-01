import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Who may do what to the vendor list, and that every change names the person who made it.
 *
 *   viewer        reads the list
 *   manager       confirms, deactivates, sets kind and default category
 *   super admin   merges, renames and undoes
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

vi.mock('@/services/receipts/receiptVendors', () => ({
  performMergeReceiptVendor: vi.fn(),
  performRenameReceiptVendor: vi.fn(),
  performUndoReceiptVendorOperation: vi.fn(),
  performUpdateReceiptVendorDetails: vi.fn(),
  queryReceiptVendorDirectory: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { currentUserCanGovernReceiptRules } from '@/app/actions/receipts'
import {
  performMergeReceiptVendor,
  performRenameReceiptVendor,
  performUndoReceiptVendorOperation,
  performUpdateReceiptVendorDetails,
  queryReceiptVendorDirectory,
} from '@/services/receipts/receiptVendors'
import {
  getReceiptVendorDirectory,
  mergeReceiptVendors,
  renameReceiptVendor,
  undoReceiptVendorOperation,
  updateReceiptVendorDetails,
} from '@/app/actions/receipt-vendors'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedSuperAdmin = currentUserCanGovernReceiptRules as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedMerge = performMergeReceiptVendor as unknown as Mock
const mockedRename = performRenameReceiptVendor as unknown as Mock
const mockedUndo = performUndoReceiptVendorOperation as unknown as Mock
const mockedDetails = performUpdateReceiptVendorDetails as unknown as Mock
const mockedDirectory = queryReceiptVendorDirectory as unknown as Mock

const ACTOR = { user_id: 'user-1', user_email: 'someone@example.com' }
const FROM = '11111111-1111-4111-8111-111111111111'
const INTO = '22222222-2222-4222-8222-222222222222'
const OPERATION = '33333333-3333-4333-8333-333333333333'

type Role = 'none' | 'viewer' | 'manager' | 'super_admin'

function signInAs(role: Role) {
  mockedPermission.mockImplementation(async (_module: string, action: string) => {
    if (role === 'none') return false
    if (action === 'view') return true
    return role === 'manager' || role === 'super_admin'
  })
  mockedSuperAdmin.mockResolvedValue(role === 'super_admin')
  mockedGetCurrentUser.mockResolvedValue(ACTOR)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedMerge.mockResolvedValue({ success: true, operationId: OPERATION, fromName: 'Oak Farm Gas Co Ltd', toName: 'Oak Farm Gas Co', transactions: 7, rules: 1 })
  mockedRename.mockResolvedValue({ success: true, operationId: OPERATION, fromName: 'Veolia', toName: 'Veolia UK', transactions: 4, rules: 0 })
  mockedUndo.mockResolvedValue({ success: true, operation: 'merge', transactionsRestored: 6, transactionConflicts: 1, rulesRestored: 1, ruleConflicts: 0 })
  mockedDetails.mockResolvedValue({ success: true, name: 'Tesco', before: { status: 'unconfirmed' }, after: { status: 'confirmed' } })
  mockedDirectory.mockResolvedValue({ vendors: [], possibleDuplicates: [], recentOperations: [] })
})

describe('reading the vendor list', () => {
  it('is refused without receipts view', async () => {
    signInAs('none')

    await expect(getReceiptVendorDirectory()).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(mockedDirectory).not.toHaveBeenCalled()
  })

  it('is allowed for a viewer', async () => {
    signInAs('viewer')

    await expect(getReceiptVendorDirectory()).resolves.toEqual({ directory: { vendors: [], possibleDuplicates: [], recentOperations: [] } })
  })

  it('reports a failed read as an error, not as an empty list', async () => {
    signInAs('viewer')
    mockedDirectory.mockRejectedValue(new Error('receipt vendor directory failed: timeout'))

    await expect(getReceiptVendorDirectory()).resolves.toEqual({ error: 'The vendor list could not be loaded.' })
  })
})

describe.each([
  ['merge', () => mergeReceiptVendors({ fromVendorId: FROM, intoVendorId: INTO }), mockedMerge],
  ['rename', () => renameReceiptVendor({ vendorId: FROM, name: 'Veolia UK' }), mockedRename],
  ['undo', () => undoReceiptVendorOperation(OPERATION), mockedUndo],
] as const)('%s', (_name, call, service) => {
  it('is refused for a viewer', async () => {
    signInAs('viewer')

    await expect(call()).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(service).not.toHaveBeenCalled()
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('is refused for a manager who is not a super admin', async () => {
    signInAs('manager')

    await expect(call()).resolves.toEqual({ error: 'Only a super admin can merge, rename or undo vendor changes.' })
    expect(service).not.toHaveBeenCalled()
  })

  it('runs for a super admin, as that person, and is audited under their name', async () => {
    signInAs('super_admin')

    const result = await call()

    expect(result).toMatchObject({ success: true })
    expect(service).toHaveBeenCalledTimes(1)
    expect(service.mock.calls[0][0]).toBe(ACTOR.user_id)
    expect(mockedAudit).toHaveBeenCalledTimes(1)
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      user_id: ACTOR.user_id,
      user_email: ACTOR.user_email,
      operation_status: 'success',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/receipts/vendors/manage')
  })

  it('audits a refusal from the database as a failure and refreshes nothing', async () => {
    signInAs('super_admin')
    service.mockResolvedValue({ error: 'Nothing was changed.' })

    await expect(call()).resolves.toEqual({ error: 'Nothing was changed.' })
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      user_id: ACTOR.user_id,
      operation_status: 'failure',
      error_message: 'Nothing was changed.',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('what the audit entry records', () => {
  it('a merge names both vendors and how much moved', async () => {
    signInAs('super_admin')

    await mergeReceiptVendors({ fromVendorId: FROM, intoVendorId: INTO })

    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      operation_type: 'merge',
      resource_type: 'receipt_vendor',
      resource_id: INTO,
      additional_info: {
        from_vendor_id: FROM,
        into_vendor_id: INTO,
        from_name: 'Oak Farm Gas Co Ltd',
        into_name: 'Oak Farm Gas Co',
        transactions: 7,
        rules: 1,
        operation_id: OPERATION,
      },
    })
  })

  it('a rename records the old and new name', async () => {
    signInAs('super_admin')

    await renameReceiptVendor({ vendorId: FROM, name: 'Veolia UK' })

    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      operation_type: 'rename',
      resource_id: FROM,
      old_values: { name: 'Veolia' },
      new_values: { name: 'Veolia UK' },
    })
  })

  it('an undo records what was put back and what was left', async () => {
    signInAs('super_admin')

    await undoReceiptVendorOperation(OPERATION)

    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      operation_type: 'undo',
      resource_type: 'receipt_vendor_operation',
      resource_id: OPERATION,
      additional_info: { operation: 'merge', transactions_restored: 6, transaction_conflicts: 1, rules_restored: 1 },
    })
  })
})

describe('confirming, deactivating and describing a vendor', () => {
  it('is refused for a viewer', async () => {
    signInAs('viewer')

    await expect(updateReceiptVendorDetails({ vendorId: FROM, status: 'confirmed' })).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(mockedDetails).not.toHaveBeenCalled()
  })

  it('is allowed for a manager, and audited with before and after', async () => {
    signInAs('manager')

    await expect(updateReceiptVendorDetails({ vendorId: FROM, status: 'confirmed' })).resolves.toEqual({ success: true })
    expect(mockedDetails).toHaveBeenCalledWith({ vendorId: FROM, status: 'confirmed' })
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      user_id: ACTOR.user_id,
      operation_type: 'update',
      resource_type: 'receipt_vendor',
      resource_id: FROM,
      old_values: { status: 'unconfirmed' },
      new_values: { status: 'confirmed' },
    })
  })

  it('writes no audit entry when nothing was changed', async () => {
    signInAs('manager')
    mockedDetails.mockResolvedValue({ error: 'That vendor no longer exists.' })

    await expect(updateReceiptVendorDetails({ vendorId: FROM, status: 'confirmed' })).resolves.toEqual({ error: 'That vendor no longer exists.' })
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('refuses to act for someone who is not signed in', async () => {
    signInAs('super_admin')
    mockedGetCurrentUser.mockResolvedValue({ user_id: null, user_email: null })

    await expect(mergeReceiptVendors({ fromVendorId: FROM, intoVendorId: INTO })).rejects.toThrow('Unauthorized')
    expect(mockedMerge).not.toHaveBeenCalled()
  })
})
