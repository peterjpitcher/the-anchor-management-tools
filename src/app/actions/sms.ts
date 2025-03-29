'use server'

import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

const fromNumber = process.env.TWILIO_PHONE_NUMBER!

export async function sendBookingConfirmation(bookingId: string) {
  try {
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        *,
        customer:customers(first_name, last_name, mobile_number),
        event:events(name, date, time)
      `)
      .eq('id', bookingId)
      .single()

    if (bookingError || !booking) {
      console.error('Error fetching booking:', bookingError)
      throw new Error('Failed to fetch booking details')
    }

    let message
    if (booking.seats) {
      message = `Hi ${booking.customer.first_name}, thanks for booking ${booking.seats} seats for ${booking.event.name} on ${new Date(booking.event.date).toLocaleDateString()} at ${booking.event.time}. We look forward to seeing you! Reply to this message if you need to make any changes. The Anchor.`
    } else {
      message = `Hi ${booking.customer.first_name}, thanks for your interest in ${booking.event.name} on ${new Date(booking.event.date).toLocaleDateString()} at ${booking.event.time}. We'll be in touch about availability. Reply to this message if you need to make any changes. The Anchor.`
    }

    await twilioClient.messages.create({
      body: message,
      to: booking.customer.mobile_number,
      from: fromNumber,
    })

    return { success: true }
  } catch (error) {
    console.error('Error sending SMS:', error)
    throw error
  }
} 