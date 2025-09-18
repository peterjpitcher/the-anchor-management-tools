'use server'

import { sendEmail } from '@/lib/email/emailService'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { createAdminClient } from '@/lib/supabase/server'

const MANAGER_EMAIL = 'manager@the-anchor.pub'

type TableBookingCustomer = {
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  email: string | null
}

type TableBookingRecord = {
  id: string
  booking_reference: string
  booking_date: string
  booking_time: string
  party_size: number
  status: string
  booking_type: string
  source: string | null
  special_requirements: string | null
  dietary_requirements: string[] | null
  allergies: string[] | null
  created_at: string
  customer?: TableBookingCustomer | null
}

function getLondonDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  const parts = formatter.formatToParts(date)
  const day = parts.find(part => part.type === 'day')?.value ?? '01'
  const month = parts.find(part => part.type === 'month')?.value ?? '01'
  const year = parts.find(part => part.type === 'year')?.value ?? '1970'

  return `${year}-${month}-${day}`
}

function buildBookingDetailsHtml(booking: TableBookingRecord): string {
  const customerName = [booking.customer?.first_name, booking.customer?.last_name]
    .filter(Boolean)
    .join(' ') || 'Unknown customer'

  const contactLines = [
    booking.customer?.mobile_number ? `Phone: ${booking.customer.mobile_number}` : null,
    booking.customer?.email ? `Email: ${booking.customer.email}` : null
  ].filter(Boolean)

  const extras: string[] = []

  if (booking.special_requirements) {
    extras.push(`<strong>Special requirements:</strong> ${booking.special_requirements}`)
  }

  if (booking.dietary_requirements && booking.dietary_requirements.length > 0) {
    extras.push(`<strong>Dietary:</strong> ${booking.dietary_requirements.join(', ')}`)
  }

  if (booking.allergies && booking.allergies.length > 0) {
    extras.push(`<strong>Allergies:</strong> ${booking.allergies.join(', ')}`)
  }

  return `
    <tr>
      <td style="padding: 8px; border: 1px solid #e5e7eb;">${formatTime12Hour(booking.booking_time)}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb;">${booking.booking_reference}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb;">
        <div><strong>${customerName}</strong></div>
        ${contactLines.length > 0 ? `<div style="font-size: 12px; color: #4b5563;">${contactLines.join('<br>')}</div>` : ''}
      </td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">${booking.party_size}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-transform: capitalize;">${booking.booking_type.replace('_', ' ')}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-transform: capitalize;">${booking.status.replace('_', ' ')}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb;">${extras.join('<br>') || '—'}</td>
    </tr>
  `
}

export async function sendDailyTableBookingSummary(targetDate?: string, preloadedBookings?: TableBookingRecord[]) {
  const dateToReport = targetDate || getLondonDateString()

  let bookings = preloadedBookings

  if (!bookings) {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        status,
        booking_type,
        source,
        special_requirements,
        dietary_requirements,
        allergies,
        created_at,
        customer:customers(first_name, last_name, mobile_number, email)
      `)
      .eq('booking_date', dateToReport)
      .order('booking_time', { ascending: true })

    if (error) {
      console.error('[Table Booking Summary] Failed to load bookings:', error)
      return { sent: false, error: 'FETCH_FAILED' as const }
    }

    bookings = (data || []).map(row => ({
      ...row,
      customer: Array.isArray(row.customer) ? row.customer[0] : row.customer
    })) as TableBookingRecord[]
  }

  const normalizedBookings = bookings.map(booking => ({
    ...booking,
    customer: Array.isArray(booking.customer) ? booking.customer[0] : booking.customer
  }))

  if (normalizedBookings.length === 0) {
    return { sent: false, reason: 'NO_BOOKINGS' as const, stats: { total: 0 } }
  }

  const totalCovers = normalizedBookings.reduce((sum, booking) => sum + (booking.party_size || 0), 0)

  const summaryRows = normalizedBookings.map(b => buildBookingDetailsHtml(b)).join('')

  const formattedDate = formatDateFull(dateToReport)

  const html = `
    <div style="font-family: Arial, sans-serif;">
      <h2 style="margin-bottom: 4px;">Table bookings for ${formattedDate}</h2>
      <p style="margin-top: 0; color: #4b5563;">${bookings.length} booking${bookings.length === 1 ? '' : 's'} · ${totalCovers} cover${totalCovers === 1 ? '' : 's'}</p>
      <table style="border-collapse: collapse; width: 100%; margin-top: 16px;">
        <thead>
          <tr style="background-color: #f3f4f6;">
            <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Time</th>
            <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Reference</th>
            <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Customer</th>
            <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">Covers</th>
            <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Type</th>
            <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Status</th>
            <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows}
        </tbody>
      </table>
    </div>
  `

  const ccRecipients = process.env.DAILY_SUMMARY_EMAIL && process.env.DAILY_SUMMARY_EMAIL !== MANAGER_EMAIL
    ? [process.env.DAILY_SUMMARY_EMAIL]
    : undefined

  const subject = `Table bookings for ${formattedDate} - ${bookings.length} booking${bookings.length === 1 ? '' : 's'}`

  const emailResult = await sendEmail({
    to: MANAGER_EMAIL,
    subject,
    html,
    cc: ccRecipients
  })

  if (!emailResult.success) {
    console.error('[Table Booking Summary] Failed to send email:', emailResult.error)
    return { sent: false, error: 'EMAIL_FAILED' as const }
  }

  return {
    sent: true,
    stats: {
      total: bookings.length,
      covers: totalCovers
    }
  }
}

export async function sendSameDayBookingAlertIfNeeded(booking: TableBookingRecord) {
  if (!booking?.booking_date) {
    return { sent: false, reason: 'NO_DATE' as const }
  }

  const todayLondon = getLondonDateString()
  if (booking.booking_date !== todayLondon) {
    return { sent: false, reason: 'NOT_SAME_DAY' as const }
  }

  const formattedDate = formatDateFull(booking.booking_date)
  const customerName = [booking.customer?.first_name, booking.customer?.last_name]
    .filter(Boolean)
    .join(' ') || 'Unknown customer'

  const contactLines = [
    booking.customer?.mobile_number ? `Phone: ${booking.customer.mobile_number}` : null,
    booking.customer?.email ? `Email: ${booking.customer.email}` : null
  ].filter(Boolean)

  const extraDetails: string[] = []
  if (booking.special_requirements) {
    extraDetails.push(`<strong>Special requirements:</strong> ${booking.special_requirements}`)
  }
  if (booking.dietary_requirements && booking.dietary_requirements.length > 0) {
    extraDetails.push(`<strong>Dietary:</strong> ${booking.dietary_requirements.join(', ')}`)
  }
  if (booking.allergies && booking.allergies.length > 0) {
    extraDetails.push(`<strong>Allergies:</strong> ${booking.allergies.join(', ')}`)
  }

  const html = `
    <div style="font-family: Arial, sans-serif;">
      <h2 style="margin-bottom: 4px;">New same-day booking received</h2>
      <p style="margin-top: 0; color: #4b5563;">${formattedDate} at ${formatTime12Hour(booking.booking_time)} · ${booking.party_size} cover${booking.party_size === 1 ? '' : 's'}</p>
      <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px;">
        <p style="margin: 0 0 8px;"><strong>Reference:</strong> ${booking.booking_reference}</p>
        <p style="margin: 0 0 8px;"><strong>Customer:</strong> ${customerName}</p>
        ${contactLines.length > 0 ? `<p style="margin: 0 0 8px;">${contactLines.join('<br>')}</p>` : ''}
        <p style="margin: 0 0 8px; text-transform: capitalize;"><strong>Type:</strong> ${booking.booking_type.replace('_', ' ')}</p>
        <p style="margin: 0 0 8px; text-transform: capitalize;"><strong>Status:</strong> ${booking.status.replace('_', ' ')}</p>
        ${extraDetails.length > 0 ? `<p style="margin: 8px 0 0;">${extraDetails.join('<br>')}</p>` : ''}
      </div>
      <p style="font-size: 12px; color: #6b7280; margin-top: 16px;">This alert is sent automatically whenever a booking is made for today.</p>
    </div>
  `

  const subject = `New same-day booking: ${booking.booking_reference} (${formatTime12Hour(booking.booking_time)})`

  const emailResult = await sendEmail({
    to: MANAGER_EMAIL,
    subject,
    html
  })

  if (!emailResult.success) {
    console.error('[Same-day Booking Alert] Failed to send email:', emailResult.error, {
      bookingId: booking.id
    })
    return { sent: false, error: 'EMAIL_FAILED' as const }
  }

  return { sent: true }
}

export { getLondonDateString }
export type { TableBookingRecord as TableBookingNotificationRecord }
