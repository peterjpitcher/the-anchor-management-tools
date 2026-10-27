import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { updateVendorContact } from '@/app/actions/vendor-contacts'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

describe('Admin action mutation row-effect guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  it('returns contact-not-found when vendor contact update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'invoice_vendor_contacts') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', 'contact-1')
    formData.set('vendorId', '550e8400-e29b-41d4-a716-446655440000')
    formData.set('email', 'a@example.com')
    formData.set('name', 'Alice')

    const result = await updateVendorContact(formData)

    expect(result).toEqual({ error: 'Contact not found' })
  })

  it('logs vendor contact updates without contact personal details', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'contact-1',
        vendor_id: '550e8400-e29b-41d4-a716-446655440000',
        role: 'accounts',
        is_primary: true,
        receive_invoice_copy: true,
      },
      error: null,
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'manager@example.com' } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'invoice_vendor_contacts') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const formData = new FormData()
    formData.set('id', 'contact-1')
    formData.set('vendorId', '550e8400-e29b-41d4-a716-446655440000')
    formData.set('email', 'accounts@example.com')
    formData.set('name', 'Alice')
    formData.set('role', 'accounts')
    formData.set('isPrimary', 'true')
    formData.set('receiveInvoiceCopy', 'true')

    const result = await updateVendorContact(formData)

    expect(result).toEqual({ success: true })
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      user_email: 'manager@example.com',
      operation_type: 'update',
      resource_type: 'invoice_vendor_contact',
      resource_id: 'contact-1',
      operation_status: 'success',
      new_values: {
        vendor_id: '550e8400-e29b-41d4-a716-446655440000',
        role: 'accounts',
        is_primary: true,
        receive_invoice_copy: true,
      },
    }))
    expect(mockedLogAuditEvent.mock.calls[0][0].new_values.email).toBeUndefined()
    expect(mockedLogAuditEvent.mock.calls[0][0].new_values.name).toBeUndefined()
  })
})
