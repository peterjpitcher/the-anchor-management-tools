import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/dateUtils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dateUtils')>('@/lib/dateUtils')
  return {
    ...actual,
    formatDateInLondon: vi.fn(() => '14 February 2026'),
  }
})

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/audit-helpers'
import { logAuditEvent } from '@/app/actions/audit'
import { saveEmployeeAttachmentRecord } from '@/app/actions/employeeActions'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetCurrentUser = getCurrentUser as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

describe('saveEmployeeAttachmentRecord side-effect safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedGetCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'user@example.com' })
  })

  it('keeps success when post-persist side effects fail and does not delete uploaded storage path', async () => {
    mockedLogAuditEvent.mockRejectedValue(new Error('audit write failed'))

    const storageRemove = vi.fn().mockResolvedValue({ error: null })

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'employee_attachments') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        if (table === 'attachment_categories') {
          return {
            select: vi.fn(() => {
              throw new Error('side-effect lookup failed')
            }),
          }
        }

        if (table === 'employees') {
          return {
            select: vi.fn(() => ({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn() }) })),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          remove: storageRemove,
          download: vi.fn(),
        }),
      },
    }

    mockedCreateAdminClient.mockReturnValue(client)

    const formData = new FormData()
    formData.set('employee_id', '3f24f3f6-26bb-4a53-a29a-07b6acffad4f')
    formData.set('category_id', '8caa75bc-9f5b-4421-b8e8-8748b92276d2')
    formData.set('storage_path', '3f24f3f6-26bb-4a53-a29a-07b6acffad4f/doc.pdf')
    formData.set('file_name', 'doc.pdf')
    formData.set('mime_type', 'application/pdf')
    formData.set('file_size_bytes', '1024')
    formData.set('description', 'employee contract')

    const result = await saveEmployeeAttachmentRecord({ type: 'idle' }, formData)

    expect(result).toEqual({ type: 'success', message: 'Attachment uploaded successfully!' })
    expect(storageRemove).not.toHaveBeenCalled()
  })
})
