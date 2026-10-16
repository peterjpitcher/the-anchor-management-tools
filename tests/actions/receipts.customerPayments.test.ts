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

vi.mock('@/services/receipts/receiptPaymentConfirmations', () => ({
  loadCustomerPaymentsToConfirm: vi.fn(),
  performConfirmCustomerPayment: vi.fn(),
  performDismissCustomerPayment: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import {
  loadCustomerPaymentsToConfirm,
  performConfirmCustomerPayment,
  performDismissCustomerPayment,
} from '@/services/receipts/receiptPaymentConfirmations'
import { confirmCustomerPayment, dismissCustomerPayment, getCustomerPaymentsToConfirm } from '@/app/actions/receipts'

const mockedPermission = checkUserPermission as unknown as Mock
const MATCH = '44444444-4444-4444-8444-444444444444'

function allow(granted: Record<string, boolean>) {
  mockedPermission.mockImplementation(async (module: string, action: string) => granted[`${module}.${action}`] ?? false)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getCurrentUser as unknown as Mock).mockResolvedValue({ user_id: 'user-1', user_email: 'owner@example.com' })
  ;(performConfirmCustomerPayment as unknown as Mock).mockResolvedValue({ success: true, invoiceNumbers: ['INV-003W8'] })
  ;(performDismissCustomerPayment as unknown as Mock).mockResolvedValue({ success: true })
  ;(loadCustomerPaymentsToConfirm as unknown as Mock).mockResolvedValue([])
})

describe('confirmCustomerPayment', () => {
  it('needs both receipts manage and invoices edit', async () => {
    allow({ 'receipts.manage': true })

    expect(await confirmCustomerPayment({ matchId: MATCH, optionIndex: 0 })).toEqual({ error: 'Insufficient permissions' })
    expect(performConfirmCustomerPayment).not.toHaveBeenCalled()
  })

  it('refuses a choice it cannot read before doing anything', async () => {
    allow({ 'receipts.manage': true, 'invoices.edit': true })

    expect(await confirmCustomerPayment({ matchId: 'not-an-id', optionIndex: 0 })).toEqual({
      error: 'That choice could not be read. Nothing was recorded.',
    })
    expect(await confirmCustomerPayment({ matchId: MATCH, optionIndex: -1 })).toEqual({
      error: 'That choice could not be read. Nothing was recorded.',
    })
    expect(performConfirmCustomerPayment).not.toHaveBeenCalled()
  })

  it('carries out the choice as the signed-in person, audits it and refreshes receipts and invoices', async () => {
    allow({ 'receipts.manage': true, 'invoices.edit': true })

    const result = await confirmCustomerPayment({ matchId: MATCH, optionIndex: 1 })

    expect(result).toEqual({ success: true, invoiceNumbers: ['INV-003W8'] })
    expect(performConfirmCustomerPayment).toHaveBeenCalledWith({ matchId: MATCH, optionIndex: 1, userId: 'user-1' })
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'confirm_customer_payment', resource_id: MATCH, operation_status: 'success', user_id: 'user-1' })
    )
    expect(revalidatePath).toHaveBeenCalledWith('/receipts')
    expect(revalidatePath).toHaveBeenCalledWith('/invoices')
  })

  it('audits a refusal and refreshes nothing', async () => {
    allow({ 'receipts.manage': true, 'invoices.edit': true })
    ;(performConfirmCustomerPayment as unknown as Mock).mockResolvedValue({ error: 'This payment has already been dealt with.' })

    expect(await confirmCustomerPayment({ matchId: MATCH, optionIndex: 0 })).toEqual({ error: 'This payment has already been dealt with.' })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'failure' }))
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('confirmCustomerPayment when something unexpected fails', () => {
  it('still writes the audit entry and says so plainly', async () => {
    allow({ 'receipts.manage': true, 'invoices.edit': true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(performConfirmCustomerPayment as unknown as Mock).mockRejectedValue(new Error('connection reset'))

    expect(await confirmCustomerPayment({ matchId: MATCH, optionIndex: 0 })).toEqual({
      error: 'The payment could not be confirmed. Refresh the page to see where it stands.',
    })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'confirm_customer_payment', operation_status: 'failure' }))
  })
})

describe('dismissCustomerPayment', () => {
  it('needs receipts manage', async () => {
    allow({ 'receipts.view': true })

    expect(await dismissCustomerPayment({ matchId: MATCH })).toEqual({ error: 'Insufficient permissions' })
    expect(performDismissCustomerPayment).not.toHaveBeenCalled()
  })

  it('takes the payment off the list as the signed-in person', async () => {
    allow({ 'receipts.manage': true })

    expect(await dismissCustomerPayment({ matchId: MATCH })).toEqual({ success: true })
    expect(performDismissCustomerPayment).toHaveBeenCalledWith({ matchId: MATCH, userId: 'user-1' })
  })
})

describe('getCustomerPaymentsToConfirm', () => {
  it('shows nothing without receipts view', async () => {
    allow({})

    expect(await getCustomerPaymentsToConfirm()).toEqual({ items: [], error: 'Insufficient permissions' })
    expect(loadCustomerPaymentsToConfirm).not.toHaveBeenCalled()
  })

  it('says so when the list cannot be loaded, rather than showing an empty list as all clear', async () => {
    allow({ 'receipts.view': true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(loadCustomerPaymentsToConfirm as unknown as Mock).mockRejectedValue(new Error('timeout'))

    expect(await getCustomerPaymentsToConfirm()).toEqual({ items: [], error: 'The customer payments to confirm could not be loaded.' })
  })
})
