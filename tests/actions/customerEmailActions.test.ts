import { describe, expect, beforeEach, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

const authUser = { id: 'user-1', email: 'staff@example.com' }

const mockServerClient = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: authUser } })),
  },
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockServerClient),
}))

const customerLookup: { data: any; error: { message: string } | null } = {
  data: { email: 'customer@example.com', first_name: 'Jane', last_name: 'Doe' },
  error: null,
}

const singleMock = vi.fn(async () => ({ data: customerLookup.data, error: customerLookup.error }))
const mockAdminClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: singleMock,
      })),
    })),
  })),
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { sendEmail } from '@/lib/email/emailService'
import { logAuditEvent } from '@/app/actions/audit'
import { sendCustomerEmail } from '@/app/actions/customerEmailActions'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedSendEmail = sendEmail as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock

describe('sendCustomerEmail', () => {
  beforeEach(() => {
    mockedPermission.mockReset()
    mockedSendEmail.mockReset()
    mockedAudit.mockReset()
    mockAdminClient.from.mockClear()
    singleMock.mockClear()

    mockedAudit.mockResolvedValue(undefined)
    customerLookup.data = { email: 'customer@example.com', first_name: 'Jane', last_name: 'Doe' }
    customerLookup.error = null
  })

  it('should send the email to the customer address and report success on the happy path', async () => {
    mockedPermission.mockResolvedValue(true)
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })

    const result = await sendCustomerEmail('cust-1', '  Hello there  ', '  Body text  ')

    expect(result).toEqual({ success: true })
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: 'Hello there',
        text: 'Body text',
        customerId: 'cust-1',
        commType: 'customer_direct',
      }),
    )
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'send', operation_status: 'success', resource_id: 'cust-1' }),
    )
  })

  it('should return an error and not send when the customer has no email on file', async () => {
    mockedPermission.mockResolvedValue(true)
    customerLookup.data = { email: null, first_name: 'Jane', last_name: 'Doe' }

    const result = await sendCustomerEmail('cust-1', 'Hello', 'Body')

    expect(result).toEqual({ error: 'This customer has no email address on file' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('should return an error and not send when the user lacks messaging permissions', async () => {
    mockedPermission.mockResolvedValue(false)

    const result = await sendCustomerEmail('cust-1', 'Hello', 'Body')

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockAdminClient.from).not.toHaveBeenCalled()
  })

  it('should surface the sendEmail error when the provider fails', async () => {
    mockedPermission.mockResolvedValue(true)
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Recipient email address is suppressed' })

    const result = await sendCustomerEmail('cust-1', 'Hello', 'Body')

    expect(result).toEqual({ error: 'Recipient email address is suppressed' })
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'send', operation_status: 'failure' }),
    )
  })
})
