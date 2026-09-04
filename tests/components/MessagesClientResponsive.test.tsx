import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessagesClient } from '@/app/(authenticated)/messages/_components/MessagesClient'

const push = vi.fn()
const replace = vi.fn()
const getMessages = vi.fn()
const getConversationMessages = vi.fn()
const markConversationAsRead = vi.fn()
const markConversationAsUnread = vi.fn()
const markAllMessagesAsRead = vi.fn()
const searchConversations = vi.fn()
const sendSmsReply = vi.fn()

/**
 * The selected conversation lives in the URL, so the router mock is a real
 * subscribable store. A plain mutable variable would change without telling
 * React, and every assertion about the thread would then race the router.
 */
const urlStore = vi.hoisted(() => {
  let search = ''
  const listeners = new Set<() => void>()
  return {
    get: () => search,
    reset: () => {
      search = ''
    },
    set: (url: string) => {
      search = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
})

let permissionSet = new Set(['view', 'send_transactional', 'manage_templates', 'send_marketing'])

vi.mock('next/navigation', async () => {
  const React = await import('react')
  return {
    useRouter: () => ({
      push: (url: string) => {
        push(url)
        urlStore.set(url)
      },
      replace: (url: string) => {
        replace(url)
        urlStore.set(url)
      },
    }),
    usePathname: () => '/messages',
    useSearchParams: () => {
      const search = React.useSyncExternalStore(urlStore.subscribe, urlStore.get, urlStore.get)
      return new URLSearchParams(search)
    },
  }
})

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    hasPermission: (_module: string, action: string) => permissionSet.has(action),
  }),
}))

vi.mock('@/app/actions/messagesActions', () => ({
  getMessages: () => getMessages(),
  getConversationMessages: (customerId: string, options?: unknown) =>
    getConversationMessages(customerId, options),
  markAllMessagesAsRead: () => markAllMessagesAsRead(),
  markConversationAsRead: (customerId: string) => markConversationAsRead(customerId),
  markConversationAsUnread: (customerId: string) => markConversationAsUnread(customerId),
  searchConversations: (query: string) => searchConversations(query),
}))

vi.mock('@/app/actions/messageActions', () => ({
  sendSmsReply: (customerId: string, message: string) => sendSmsReply(customerId, message),
}))

function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'customer-1',
    first_name: 'Jane',
    last_name: 'Smith',
    mobile_number: '07123456789',
    email: 'jane@example.com',
    sms_opt_in: true,
    whatsapp_opt_in: false,
    whatsapp_status: null,
    ...overrides,
  }
}

function conversation(overrides: Record<string, unknown> = {}) {
  const cust = (overrides.customer as ReturnType<typeof customer>) ?? customer()
  return {
    customer: cust,
    unreadCount: 1,
    channels: ['sms'],
    lastMessage: {
      id: `message-${cust.id}`,
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
    ...overrides,
  }
}

function inbox(overrides: Record<string, unknown> = {}) {
  return {
    conversations: [conversation()],
    totalUnread: 1,
    unreadIsCapped: false,
    hasMoreUnread: false,
    unmatchedCount: 0,
    ...overrides,
  }
}

/** Drive the layout branch the component reads from matchMedia. */
function setViewport(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.clearAllMocks()
  urlStore.reset()
  permissionSet = new Set(['view', 'send_transactional', 'manage_templates', 'send_marketing'])
  setViewport(true)
  getMessages.mockResolvedValue(inbox())
  getConversationMessages.mockResolvedValue({ customer: customer(), messages: [], hasOlder: false })
  markConversationAsRead.mockResolvedValue(undefined)
  markConversationAsUnread.mockResolvedValue({ success: true })
  markAllMessagesAsRead.mockResolvedValue(undefined)
  searchConversations.mockResolvedValue({ conversations: [] })
  sendSmsReply.mockResolvedValue({ success: true, status: 'queued' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MessagesClient, selection and layout', () => {
  it('shows a back affordance and returns to the list on the one-pane layout', async () => {
    setViewport(false)
    const { rerender } = render(<MessagesClient />)

    fireEvent.click(await screen.findByRole('option', { name: /Jane Smith/i }))
    rerender(<MessagesClient />)

    const back = await screen.findByRole('button', { name: 'Back to conversations' })
    fireEvent.click(back)
    rerender(<MessagesClient />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Back to conversations' })).not.toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('Search name, phone or email...')).toBeInTheDocument()
  })

  it('puts the selected conversation in the URL so Back and refresh work', async () => {
    render(<MessagesClient />)
    await screen.findByRole('option', { name: /Jane Smith/i })
    // Auto-selection replaces rather than pushing, so it does not fill history.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages?customer=customer-1'))
  })
})

describe('MessagesClient, read state', () => {
  it('does not mark a conversation read on the one-pane layout until it is opened', async () => {
    setViewport(false)
    render(<MessagesClient />)

    await screen.findByRole('option', { name: /Jane Smith/i })
    // The old build auto-selected the first unread row and marked it read while
    // the user was still looking at the list, so unread work vanished unseen.
    await waitFor(() => expect(getMessages).toHaveBeenCalled())
    expect(markConversationAsRead).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('marks read once the thread is on screen and loaded', async () => {
    render(<MessagesClient />)
    await waitFor(() => expect(markConversationAsRead).toHaveBeenCalledWith('customer-1'))
  })

  it('never touches read state for a view-only user', async () => {
    permissionSet = new Set(['view'])
    render(<MessagesClient />)

    await screen.findByRole('option', { name: /Jane Smith/i })
    await waitFor(() => expect(getConversationMessages).toHaveBeenCalled())
    // Calling it produced a permission error toast on every conversation open.
    expect(markConversationAsRead).not.toHaveBeenCalled()
  })

  it('hides mark-unread from a user who cannot write read state', async () => {
    permissionSet = new Set(['view'])
    render(<MessagesClient />)

    fireEvent.click(await screen.findByRole('button', { name: 'Conversation actions' }))
    expect(screen.queryByText(/Mark whole conversation unread/i)).not.toBeInTheDocument()
  })

  it('says that mark unread affects the whole conversation', async () => {
    render(<MessagesClient />)
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation actions' }))
    expect(await screen.findByText('Mark whole conversation unread')).toBeInTheDocument()
  })
})

describe('MessagesClient, stale responses', () => {
  it('never renders one customer under another customer name', async () => {
    const slow = customer({ id: 'customer-1', first_name: 'Jane' })
    const fast = customer({ id: 'customer-2', first_name: 'Sam', last_name: 'Patel' })

    getMessages.mockResolvedValue(
      inbox({
        conversations: [
          conversation({ customer: slow }),
          conversation({ customer: fast, unreadCount: 0 }),
        ],
        totalUnread: 1,
      }),
    )

    // Customer 1's response is held open deliberately, so the ordering is
    // explicit rather than a race against a timer.
    let releaseSlow: (() => void) | undefined
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })

    getConversationMessages.mockImplementation(async (customerId: string) => {
      if (customerId === 'customer-1') {
        await slowGate
        return { customer: slow, messages: [], hasOlder: false }
      }
      return { customer: fast, messages: [], hasOlder: false }
    })

    render(<MessagesClient />)
    fireEvent.click(await screen.findByRole('option', { name: /Sam Patel/i }))

    await waitFor(() => {
      expect(screen.getByRole('log').getAttribute('aria-label')).toContain('Sam Patel')
    })

    // Now let customer 1's stale response land. It must be discarded.
    releaseSlow?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    await waitFor(() => {
      expect(screen.getByRole('log').getAttribute('aria-label')).toContain('Sam Patel')
    })
    expect(screen.getByRole('log').getAttribute('aria-label')).not.toContain('Jane')
  })
})

describe('MessagesClient, composer eligibility', () => {
  it('blocks and explains an SMS opt-out', async () => {
    const optedOut = customer({ sms_opt_in: false })
    getMessages.mockResolvedValue(inbox({ conversations: [conversation({ customer: optedOut })] }))
    getConversationMessages.mockResolvedValue({ customer: optedOut, messages: [], hasOlder: false })

    render(<MessagesClient />)

    expect(await screen.findByText('This customer has opted out of SMS')).toBeInTheDocument()
    // Scoped to the composer: the search box is also a textbox.
    expect(screen.queryByPlaceholderText('Reply by SMS...')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open customer profile' })).toBeInTheDocument()
  })

  it('blocks when SMS consent has never been recorded', async () => {
    const unknown = customer({ sms_opt_in: null })
    getMessages.mockResolvedValue(inbox({ conversations: [conversation({ customer: unknown })] }))
    getConversationMessages.mockResolvedValue({ customer: unknown, messages: [], hasOlder: false })

    render(<MessagesClient />)
    expect(await screen.findByText('SMS consent is not recorded')).toBeInTheDocument()
  })

  it('blocks when there is no mobile number to send to', async () => {
    const noNumber = customer({ mobile_number: null })
    getMessages.mockResolvedValue(inbox({ conversations: [conversation({ customer: noNumber })] }))
    getConversationMessages.mockResolvedValue({ customer: noNumber, messages: [], hasOlder: false })

    render(<MessagesClient />)
    expect(await screen.findByText('No mobile number on file')).toBeInTheDocument()
  })

  it('tells a view-only user why they cannot reply', async () => {
    permissionSet = new Set(['view'])
    render(<MessagesClient />)
    expect(await screen.findByText('You cannot send messages')).toBeInTheDocument()
  })

  it('names the SMS destination in the composer', async () => {
    render(<MessagesClient />)
    const composer = await screen.findByPlaceholderText('Reply by SMS...')
    // The number is announced, and shown in the helper line rather than the
    // placeholder, which clipped it at 375px.
    expect(composer).toHaveAttribute('aria-label', 'Reply by SMS to 07123456789')
    expect(screen.getByText(/Replies send by SMS to 07123456789/)).toBeInTheDocument()
  })
})

describe('MessagesClient, send outcomes', () => {
  async function typeAndSend() {
    const composer = await screen.findByPlaceholderText('Reply by SMS...')
    fireEvent.change(composer, { target: { value: 'On our way' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/i }))
    return composer as HTMLTextAreaElement
  }

  it('clears the draft after a real send', async () => {
    render(<MessagesClient />)
    const composer = await typeAndSend()
    await waitFor(() => expect(composer.value).toBe(''))
  })

  it('keeps the draft when the send failed', async () => {
    sendSmsReply.mockResolvedValue({ error: 'Twilio rejected the message' })
    render(<MessagesClient />)
    const composer = await typeAndSend()
    await waitFor(() => expect(sendSmsReply).toHaveBeenCalled())
    expect(composer.value).toBe('On our way')
  })

  it('keeps the draft when the message was suppressed as a duplicate', async () => {
    sendSmsReply.mockResolvedValue({ success: true, suppressed: true })
    render(<MessagesClient />)
    const composer = await typeAndSend()
    await waitFor(() => expect(sendSmsReply).toHaveBeenCalled())
    expect(composer.value).toBe('On our way')
  })

  it('sends on Ctrl+Enter and inserts a newline on plain Enter', async () => {
    render(<MessagesClient />)
    const composer = await screen.findByPlaceholderText('Reply by SMS...')
    fireEvent.change(composer, { target: { value: 'Two lines' } })

    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(sendSmsReply).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(sendSmsReply).toHaveBeenCalledWith('customer-1', 'Two lines'))
  })

  it('does not send mid-composition for an IME user', async () => {
    render(<MessagesClient />)
    const composer = await screen.findByPlaceholderText('Reply by SMS...')
    fireEvent.change(composer, { target: { value: 'こんにちは' } })
    fireEvent.compositionStart(composer)
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })
    expect(sendSmsReply).not.toHaveBeenCalled()
  })
})

describe('MessagesClient, honesty about data', () => {
  it('shows a lower bound rather than an exact count when unread is capped', async () => {
    getMessages.mockResolvedValue(
      inbox({ totalUnread: 500, unreadIsCapped: true, hasMoreUnread: true }),
    )
    render(<MessagesClient />)
    expect(await screen.findByText('500+ unread messages')).toBeInTheDocument()
    expect(screen.getByText(/lower bound/i)).toBeInTheDocument()
  })

  it('shows an error with a retry rather than an empty inbox when loading fails', async () => {
    getMessages.mockResolvedValue({ error: 'Failed to load messages' })
    render(<MessagesClient />)

    expect(await screen.findByText('Could not load conversations')).toBeInTheDocument()
    expect(screen.queryByText('No conversations')).not.toBeInTheDocument()

    getMessages.mockResolvedValue(inbox())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('option', { name: /Jane Smith/i })).toBeInTheDocument())
  })

  it('says the list is a recent window, not the whole history', async () => {
    render(<MessagesClient />)
    expect(await screen.findByText(/Showing recent conversations/i)).toBeInTheDocument()
  })
})

describe('MessagesClient, filters and search', () => {
  it('intersects the unread and channel filters', async () => {
    getMessages.mockResolvedValue(
      inbox({
        conversations: [
          conversation({ customer: customer({ id: 'a', first_name: 'Ada', last_name: 'Textonly' }) }),
          conversation({
            customer: customer({ id: 'b', first_name: 'Bea', last_name: 'Mailonly' }),
            channels: ['email'],
          }),
          conversation({
            customer: customer({ id: 'c', first_name: 'Cal', last_name: 'Alreadyread' }),
            unreadCount: 0,
          }),
        ],
        totalUnread: 2,
      }),
    )

    render(<MessagesClient />)
    await screen.findByRole('option', { name: /Cal Alreadyread/i })

    fireEvent.click(screen.getByRole('button', { name: /^Unread/ }))
    fireEvent.change(screen.getByLabelText('Filter by channel'), { target: { value: 'email' } })

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Ada Textonly/i })).not.toBeInTheDocument()
    })
    // Unread AND email: only Bea satisfies both.
    expect(screen.getByRole('option', { name: /Bea Mailonly/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Cal Alreadyread/i })).not.toBeInTheDocument()
  })

  it('searches on the server so older conversations are reachable', async () => {
    searchConversations.mockResolvedValue({
      conversations: [
        conversation({ customer: customer({ id: 'old', first_name: 'Old', last_name: 'Customer' }) }),
      ],
    })

    render(<MessagesClient />)
    fireEvent.change(await screen.findByPlaceholderText('Search name, phone or email...'), {
      target: { value: 'Old' },
    })

    await waitFor(() => expect(searchConversations).toHaveBeenCalledWith('Old'), { timeout: 2000 })
    expect(await screen.findByRole('option', { name: /Old Customer/i })).toBeInTheDocument()
    expect(screen.getByText(/including older conversations/i)).toBeInTheDocument()
  })

  it('does not hit the server for a one-character query', async () => {
    render(<MessagesClient />)
    fireEvent.change(await screen.findByPlaceholderText('Search name, phone or email...'), {
      target: { value: 'J' },
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(searchConversations).not.toHaveBeenCalled()
  })
})

describe('MessagesClient, header actions', () => {
  it('gates the bulk link on send_marketing, matching the destination page', async () => {
    permissionSet = new Set(['view', 'send_transactional'])
    render(<MessagesClient />)
    await screen.findByRole('option', { name: /Jane Smith/i })
    // Showing this to a user without send_marketing sent them to /unauthorized.
    expect(screen.queryByRole('button', { name: 'Bulk message' })).not.toBeInTheDocument()
  })

  it('shows the bulk link to a marketing sender', async () => {
    render(<MessagesClient />)
    expect(await screen.findByRole('button', { name: 'Bulk message' })).toBeInTheDocument()
  })

  it('keeps the header to one primary button plus an overflow menu', async () => {
    render(<MessagesClient />)
    await screen.findByRole('option', { name: /Jane Smith/i })

    const header = screen.getByRole('heading', { name: 'Messages' }).closest('div')?.parentElement
    expect(within(header as HTMLElement).getByRole('button', { name: 'Bulk message' })).toBeInTheDocument()
    expect(
      within(header as HTMLElement).getByRole('button', { name: 'More inbox actions' }),
    ).toBeInTheDocument()
    expect(within(header as HTMLElement).queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  it('confirms before marking every conversation read', async () => {
    // Two unread conversations, so opening the first still leaves unread work
    // and the bulk action stays offered.
    getMessages.mockResolvedValue(
      inbox({
        conversations: [
          conversation(),
          conversation({
            customer: customer({ id: 'customer-2', first_name: 'Sam', last_name: 'Patel' }),
            unreadCount: 2,
          }),
        ],
        totalUnread: 3,
      }),
    )

    render(<MessagesClient />)
    // Let the inbox settle first. Opening the menu mid-load re-renders its
    // items, and clicking a node React has already detached fires nothing.
    await screen.findByRole('option', { name: /Sam Patel/i })
    await waitFor(() => expect(markConversationAsRead).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'More inbox actions' }))
    fireEvent.click(await screen.findByText('Mark all read'))

    expect(await screen.findByText('Mark every conversation as read?')).toBeInTheDocument()
    // The bulk clear only runs once it has been confirmed.
    expect(markAllMessagesAsRead).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(markAllMessagesAsRead).toHaveBeenCalled())
  })
})

describe('MessagesClient, drafts', () => {
  it('keeps a per-customer draft when the conversation changes', async () => {
    const jane = customer()
    const sam = customer({ id: 'customer-2', first_name: 'Sam', last_name: 'Patel' })
    getMessages.mockResolvedValue(
      inbox({
        conversations: [conversation({ customer: jane }), conversation({ customer: sam, unreadCount: 0 })],
      }),
    )
    getConversationMessages.mockImplementation(async (customerId: string) => ({
      customer: customerId === 'customer-2' ? sam : jane,
      messages: [],
      hasOlder: false,
    }))

    const { rerender } = render(<MessagesClient />)

    const composer = await screen.findByPlaceholderText('Reply by SMS...')
    fireEvent.change(composer, { target: { value: 'Half a reply' } })

    fireEvent.click(screen.getByRole('option', { name: /Sam Patel/i }))
    rerender(<MessagesClient />)
    await waitFor(() => expect(getConversationMessages).toHaveBeenCalledWith('customer-2', undefined))

    fireEvent.click(screen.getByRole('option', { name: /Jane Smith/i }))
    rerender(<MessagesClient />)

    // Switching used to discard whatever had been typed.
    await waitFor(() => {
      const restored = screen.getByPlaceholderText('Reply by SMS...') as HTMLTextAreaElement
      expect(restored.value).toBe('Half a reply')
    })
  })
})

describe('MessagesClient, accessibility', () => {
  it('exposes the list as a listbox with a selected option', async () => {
    render(<MessagesClient />)
    const option = await screen.findByRole('option', { name: /Jane Smith/i })
    expect(screen.getByRole('listbox', { name: 'Conversations' })).toBeInTheDocument()
    await waitFor(() => expect(option).toHaveAttribute('aria-selected', 'true'))
  })

  it('names each row with who, unread state and the preview', async () => {
    render(<MessagesClient />)
    const option = await screen.findByRole('option', { name: /Jane Smith/i })
    expect(option.getAttribute('aria-label')).toContain('1 unread')
    expect(option.getAttribute('aria-label')).toContain('Hello')
  })

  it('exposes the thread as a polite log naming the customer', async () => {
    render(<MessagesClient />)
    const log = await screen.findByRole('log')
    expect(log).toHaveAttribute('aria-live', 'polite')
    expect(log.getAttribute('aria-label')).toContain('Jane Smith')
  })
})
