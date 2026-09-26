// A customer's message thread, grouped by day around midnight on the London clock.
//
// MessageThread is a client component, so its first render happens on the UTC server. The day
// separators and the "Today" check read the host's zone and default locale, and so did each
// message time, so a message sent just after midnight BST was filed under the previous day and
// shown an hour early.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageThread } from '@/components/features/messages/MessageThread'
import type { CustomerCommunication } from '@/types/communications'

vi.mock('@/app/actions/messageActions', () => ({
  sendSmsReply: vi.fn(),
}))

function message(id: string, createdAt: string, body: string): CustomerCommunication {
  return {
    id,
    customer_id: 'customer-1',
    channel: 'sms',
    direction: 'inbound',
    status: 'received',
    subject: null,
    body_text: body,
    body_html: null,
    from_address: '+447700900123',
    to_address: null,
    created_at: createdAt,
    sent_at: null,
    delivered_at: null,
    failed_at: null,
    read_at: null,
    opened_at: null,
    clicked_at: null,
    bounced_at: null,
    staff_read_at: null,
    replied_at: null,
    delivery_history: [],
    has_attachments: false,
    attachments: null,
    engagement: {},
    context: {},
    twilio_message_sid: null,
    resend_message_id: null,
    cost: null,
    segments: null,
    updated_at: null,
  }
}

function dayGroup(separatorText: string): HTMLElement {
  // The separator pill sits in a centring row, inside the group that holds that day's messages.
  const group = screen.getByText(separatorText).parentElement?.parentElement
  if (!group) throw new Error(`No day group for ${separatorText}`)
  return group
}

describe('MessageThread, London days and times', () => {
  const originalScrollTo = Element.prototype.scrollTo

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 00:45 BST on 2 October in London; still 1 October in UTC.
    vi.setSystemTime(new Date('2026-10-01T23:45:00Z'))
    // jsdom has no scrolling, and the thread scrolls to the latest message on mount.
    Element.prototype.scrollTo = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    Element.prototype.scrollTo = originalScrollTo
  })

  it('files messages under their London day and shows London times', () => {
    render(
      <MessageThread
        messages={[
          // 23:30 BST on 1 October.
          message('m1', '2026-10-01T22:30:00Z', 'Before midnight'),
          // 00:30 BST on 2 October, which is London today.
          message('m2', '2026-10-01T23:30:00Z', 'After midnight'),
        ]}
        customerId="customer-1"
        customerName="Jane Regular"
        canReply={false}
      />,
    )

    const separators = screen
      .getAllByText(/^(Today|\d{2}\/\d{2}\/\d{4})$/)
      .map((element) => element.textContent)
    expect(separators).toEqual(['01/10/2026', 'Today'])

    const yesterday = dayGroup('01/10/2026')
    expect(within(yesterday).getByText('Before midnight')).toBeInTheDocument()
    expect(within(yesterday).getByText('11:30 PM')).toBeInTheDocument()

    const today = dayGroup('Today')
    expect(within(today).getByText('After midnight')).toBeInTheDocument()
    expect(within(today).getByText('12:30 AM')).toBeInTheDocument()
  })
})
