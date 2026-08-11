import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
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

  it('blocks markMessageAsRead without message write permission', async () => {
    mockedPermission.mockResolvedValue(false)

    await expect(markMessageAsRead('message-1')).rejects.toThrow('Insufficient permissions')
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  // Marking a conversation unread now restores EVERY inbound message and email
  // for the customer, which is the mirror image of what opening the thread does.
  // It previously restored only the most recent inbound row, resolved through the
  // customer_communications view, so the unread count never came back and a
  // customer whose latest inbound entry was feedback broke the action outright.
  it('restores every inbound message and email, on both tables', async () => {
    const calls: Array<{ table: string; values: Record<string, unknown>; filters: string[] }> = []

    const chainFor = (table: string, values: Record<string, unknown>) => {
      const filters: string[] = []
      calls.push({ table, values, filters })
      const chain: Record<string, unknown> = {}
      chain.eq = vi.fn((column: string) => {
        filters.push(column)
        return chain
      })
      chain.not = vi.fn((column: string) => {
        filters.push(`not:${column}`)
        return chain
      })
      chain.then = (resolve: (value: { error: null }) => unknown) => resolve({ error: null })
      return chain
    }

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'messages' && table !== 'email_messages') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return { update: vi.fn((values: Record<string, unknown>) => chainFor(table, values)) }
      }),
    })

    await expect(markConversationAsUnread('customer-1')).resolves.not.toThrow()

    expect(calls.map((c) => c.table).sort()).toEqual(['email_messages', 'messages'])
    for (const call of calls) {
      // Scoped to inbound rows for this customer that are actually read, so the
      // update touches nothing it does not need to.
      expect(call.filters.slice(0, 2)).toEqual(['customer_id', 'direction'])
      expect(call.filters[2]).toMatch(/^not:/)
    }
    expect(calls.find((c) => c.table === 'messages')?.values).toMatchObject({ read_at: null })
    expect(calls.find((c) => c.table === 'email_messages')?.values).toMatchObject({
      staff_read_at: null,
    })
  })

  it('surfaces a database failure rather than reporting the conversation unread', async () => {
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn(() => {
          const chain: Record<string, unknown> = {}
          chain.eq = vi.fn(() => chain)
          chain.not = vi.fn(() => chain)
          chain.then = (resolve: (value: { error: { message: string } }) => unknown) =>
            resolve({ error: { message: 'permission denied' } })
          return chain
        }),
      })),
    })

    await expect(markConversationAsUnread('customer-1')).rejects.toThrow('permission denied')
  })
})
