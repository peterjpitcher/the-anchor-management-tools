import { formatTime12Hour } from '@/lib/dateUtils'
import { sendEmail } from '@/lib/email/emailService'

const LONDON_TIMEZONE = 'Europe/London'
const DEFAULT_MANAGER_EMAIL = 'manager@the-anchor.pub'

export const PRIVATE_BOOKINGS_MANAGER_EMAIL =
  process.env.PRIVATE_BOOKINGS_MANAGER_EMAIL?.trim() || DEFAULT_MANAGER_EMAIL

type NullableString = string | null | undefined

export type PrivateBookingCreatedNotificationInput = {
  booking: {
    id?: NullableString
    booking_reference?: NullableString
    customer_name?: NullableString
    customer_first_name?: NullableString
    customer_last_name?: NullableString
    contact_phone?: NullableString
    contact_email?: NullableString
    event_date?: NullableString
    start_time?: NullableString
    status?: NullableString
    source?: NullableString
    guest_count?: number | null
    event_type?: NullableString
    hold_expiry?: NullableString
    created_at?: NullableString
  }
  createdVia?: string
}

export type PrivateBookingDailyDigestEvent = {
  bookingId: string
  customerName: string
  eventDate: NullableString
  startTime: NullableString
  status: NullableString
  guestCount: number | null
  eventType: NullableString
  outstandingBalance: number | null
  bookingUrl: string
}

export type PrivateBookingDailyDigestActionItem = {
  label: string
  detail?: string
  href?: string
}

export type PrivateBookingDailyDigestActionSection = {
  title: string
  summary?: string
  items: PrivateBookingDailyDigestActionItem[]
}

export type PrivateBookingDailyDigestInput = {
  runDateKey: string
  appBaseUrl: string
  events: PrivateBookingDailyDigestEvent[]
  actionSections: PrivateBookingDailyDigestActionSection[]
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDateOnly(value?: NullableString): string {
  if (!value) return 'Date TBC'
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime())) return 'Date TBC'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(parsed)
}

function formatDateTime(value?: NullableString): string {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(parsed)
}

function formatEventMoment(eventDate?: NullableString, startTime?: NullableString): string {
  const dateLabel = formatDateOnly(eventDate)
  if (!startTime) return `${dateLabel} (time TBC)`
  return `${dateLabel} at ${formatTime12Hour(String(startTime).slice(0, 5))}`
}

function normalizeCustomerName(input: {
  customer_name?: NullableString
  customer_first_name?: NullableString
  customer_last_name?: NullableString
}): string {
  const direct = input.customer_name?.trim()
  if (direct) return direct

  const first = input.customer_first_name?.trim() || ''
  const last = input.customer_last_name?.trim() || ''
  const joined = `${first} ${last}`.trim()
  return joined || 'Guest'
}

function normalizeAppBaseUrl(appBaseUrl: string): string {
  return appBaseUrl.replace(/\/+$/, '')
}

function formatCurrency(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  return `£${value.toFixed(2)}`
}

function humanizeToken(value?: NullableString): string {
  const token = value?.trim()
  if (!token) return 'Unknown'
  const normalized = token.replaceAll('_', ' ').replaceAll('-', ' ')
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export async function sendManagerPrivateBookingCreatedEmail(
  input: PrivateBookingCreatedNotificationInput
): Promise<{ sent: boolean; error?: string }> {
  const booking = input.booking
  const bookingId = booking.id?.trim() || 'unknown'
  const bookingReference = booking.booking_reference?.trim() || bookingId
  const customerName = normalizeCustomerName(booking)
  const eventMoment = formatEventMoment(booking.event_date, booking.start_time)
  const createdAt = formatDateTime(booking.created_at)
  const source = humanizeToken(booking.source)
  const status = humanizeToken(booking.status)
  const createdVia = humanizeToken(input.createdVia || 'website')
  const appBaseUrl = normalizeAppBaseUrl(process.env.NEXT_PUBLIC_APP_URL || '')
  const bookingUrl = appBaseUrl ? `${appBaseUrl}/private-bookings/${bookingId}` : null
  const subject = `New private booking enquiry: ${bookingReference}`

  const rows = [
    `<li><strong>Booking:</strong> ${escapeHtml(bookingReference)}</li>`,
    `<li><strong>Guest:</strong> ${escapeHtml(customerName)}</li>`,
    `<li><strong>Event:</strong> ${escapeHtml(eventMoment)}</li>`,
    `<li><strong>Status:</strong> ${escapeHtml(status)}</li>`,
    `<li><strong>Source:</strong> ${escapeHtml(source)}</li>`,
    `<li><strong>Created via:</strong> ${escapeHtml(createdVia)}</li>`,
    `<li><strong>Guest count:</strong> ${escapeHtml(String(booking.guest_count ?? 0))}</li>`,
    `<li><strong>Event type:</strong> ${escapeHtml(booking.event_type?.trim() || 'Private event')}</li>`,
    `<li><strong>Phone:</strong> ${escapeHtml(booking.contact_phone?.trim() || 'Not provided')}</li>`,
    `<li><strong>Email:</strong> ${escapeHtml(booking.contact_email?.trim() || 'Not provided')}</li>`,
    `<li><strong>Hold expiry:</strong> ${escapeHtml(formatDateTime(booking.hold_expiry))}</li>`,
    `<li><strong>Created:</strong> ${escapeHtml(createdAt)}</li>`
  ]

  if (bookingUrl) {
    rows.push(`<li><strong>Open booking:</strong> <a href="${escapeHtml(bookingUrl)}">${escapeHtml(bookingUrl)}</a></li>`)
  }

  const html = [
    '<p>A new private booking enquiry has been received.</p>',
    '<ul>',
    ...rows,
    '</ul>'
  ].join('')

  const textLines = [
    'A new private booking enquiry has been received.',
    '',
    `Booking: ${bookingReference}`,
    `Guest: ${customerName}`,
    `Event: ${eventMoment}`,
    `Status: ${status}`,
    `Source: ${source}`,
    `Created via: ${createdVia}`,
    `Guest count: ${booking.guest_count ?? 0}`,
    `Event type: ${booking.event_type?.trim() || 'Private event'}`,
    `Phone: ${booking.contact_phone?.trim() || 'Not provided'}`,
    `Email: ${booking.contact_email?.trim() || 'Not provided'}`,
    `Hold expiry: ${formatDateTime(booking.hold_expiry)}`,
    `Created: ${createdAt}`
  ]

  if (bookingUrl) {
    textLines.push(`Open booking: ${bookingUrl}`)
  }

  const result = await sendEmail({
    to: PRIVATE_BOOKINGS_MANAGER_EMAIL,
    subject,
    html,
    text: textLines.join('\n')
  })

  if (!result.success) {
    return {
      sent: false,
      error: result.error || 'Failed to send manager private booking created email'
    }
  }

  return { sent: true }
}

export async function sendManagerPrivateBookingsDailyDigestEmail(
  input: PrivateBookingDailyDigestInput
): Promise<{ sent: boolean; error?: string; actionCount?: number; eventCount?: number }> {
  const appBaseUrl = normalizeAppBaseUrl(input.appBaseUrl)
  const privateBookingsUrl = `${appBaseUrl}/private-bookings`
  const events = input.events
  const actionSections = input.actionSections
  const actionCount = actionSections.reduce((sum, section) => sum + section.items.length, 0)
  const dateLabel = formatDateOnly(input.runDateKey)
  const subject = `Private bookings daily summary - ${dateLabel}`

  const eventRowsHtml = events.length
    ? events
      .map((event) => {
        const line = [
          `<strong>${escapeHtml(event.customerName)}</strong>`,
          ` - ${escapeHtml(formatEventMoment(event.eventDate, event.startTime))}`,
          ` - ${escapeHtml(humanizeToken(event.status))}`,
          ` - ${escapeHtml(`${event.guestCount ?? 0} guests`)}`,
          ` - ${escapeHtml(event.eventType?.trim() || 'Private event')}`
        ].join('')
        const balanceText =
          typeof event.outstandingBalance === 'number' && event.outstandingBalance > 0
            ? ` <em>(Outstanding: ${escapeHtml(formatCurrency(event.outstandingBalance))})</em>`
            : ''
        return `<li>${line}${balanceText} <a href="${escapeHtml(event.bookingUrl)}">Open</a></li>`
      })
      .join('')
    : '<li>No upcoming private events.</li>'

  const actionSectionsHtml = actionSections.length
    ? actionSections
      .map((section) => {
        const itemsHtml = section.items.length
          ? section.items
            .map((item) => {
              const detail = item.detail ? ` - ${escapeHtml(item.detail)}` : ''
              const link = item.href ? ` <a href="${escapeHtml(item.href)}">Open</a>` : ''
              return `<li>${escapeHtml(item.label)}${detail}${link}</li>`
            })
            .join('')
          : '<li>None</li>'

        const summary = section.summary ? `<p>${escapeHtml(section.summary)}</p>` : ''
        return `<div><h3>${escapeHtml(section.title)}</h3>${summary}<ul>${itemsHtml}</ul></div>`
      })
      .join('')
    : '<p>No outstanding private-booking actions today.</p>'

  const html = [
    '<h2>Private bookings daily summary</h2>',
    `<p><strong>Date:</strong> ${escapeHtml(dateLabel)}</p>`,
    `<p><strong>Upcoming private events:</strong> ${events.length}</p>`,
    `<p><strong>Outstanding actions:</strong> ${actionCount}</p>`,
    `<p>Workspace: <a href="${escapeHtml(privateBookingsUrl)}">${escapeHtml(privateBookingsUrl)}</a></p>`,
    '<h3>Upcoming private events</h3>',
    `<ul>${eventRowsHtml}</ul>`,
    '<h3>Outstanding actions</h3>',
    actionSectionsHtml
  ].join('')

  const textLines: string[] = [
    'Private bookings daily summary',
    '',
    `Date: ${dateLabel}`,
    `Upcoming private events: ${events.length}`,
    `Outstanding actions: ${actionCount}`,
    `Workspace: ${privateBookingsUrl}`,
    '',
    'Upcoming private events:'
  ]

  if (events.length === 0) {
    textLines.push('- No upcoming private events.')
  } else {
    events.forEach((event) => {
      const balanceText =
        typeof event.outstandingBalance === 'number' && event.outstandingBalance > 0
          ? ` | Outstanding ${formatCurrency(event.outstandingBalance)}`
          : ''
      textLines.push(
        `- ${event.customerName} | ${formatEventMoment(event.eventDate, event.startTime)} | ${humanizeToken(event.status)} | ${event.guestCount ?? 0} guests | ${event.eventType?.trim() || 'Private event'}${balanceText} | ${event.bookingUrl}`
      )
    })
  }

  textLines.push('', 'Outstanding actions:')
  if (actionSections.length === 0) {
    textLines.push('- No outstanding private-booking actions today.')
  } else {
    actionSections.forEach((section) => {
      textLines.push(`- ${section.title}`)
      if (section.summary) {
        textLines.push(`  ${section.summary}`)
      }
      if (section.items.length === 0) {
        textLines.push('  - None')
      } else {
        section.items.forEach((item) => {
          const detail = item.detail ? ` | ${item.detail}` : ''
          const href = item.href ? ` | ${item.href}` : ''
          textLines.push(`  - ${item.label}${detail}${href}`)
        })
      }
    })
  }

  const result = await sendEmail({
    to: PRIVATE_BOOKINGS_MANAGER_EMAIL,
    subject,
    html,
    text: textLines.join('\n')
  })

  if (!result.success) {
    return {
      sent: false,
      error: result.error || 'Failed to send private-bookings daily digest email',
      actionCount,
      eventCount: events.length
    }
  }

  return {
    sent: true,
    actionCount,
    eventCount: events.length
  }
}
