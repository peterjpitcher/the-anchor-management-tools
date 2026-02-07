import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/services/messages', () => ({
  MessageService: {
    getUnreadCounts: vi.fn(),
  },
}))

import { getUnreadMessageCounts } from '@/app/actions/messageActions'
import { checkUserPermission } from '@/app/actions/rbac'
import { MessageService } from '@/services/messages'

describe('getUnreadMessageCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scopes unread count lookup to requested customer IDs', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(true)
    vi.mocked(MessageService.getUnreadCounts).mockResolvedValue({
      customer_1: 2,
      customer_2: 1,
    })

    const ids = ['customer_1', 'customer_2']
    const result = await getUnreadMessageCounts(ids)

    expect(MessageService.getUnreadCounts).toHaveBeenCalledWith(ids)
    expect(result).toEqual({
      customer_1: 2,
      customer_2: 1,
    })
  })

  it('returns an empty map when the user cannot view messages', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)

    const result = await getUnreadMessageCounts(['customer_1'])

    expect(MessageService.getUnreadCounts).not.toHaveBeenCalled()
    expect(result).toEqual({})
  })
})
