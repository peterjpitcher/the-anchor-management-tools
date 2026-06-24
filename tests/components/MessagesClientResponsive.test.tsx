import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessagesClient } from '@/app/(authenticated)/messages/_components/MessagesClient'

const push = vi.fn()
const getMessages = vi.fn()
const getConversationMessages = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    hasPermission: (_module: string, action: string) => ['send_transactional', 'manage_templates'].includes(action),
  }),
}))

vi.mock('@/app/actions/messagesActions', () => ({
  getMessages: () => getMessages(),
  getConversationMessages: (customerId: string) => getConversationMessages(customerId),
  markAllMessagesAsRead: vi.fn(),
  markConversationAsRead: vi.fn(),
  markConversationAsUnread: vi.fn(),
}))

vi.mock('@/app/actions/messageActions', () => ({
  sendSmsReply: vi.fn(),
}))

const customer = {
  id: 'customer-1',
  first_name: 'Jane',
  last_name: 'Smith',
  mobile_number: '07123456789',
  email: 'jane@example.com',
  sms_opt_in: true,
  whatsapp_opt_in: false,
  whatsapp_status: null,
}

describe('MessagesClient responsive layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMessages.mockResolvedValue({
      conversations: [
        {
          customer,
          unreadCount: 1,
          channels: ['sms'],
          lastMessage: {
            id: 'message-1',
            body: 'Hello',
            subject: null,
            channel: 'sms',
            direction: 'inbound',
            created_at: '2026-06-24T10:00:00.000Z',
            read_at: null,
            staff_read_at: null,
            has_attachments: false,
          },
          lastMessageAt: '2026-06-24T10:00:00.000Z',
        },
      ],
      totalUnread: 1,
      hasMoreUnread: false,
      unmatchedCount: 0,
    })
    getConversationMessages.mockResolvedValue({
      customer,
      messages: [],
    })
  })

  it('shows a mobile back affordance after selecting a conversation', async () => {
    render(<MessagesClient />)

    fireEvent.click(await screen.findByRole('button', { name: /Jane Smith/i }))

    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument()
    await waitFor(() => expect(getConversationMessages).toHaveBeenCalledWith('customer-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('Search conversations...')).toBeInTheDocument()
  })
})
