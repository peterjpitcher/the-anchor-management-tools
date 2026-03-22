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

export type PrivateBookingWeeklyDigestEvent = {
  bookingId: string
  customerName: string
  eventDate: string | null | undefined
  startTime: string | null | undefined
  status: string | null | undefined
  guestCount: number | null
  eventType: string | null | undefined
  outstandingBalance: number | null
  bookingUrl: string
  tier: 1 | 2 | 3
  triggerLabels: string[]
}

export type PrivateBookingWeeklyDigestInput = {
  runDateKey: string
  weekLabel: string
  appBaseUrl: string
  events: PrivateBookingWeeklyDigestEvent[]
  pendingSmsCount: number
  smsQueueUrl: string
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

export async function sendManagerPrivateBookingsWeeklyDigestEmail(
  input: PrivateBookingWeeklyDigestInput
): Promise<{ sent: boolean; error?: string; actionCount?: number; eventCount?: number }> {
  const appBaseUrl = normalizeAppBaseUrl(input.appBaseUrl)
  const privateBookingsUrl = `${appBaseUrl}/private-bookings`
  const events = input.events

  const tier1 = events.filter((e) => e.tier === 1)
  const tier2 = events.filter((e) => e.tier === 2)
  const tier3 = events.filter((e) => e.tier === 3)
  const actionCount = tier1.length + tier2.length
  const subject = `Private bookings weekly summary — ${input.weekLabel}`

  // --- HTML builder ---

  function renderEventCardHtml(event: PrivateBookingWeeklyDigestEvent): string {
    const tagsHtml = event.triggerLabels.length
      ? event.triggerLabels
          .map(
            (label) =>
              `<span style="display:inline-block;background:#f3f4f6;color:#374151;font-size:12px;padding:2px 8px;border-radius:4px;margin-right:4px;margin-top:4px;">${escapeHtml(label)}</span>`
          )
          .join('')
      : ''

    return [
      '<div style="padding:10px 12px;margin-bottom:8px;background:#fafafa;border-radius:4px;">',
      `<div><strong>${escapeHtml(event.customerName)}</strong></div>`,
      `<div style="font-size:14px;color:#4b5563;margin-top:2px;">${escapeHtml(formatEventMoment(event.eventDate, event.startTime))} · ${escapeHtml(`${event.guestCount ?? 0} guests`)} · ${escapeHtml(event.eventType?.trim() || 'Private event')}</div>`,
      tagsHtml ? `<div style="margin-top:4px;">${tagsHtml}</div>` : '',
      `<div style="margin-top:6px;"><a href="${escapeHtml(event.bookingUrl)}" style="color:#2563eb;font-size:13px;">View booking →</a></div>`,
      '</div>'
    ].join('')
  }

  function renderTierSectionHtml(
    heading: string,
    tierEvents: PrivateBookingWeeklyDigestEvent[],
    borderColor: string
  ): string {
    if (tierEvents.length === 0) return ''
    const cardsHtml = tierEvents.map(renderEventCardHtml).join('')
    return [
      `<div style="border-left:4px solid ${borderColor};padding-left:16px;margin-bottom:24px;">`,
      `<h3 style="margin:0 0 8px 0;font-size:16px;">${escapeHtml(heading)} (${tierEvents.length})</h3>`,
      cardsHtml,
      '</div>'
    ].join('')
  }

  function renderTier3SectionHtml(tierEvents: PrivateBookingWeeklyDigestEvent[]): string {
    if (tierEvents.length === 0) return ''
    const linesHtml = tierEvents
      .map(
        (event) =>
          `<div style="font-size:14px;padding:4px 0;color:#374151;">${escapeHtml(event.customerName)} · ${escapeHtml(formatEventMoment(event.eventDate, event.startTime))} · ${escapeHtml(`${event.guestCount ?? 0} guests`)} · ${escapeHtml(event.eventType?.trim() || 'Private event')}</div>`
      )
      .join('')
    return [
      '<div style="border-left:4px solid #16a34a;padding-left:16px;margin-bottom:24px;">',
      `<h3 style="margin:0 0 8px 0;font-size:16px;">On Track (${tierEvents.length})</h3>`,
      linesHtml,
      '</div>'
    ].join('')
  }

  const statsBarHtml = `<p style="font-size:16px;margin-bottom:16px;"><strong>${tier1.length}</strong> Action Required | <strong>${tier2.length}</strong> Needs Attention | <strong>${tier3.length}</strong> On Track</p>`

  const quickLinkHtml = `<p style="margin-bottom:20px;"><a href="${escapeHtml(privateBookingsUrl)}" style="color:#2563eb;">Open Private Bookings →</a></p>`

  const pendingSmsHtml =
    input.pendingSmsCount > 0
      ? `<div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:6px;"><strong>${input.pendingSmsCount}</strong> SMS pending approval · <a href="${escapeHtml(input.smsQueueUrl)}" style="color:#2563eb;">Review queue →</a></div>`
      : ''

  const footerHtml = `<p style="margin-top:24px;font-size:12px;color:#9ca3af;">Sent every Monday at 9am · <a href="${escapeHtml(privateBookingsUrl)}" style="color:#9ca3af;">Manage in Anchor Management Tools</a></p>`

  let bodyHtml: string
  if (events.length === 0) {
    bodyHtml = '<p style="margin-top:16px;color:#6b7280;">All clear — no upcoming private events. Enjoy your week.</p>'
  } else {
    bodyHtml = [
      renderTierSectionHtml('Action Required', tier1, '#dc2626'),
      renderTierSectionHtml('Needs Attention', tier2, '#d97706'),
      renderTier3SectionHtml(tier3)
    ].join('')
  }

  const html = [
    `<h2 style="margin-bottom:8px;">Private bookings weekly summary</h2>`,
    statsBarHtml,
    quickLinkHtml,
    bodyHtml,
    pendingSmsHtml,
    footerHtml
  ].join('')

  // --- Plain text builder ---

  const textLines: string[] = [
    `Private bookings weekly summary — ${input.weekLabel}`,
    '',
    `${tier1.length} Action Required | ${tier2.length} Needs Attention | ${tier3.length} On Track`
  ]

  if (events.length === 0) {
    textLines.push('', 'All clear — no upcoming private events. Enjoy your week.')
  } else {
    if (tier1.length > 0) {
      textLines.push('', '--- ACTION REQUIRED ---')
      tier1.forEach((event) => {
        textLines.push(
          `${event.customerName} | ${formatEventMoment(event.eventDate, event.startTime)} | ${event.guestCount ?? 0} guests | ${event.eventType?.trim() || 'Private event'}`
        )
        event.triggerLabels.forEach((label) => {
          textLines.push(`  → ${label}`)
        })
        textLines.push(`  ${event.bookingUrl}`)
      })
    }

    if (tier2.length > 0) {
      textLines.push('', '--- NEEDS ATTENTION ---')
      tier2.forEach((event) => {
        textLines.push(
          `${event.customerName} | ${formatEventMoment(event.eventDate, event.startTime)} | ${event.guestCount ?? 0} guests | ${event.eventType?.trim() || 'Private event'}`
        )
        event.triggerLabels.forEach((label) => {
          textLines.push(`  → ${label}`)
        })
        textLines.push(`  ${event.bookingUrl}`)
      })
    }

    if (tier3.length > 0) {
      textLines.push('', '--- ON TRACK ---')
      tier3.forEach((event) => {
        textLines.push(
          `${event.customerName} | ${formatEventMoment(event.eventDate, event.startTime)} | ${event.guestCount ?? 0} guests | ${event.eventType?.trim() || 'Private event'}`
        )
      })
    }
  }

  if (input.pendingSmsCount > 0) {
    textLines.push('', '--- PENDING SMS ---')
    textLines.push(`${input.pendingSmsCount} SMS pending approval: ${input.smsQueueUrl}`)
  }

  textLines.push(
    '',
    `Sent every Monday at 9am · Manage in Anchor Management Tools`,
    privateBookingsUrl
  )

  const result = await sendEmail({
    to: PRIVATE_BOOKINGS_MANAGER_EMAIL,
    subject,
    html,
    text: textLines.join('\n')
  })

  if (!result.success) {
    return {
      sent: false,
      error: result.error || 'Failed to send private-bookings weekly digest email',
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
