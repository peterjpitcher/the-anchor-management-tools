import { formatDateTime } from '@/lib/dateUtils'
import type { ParkingBooking } from '@/types/parking'

const CONTACT_NUMBER = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
const MANAGER_EMAIL = 'manager@the-anchor.pub'

export function buildPaymentReminderSms(booking: ParkingBooking, paymentUrl?: string) {
  const amount = booking.override_price ?? booking.calculated_price ?? 0
  const base = `Hi ${booking.customer_first_name}, your parking from ${formatDateTime(booking.start_at)} to ${formatDateTime(booking.end_at)} is still waiting for payment (£${amount.toFixed(2)}).`
  const linkPart = paymentUrl ? ` Pay securely here: ${paymentUrl}.` : ''
  return `${base}${linkPart} Need help? Call us on ${CONTACT_NUMBER}.`
}

export function buildPaymentReminderManagerEmail(booking: ParkingBooking, paymentUrl?: string) {
  const amount = booking.override_price ?? booking.calculated_price ?? 0
  const subject = `Parking booking pending payment – ${booking.reference}`
  const html = `
    <h2>Parking booking requires payment</h2>
    <p><strong>Reference:</strong> ${booking.reference}</p>
    <p><strong>Customer:</strong> ${booking.customer_first_name} ${booking.customer_last_name ?? ''}</p>
    <p><strong>Schedule:</strong> ${formatDateTime(booking.start_at)} – ${formatDateTime(booking.end_at)}</p>
    <p><strong>Amount due:</strong> £${amount.toFixed(2)}</p>
    ${paymentUrl ? `<p><a href="${paymentUrl}">Generate payment link</a></p>` : ''}
    <p>This email was sent automatically so you can follow up with the customer.</p>
  `
  return { subject, html, to: MANAGER_EMAIL }
}

export function buildSessionStartSms(booking: ParkingBooking) {
  return `Hi ${booking.customer_first_name}, your parking starts today from ${formatDateTime(booking.start_at)}. Registration ${booking.vehicle_registration}. See you soon!`
}

export function buildSessionEndSms(booking: ParkingBooking) {
  return `Hi ${booking.customer_first_name}, just a reminder your parking finishes today at ${formatDateTime(booking.end_at)}. Need extra time? Call ${CONTACT_NUMBER}.`
}

export function buildSessionManagerEmail(booking: ParkingBooking, type: 'start' | 'end') {
  const subject = type === 'start'
    ? `Parking starts today – ${booking.reference}`
    : `Parking ends today – ${booking.reference}`
  const html = `
    <h2>Parking ${type === 'start' ? 'session starting' : 'session ending'} today</h2>
    <p><strong>Reference:</strong> ${booking.reference}</p>
    <p><strong>Customer:</strong> ${booking.customer_first_name} ${booking.customer_last_name ?? ''}</p>
    <p><strong>Schedule:</strong> ${formatDateTime(booking.start_at)} – ${formatDateTime(booking.end_at)}</p>
    <p><strong>Vehicle:</strong> ${booking.vehicle_registration}</p>
  `
  return { subject, html, to: MANAGER_EMAIL }
}
