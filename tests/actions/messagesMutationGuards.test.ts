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

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { markConversationAsUnread, markMessageAsRead } from '@/app/actions/messagesActions'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('Message action mutation row-effect guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  it('throws not-found when markMessageAsRead update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eqDirection = vi.fn().mockReturnValue({ select })
    const eqId = vi.fn().mockReturnValue({ eq: eqDirection })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'messages') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq: eqId }),
        }
      }),
    })

    await expect(markMessageAsRead('message-1')).rejects.toThrow('Message not found')
  })

  it('throws not-found when markConversationAsUnread latest-message update affects no rows', async () => {
    const latestMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'message-1' },
      error: null,
    })
    const latestLimit = vi.fn().mockReturnValue({ maybeSingle: latestMaybeSingle })
    const latestOrder = vi.fn().mockReturnValue({ limit: latestLimit })
    const latestEqDirection = vi.fn().mockReturnValue({ order: latestOrder })
    const latestEqCustomer = vi.fn().mockReturnValue({ eq: latestEqDirection })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'messages') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: latestEqCustomer }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(markConversationAsUnread('customer-1')).rejects.toThrow('Message not found')
  })
})
