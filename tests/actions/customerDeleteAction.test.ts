import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * The deleteCustomer action (BK-161): the audit row names the record by id only, so it never
 * becomes the last copy of the guest's name, phone and email, and a refusal reaches the screen.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/services/customers', () => ({ CustomerService: { deleteCustomer: vi.fn() } }))

import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { CustomerService } from '@/services/customers'
import { deleteCustomer } from '@/app/actions/customers'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedDelete = CustomerService.deleteCustomer as unknown as Mock

describe('deleteCustomer action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } }, error: null }) },
    })
  })

  it('audits the delete by id and counts, with no personal data', async () => {
    mockedDelete.mockResolvedValue({ message: 'Personal data erased. customers: 1.', counts: { customers: 1 }, unscrubbedRows: 0 })

    const result = await deleteCustomer('customer-1')

    expect(result).toEqual({ success: true, message: 'Personal data erased. customers: 1.' })
    const audit = mockedAudit.mock.calls[0][0]
    expect(audit).toMatchObject({
      operation_type: 'delete',
      resource_type: 'customer',
      resource_id: 'customer-1',
      old_values: { id: 'customer-1' },
      additional_info: { anonymised: true, rows_scrubbed: { customers: 1 }, rows_left_unscrubbed: 0 },
    })
    expect(JSON.stringify(audit)).not.toMatch(/mobile|email_address|first_name|\+44/)
  })

  it('passes a refusal back to the screen and writes no audit row', async () => {
    mockedDelete.mockRejectedValue(new Error('This customer has 1 table booking coming up. Cancel or move it before deleting the customer, so the booking keeps its contact details.'))

    const result = await deleteCustomer('customer-1')

    expect(result).toEqual({
      error: 'This customer has 1 table booking coming up. Cancel or move it before deleting the customer, so the booking keeps its contact details.',
    })
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('still needs customers manage', async () => {
    mockedPermission.mockResolvedValue(false)

    const result = await deleteCustomer('customer-1')

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedDelete).not.toHaveBeenCalled()
  })
})
