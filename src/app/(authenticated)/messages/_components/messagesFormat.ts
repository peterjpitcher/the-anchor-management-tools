import { formatDateInLondon, getTodayIsoDate, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { countSmsSegments, isGsm7, normaliseToGsm7 } from '@/lib/sms/gsm7'
import type { ConversationSummary } from '@/app/actions/messagesActions'
import type { CommunicationChannel } from '@/types/communications'

export type ConversationCustomer = ConversationSummary['customer']

export function formatCustomerName(customer: ConversationCustomer): string {
  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  if (name) return name
  if (customer.mobile_number) return customer.mobile_number
  return 'Unknown customer'
}

export function channelLabel(channel: CommunicationChannel): string {
  switch (channel) {
    case 'sms':
      return 'SMS'
    case 'whatsapp':
      return 'WhatsApp'
    case 'email':
      return 'Email'
    case 'feedback':
      return 'Feedback'
    default:
      return channel
  }
}

/**
 * One-line preview for a conversation row.
 *
 * Outbound last messages are prefixed "You: " so staff can tell at a glance
 * whether a customer is still waiting on a reply. Without it every row looks
 * identical and the only way to know was to open the thread.
 */
export function getPreviewText(conversation: ConversationSummary): string {
  const body = conversation.lastMessage.body?.trim()
  const subject = conversation.lastMessage.subject?.trim()
  const raw =
    subject || body || (conversation.lastMessage.has_attachments ? 'Attachment' : 'Communication')
  const text = raw.replace(/\s+/g, ' ')
  const prefix = conversation.lastMessage.direction === 'inbound' ? '' : 'You: '
  return `${prefix}${text}`
}

/**
 * Message timestamp, pinned to Europe/London.
 *
 * The date separators above these times are computed in London, so formatting
 * the time in the browser's zone made the two disagree for anyone working
 * outside the UK. `hourCycle` rather than `hour12`: en-GB with hour12 renders
 * noon as "0pm" on Node 20 (a V8 quirk).
 */
export function getMessageTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
    timeZone: 'Europe/London',
  })
}

/**
 * Compact list timestamp. `formatDistanceToNow` produced "about 2 hours ago",
 * which does not fit the ~64px the conversation row can spare for it.
 */
export function formatInboxTimestamp(timestamp: string, now: Date = new Date()): string {
  const then = new Date(timestamp)
  if (Number.isNaN(then.getTime())) return ''

  const diffMs = now.getTime() - then.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)

  // A timestamp in the future is clock skew or imported data, never "now".
  // Showing the real London clock time makes the oddity visible instead of
  // hiding it behind a friendly label.
  if (diffMinutes < 0) return getMessageTime(timestamp)
  if (diffMinutes < 1) return 'now'
  if (diffMinutes < 60) return `${diffMinutes}m`

  const thenIsoDate = toLocalIsoDate(then)
  const todayIsoDate = toLocalIsoDate(now)
  if (thenIsoDate === todayIsoDate) return getMessageTime(timestamp)
  if (thenIsoDate === shiftIsoDate(todayIsoDate, -1)) return 'Yesterday'

  // Within the previous six calendar days the weekday is the fastest thing to
  // read. Deliberately a rolling six-day window, not a calendar week: "Mon"
  // is never ambiguous inside it.
  const sixDaysAgo = shiftIsoDate(todayIsoDate, -6)
  if (sixDaysAgo && thenIsoDate >= sixDaysAgo) {
    return formatDateInLondon(then, { weekday: 'short' })
  }

  const isThisYear = thenIsoDate.slice(0, 4) === todayIsoDate.slice(0, 4)
  return formatDateInLondon(then, {
    day: 'numeric',
    month: 'short',
    ...(isThisYear ? {} : { year: 'numeric' }),
  })
}

/** Heading for a date separator inside the thread. */
export function formatThreadDateHeading(isoDate: string): string {
  const today = getTodayIsoDate()
  if (isoDate === today) return 'Today'
  if (isoDate === shiftIsoDate(today, -1)) return 'Yesterday'
  return formatDateInLondon(isoDate, { day: 'numeric', month: 'long', year: 'numeric' })
}

export function getStatusText(status?: string): string {
  switch (status) {
    case 'delivered':
    case 'read':
      return 'Delivered'
    case 'sent':
      return 'Sent'
    case 'failed':
    case 'undelivered':
      return 'Not delivered'
    default:
      return ''
  }
}

/**
 * Cost preview for the composer.
 *
 * The send path normalises smart punctuation to GSM-7 and then measures the
 * result with countSmsSegments, so this previews exactly the same string. The
 * old length/160 formula ignored the shorter 153/67 character limits that apply
 * once a message splits, so it under-reported segments and therefore cost.
 */
export function describeSmsCost(text: string): { chars: number; segments: number; isUnicode: boolean } {
  if (text.length === 0) return { chars: 0, segments: 0, isUnicode: false }
  const body = normaliseToGsm7(text)
  return { chars: body.length, segments: countSmsSegments(body), isUnicode: !isGsm7(body) }
}

/* ------------------------------------------------------------------ */
/*  Message body                                                       */
/* ------------------------------------------------------------------ */

export type MessageBody = {
  /** Rendered above the body, only when it adds something the body does not. */
  subject: string | null
  /** The body text, or null when there is genuinely nothing to show. */
  text: string | null
  /** Shown in place of the body when there is no text at all. */
  placeholder: string | null
}

/**
 * Strips an HTML email down to readable text.
 *
 * Some inbound emails arrive with `body_html` and no `body_text`. The thread
 * rendered those as an empty bubble, so staff could see that a customer had
 * emailed but not what they said. This is a fallback, not a renderer: it is
 * only ever reached when there is no plain-text part.
 */
export function htmlToPlainText(html: string): string {
  return (
    html
      // Script and style bodies are not content, and would otherwise be dumped
      // into the bubble as text.
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      // Paragraph-level breaks read as a blank line; row and list items as one.
      .replace(/<\/(p|div|blockquote|section|article)>/gi, '\n\n')
      .replace(/<\/(tr|li|h[1-6]|td|th)>/gi, '\n')
      // Every other tag goes to nothing, not to a space: replacing `</b>` with
      // a space turned "<b>8pm</b>?" into "8pm ?".
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * What a bubble should show, per channel.
 *
 * The old rule was `body_text || subject || 'Attachment'`, with the subject also
 * rendered above the bubble. An email with a subject and no text body therefore
 * printed the subject twice, and an HTML-only email printed nothing at all.
 */
export function getMessageBody(message: {
  channel: CommunicationChannel
  subject: string | null
  body_text: string | null
  body_html?: string | null
  has_attachments: boolean
}): MessageBody {
  const subject = message.subject?.trim() || null
  const text = message.body_text?.trim() || null

  if (text) return { subject, text, placeholder: null }

  const fromHtml = message.body_html ? htmlToPlainText(message.body_html) : ''
  if (fromHtml) return { subject, text: fromHtml, placeholder: null }

  // No body. Keep the subject as the heading rather than repeating it as the
  // body, and say plainly that there was nothing else.
  if (subject) {
    return {
      subject,
      text: null,
      placeholder: message.has_attachments ? 'Attachment only, no message text' : 'No message text',
    }
  }

  return {
    subject: null,
    text: null,
    placeholder: message.has_attachments ? 'Attachment only, no message text' : 'No message text',
  }
}

/** Filenames for the attachment list, so staff know what arrived. */
export function describeAttachments(
  attachments: Array<Record<string, unknown>> | null | undefined,
): string[] {
  if (!Array.isArray(attachments)) return []
  return attachments.map((attachment, index) => {
    const name = attachment.filename ?? attachment.name
    return typeof name === 'string' && name.trim() ? name.trim() : `Attachment ${index + 1}`
  })
}
