import { describe, expect, it } from 'vitest'

import {
  describeAttachments,
  formatCustomerName,
  formatInboxTimestamp,
  formatThreadDateHeading,
  getMessageBody,
  getMessageTime,
  getPreviewText,
} from '../messagesFormat'

const customer = {
  id: 'c1',
  first_name: 'Jane',
  last_name: 'Smith',
  mobile_number: '07123456789',
  email: 'jane@example.com',
  sms_opt_in: true,
  whatsapp_opt_in: false,
  whatsapp_status: null,
}

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    customer,
    unreadCount: 0,
    channels: ['sms' as const],
    lastMessage: {
      id: 'm1',
      body: 'See you at seven',
      subject: null,
      channel: 'sms' as const,
      direction: 'inbound',
      created_at: '2026-06-24T10:00:00.000Z',
      read_at: null,
      staff_read_at: null,
      has_attachments: false,
    },
    lastMessageAt: '2026-06-24T10:00:00.000Z',
    ...overrides,
  } as Parameters<typeof getPreviewText>[0]
}

describe('formatCustomerName', () => {
  it('falls back to the mobile number, then to a placeholder', () => {
    expect(formatCustomerName(customer)).toBe('Jane Smith')
    expect(formatCustomerName({ ...customer, first_name: null, last_name: null })).toBe('07123456789')
    expect(
      formatCustomerName({ ...customer, first_name: null, last_name: null, mobile_number: null }),
    ).toBe('Unknown customer')
  })
})

describe('getPreviewText', () => {
  it('marks outbound previews so staff can see who spoke last', () => {
    expect(getPreviewText(conversation())).toBe('See you at seven')
    expect(
      getPreviewText(
        conversation({
          lastMessage: { ...conversation().lastMessage, direction: 'outbound' },
        }),
      ),
    ).toBe('You: See you at seven')
  })

  it('collapses newlines so a multi-line SMS stays on one row', () => {
    expect(
      getPreviewText(
        conversation({
          lastMessage: { ...conversation().lastMessage, body: 'Line one\n\nLine two' },
        }),
      ),
    ).toBe('Line one Line two')
  })
})

describe('formatInboxTimestamp', () => {
  // 24 June 2026 is BST, so London is UTC+1.
  const now = new Date('2026-06-24T12:00:00.000Z')

  it('uses relative minutes inside the hour', () => {
    expect(formatInboxTimestamp('2026-06-24T11:59:30.000Z', now)).toBe('now')
    expect(formatInboxTimestamp('2026-06-24T11:35:00.000Z', now)).toBe('25m')
  })

  it('uses a London clock time for earlier the same day', () => {
    expect(formatInboxTimestamp('2026-06-24T08:05:00.000Z', now)).toBe('9:05 am')
  })

  it('labels yesterday, then the weekday, then the date', () => {
    expect(formatInboxTimestamp('2026-06-23T09:00:00.000Z', now)).toBe('Yesterday')
    expect(formatInboxTimestamp('2026-06-21T09:00:00.000Z', now)).toBe('Sun')
    expect(formatInboxTimestamp('2026-05-02T09:00:00.000Z', now)).toBe('2 May')
    expect(formatInboxTimestamp('2025-05-02T09:00:00.000Z', now)).toBe('2 May 2025')
  })
})

describe('getMessageTime', () => {
  it('formats in London regardless of the host timezone', () => {
    // 23:30 UTC in June is 00:30 the next day in London.
    expect(getMessageTime('2026-06-24T23:30:00.000Z')).toBe('12:30 am')
  })

  it('renders midday as 12pm, not the en-GB "0pm" quirk', () => {
    expect(getMessageTime('2026-06-24T11:00:00.000Z')).toBe('12:00 pm')
  })
})

describe('formatThreadDateHeading', () => {
  it('spells out a date that is neither today nor yesterday', () => {
    expect(formatThreadDateHeading('2026-05-02')).toBe('2 May 2026')
  })
})

describe('formatInboxTimestamp edge cases', () => {
  const now = new Date('2026-06-24T12:00:00.000Z')

  it('shows a clock time for a future timestamp rather than "now"', () => {
    // Clock skew and imported data both produce these. Calling them "now" hid
    // the oddity behind a friendly label.
    expect(formatInboxTimestamp('2026-06-24T14:00:00.000Z', now)).toBe('3:00 pm')
  })

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatInboxTimestamp('not-a-date', now)).toBe('')
  })

  it('uses the rolling six-day window, not the calendar week', () => {
    // 18 June is exactly six days back and still a weekday label; 17 June is
    // seven and falls through to a date.
    expect(formatInboxTimestamp('2026-06-18T09:00:00.000Z', now)).toBe('Thu')
    expect(formatInboxTimestamp('2026-06-17T09:00:00.000Z', now)).toBe('17 Jun')
  })
})

describe('getMessageBody', () => {
  const base = {
    channel: 'email' as const,
    subject: null,
    body_text: null,
    body_html: null,
    has_attachments: false,
  }

  it('prefers the plain text body', () => {
    expect(getMessageBody({ ...base, subject: 'Booking', body_text: 'See you then' })).toEqual({
      subject: 'Booking',
      text: 'See you then',
      placeholder: null,
    })
  })

  it('does not repeat the subject as the body when there is no text', () => {
    const result = getMessageBody({ ...base, subject: 'Christmas party enquiry' })
    expect(result.subject).toBe('Christmas party enquiry')
    expect(result.text).toBeNull()
    expect(result.placeholder).toBe('No message text')
  })

  it('falls back to stripped HTML so an HTML-only email is not an empty bubble', () => {
    const result = getMessageBody({
      ...base,
      subject: 'Re: table',
      body_html: '<p>Hi there</p><p>Can we move to <b>8pm</b>?</p>',
    })
    expect(result.text).toBe('Hi there\n\nCan we move to 8pm?')
  })

  it('drops script and style content from the HTML fallback', () => {
    const result = getMessageBody({
      ...base,
      body_html: '<style>p{color:red}</style><script>alert(1)</script><p>Real text</p>',
    })
    expect(result.text).toBe('Real text')
  })

  it('says an attachment arrived with no message text', () => {
    const result = getMessageBody({ ...base, has_attachments: true })
    expect(result.placeholder).toBe('Attachment only, no message text')
  })
})

describe('describeAttachments', () => {
  it('lists filenames from either key, and numbers the nameless', () => {
    expect(
      describeAttachments([{ filename: 'menu.pdf' }, { name: 'photo.jpg' }, { size: 12 }]),
    ).toEqual(['menu.pdf', 'photo.jpg', 'Attachment 3'])
  })

  it('handles a missing or malformed list', () => {
    expect(describeAttachments(null)).toEqual([])
    expect(describeAttachments(undefined)).toEqual([])
  })
})
